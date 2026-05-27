<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./public/white-metacodex-icon.png">
  <img src="./public/black-metacodex-icon.png" alt="metacodex" width="96">
</picture>

# metacodex

**Um workspace de desenvolvimento local-first, premium, para programar com agentes de IA pelo terminal.**

Navegação de arquivos no estilo VS Code. Calma visual de Cursor. Claude Code, Codex CLI, OpenCode e companhia — rodando como abas de PTY real dentro de um app desktop nativo.

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-Edition%202021-CE412B?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![macOS first](https://img.shields.io/badge/Plataforma-macOS%20first-000000?logo=apple&logoColor=white)](#requisitos)

[English 🇺🇸](./README.md)

</div>

---

## O que é o metacodex?

metacodex é um app desktop que coloca **árvore de arquivos, editor, terminal e seu agente de IA na mesma janela**, sem abrir mão das coisas que dev de verdade depende (PTY real, `$SHELL -l` real, git real, seu `.zshrc`).

A base é uma **shell Tauri 2** — um núcleo Rust pequeno que detém todo I/O do sistema (PTY, filesystem, busca, watcher, git) — e um frontend **React 19 + TypeScript** que é puramente UI e estado. Tudo é **local-first**: sem auth, sem round-trip pra nuvem, sem telemetria. Configurações, projetos e estado por workspace ficam como JSON editável à mão em `~/.metacodex/`.

A sensação é mais próxima de Linear / Raycast do que de uma IDE Electron tradicional: theming via tokens, um único fade de opacidade pra todo popup, focus rings nativos e uma barra de abas que não vaza chrome de browser.

## Download & instalação

**Para Macs Apple Silicon (M1 / M2 / M3 / M4).** Três passos, ~30 segundos:

1. **Baixe** [`metacodex_<última>_aarch64.dmg`](https://github.com/victorbenazzi/metacodex/releases/latest) na página de Releases.
2. **Abra o `.dmg`** e arraste `metacodex.app` pra `/Applications`.
3. **Abra o Terminal e cole essa linha única:**
   ```bash
   sudo xattr -cr /Applications/metacodex.app && open /Applications/metacodex.app
   ```
   *Só uma vez por instalação. O macOS coloca apps não-assinados em quarentena; esse comando limpa o flag e abre o metacodex.*

Pronto — sem conta, sem wizard de setup. Versões futuras chegam sozinhas (veja [Auto-update](#auto-update) abaixo).

> Builds pra Mac Intel, Windows e Linux estão temporariamente desativadas enquanto cada plataforma é verificada ponta a ponta. Apple Silicon sai primeiro porque é o que o mantenedor usa no dia a dia; as outras voltam uma a uma. Abra uma issue se quiser priorizar alguma.
>
> Travou em *"app está danificado"* ou *"o desenvolvedor não pode ser verificado"*? Veja o [workaround completo de assinatura](#erro-de-assinatura-no-macos-app-está-danificado--não-pode-ser-aberto).

## Auto-update

A partir da **v0.0.3**, o metacodex se atualiza sozinho. Logo após abrir, o app consulta o `latest.json` deste repo; quando aparece versão nova, surge a pill azul **Update** no topbar. Um clique → o novo payload é baixado, a assinatura é verificada contra a chave pública embutida, o `.app` é trocado no lugar e o app reabre sozinho. Sem reinstalar.

> ⚠️ Se o macOS recolocar a quarentena após um update in-place (raro, mas acontece em apps não-assinados), rode `sudo xattr -cr /Applications/metacodex.app` uma vez e abra de novo. Sim, a gente sabe — a Apple cobra $99/ano pra essa mensagem sumir. No dia que o metacodex tiver cartão de crédito próprio, a gente assina. Até lá: terminal.

## Por que existe

| Dor | Resposta do metacodex |
|---|---|
| CLIs de IA são ótimas isoladamente mas péssimas como workspace | **Abas de PTY** de primeira classe pra Claude Code, Codex CLI, OpenCode, Antigravity, Hermes, OpenClaw — lançadas via `$SHELL -l -i -c` pra preservar PATH do `mise` / `nvm` / `.zshrc`. |
| IDE Electron é pesada, lenta pra abrir, frágil em resize | Shell nativa Tauri 2, binário de ~dezenas de MB, cold start instantâneo. |
| "Abrir no terminal" é troca de contexto | Terminal e editor vivem na **mesma barra de abas**, agrupados por projeto. |
| Configurações na nuvem dessincronizam | JSON puro em `~/.metacodex/`. Edite no vim se quiser. |
| Watcher, busca e git reinventados por app | Um `notify` debouncado por projeto, busca nível ripgrep via `grep-searcher`, `libgit2` via `git2`. |

## Funcionalidades

### Workspace
- **Trilho de projetos** reordenável, com tint de arquivo recente e buckets de abas por projeto — trocar de projeto troca o conjunto inteiro de abas visíveis; abas de outros projetos continuam vivas em memória.
- **Painéis redimensionáveis** (Explorer / principal / Source Control).
- **Telas Welcome / vazio** que mostram sessões recentes de agente (`resume.json`).
- **Command palette** (`Cmd+Shift+P`) pra comandos e arquivos.

### File Explorer (totalmente mutável)
- Criar, renomear, deletar, arrastar-mover — paridade com VS Code.
- Toda mutação passa por checagem de roots em Rust; moves **recusam em caso de conflito** em vez de sobrescrever.
- Abas de editor abertas seguem renomeações; caminhos removidos fecham as abas órfãs.
- Escrita atômica (`<path>.metacodex.tmp` → `rename`).

### Editor (CodeMirror 6)
- Suporte a TS/JS, Rust, Go, Python, Java, C/C++, PHP, HTML/CSS/Less/Sass, JSON, YAML, SQL, Markdown, Vue, Angular e mais.
- Sticky scroll, merge view, busca/substituição, autocomplete.
- Preview de markdown / imagem / PDF como tipos de aba nativos.

### Terminal & CLIs de IA
- xterm.js v5.5 com renderer Canvas (ordem de carregamento cuidadosamente adiada — veja `useXterm.ts`), fallback DOM em caso de falha.
- **JetBrains Mono Nerd Font** embutida pra glifos de TUI (box-drawing do Claude Code, spinners do Codex) — `lineHeight` travado em 1.0 por design.
- Launcher de um clique pra qualquer CLI do registry (`cli-registry.ts`): Claude Code, Codex CLI, OpenCode, Antigravity, Hermes, OpenClaw, Pi.
- **Status de agente** por aba (`idle | working | needs-attention | done`) via parsing de OSC + heurística; pule pro próximo "needs-attention" com `Cmd+Shift+U`.
- **Tooltip de aba** com branch, cwd e portas em escuta (pollado do Rust).
- Notificação do sistema operacional + som quando o agente termina ou precisa de você.

### Source Control
- Painel SCM à direita, baseado em `libgit2`.
- **Worktrees** — listar, criar, trocar e fazer merge no mesmo painel.

### Configurações & Atalhos
- JSON puro em `~/.metacodex/settings.json` e `~/.metacodex/keybindings.json` (este último guarda só os overrides).
- Fonte do editor & terminal, scrollback, sticky headers, debounces, densidade de UI (compact / comfortable / spacious — alimenta cada `--space-*` via `calc()`).
- Todos os atalhos são reconfiguráveis (`Cmd+,` → Keybindings, ou edite o JSON).
- Tema: light / dark / sistema. Por padrão segue o `prefers-color-scheme`.

### Internacionalização
- Inglês (padrão) e Português brasileiro de fábrica (`react-i18next`).
- Toda string de UI passa por `t()` — nunca hardcoded.

## Requisitos

metacodex é **macOS-first**. Linux roda em larga medida (mesmo stack Rust/Tauri) mas ainda não tem QA dos mantenedores. Windows não é suportado.

Pra rodar a partir do código você precisa de:

| Ferramenta | Por quê |
|---|---|
| **macOS 12+ (Monterey ou mais novo)** | Baseline do Tauri 2 |
| **Xcode Command Line Tools** | `xcode-select --install` |
| **Rust** (stable) | Núcleo Rust do Tauri — instale via [`rustup`](https://rustup.rs) |
| **Node.js 20+** | Vite / TS |
| **pnpm** | Gerenciador de pacotes — `npm i -g pnpm` (ou `corepack enable`) |

## Instalação (a partir do código)

```bash
# 1. Clone
git clone https://github.com/victorbenazzi/metacodex.git
cd metacodex

# 2. Instale as deps JS
pnpm install

# 3. Rode o app (Vite + Tauri, com hot reload)
pnpm tauri dev
```

O dev server do Vite sobe na **porta 1420** (`strictPort: true`); o `beforeDevCommand` do Tauri inicia ele. Não mude essa porta sem atualizar `src-tauri/tauri.conf.json`.

## Build de produção

```bash
# Gera .app / .dmg em src-tauri/target/release/bundle/
pnpm tauri build
```

O perfil release é otimizado pra tamanho (`opt-level = "s"`, `lto`, `panic = "abort"`, `strip`). Espere um binário nativo bem enxuto.

## Comandos disponíveis

| Tarefa | Comando |
|---|---|
| Rodar o app desktop | `pnpm tauri dev` |
| Rodar só o frontend Vite (sem shell nativa) | `pnpm dev` |
| Type-check + build de produção do frontend | `pnpm build` |
| Só type-check | `pnpm exec tsc --noEmit` |
| Bundle Tauri de produção | `pnpm tauri build` |
| Preview do frontend buildado no browser | `pnpm preview` |

Não tem suite de testes nem comando de lint separado — `tsc --noEmit` (rodado dentro do `pnpm build`) é o check estático.

## Erro de assinatura no macOS ("app está danificado" / "não pode ser aberto")

Se você baixar uma **build não assinada** do metacodex (por exemplo um `.dmg` de uma release que não passou pela notarização da Apple), o Gatekeeper do macOS vai colocar o app em quarentena e recusar abrir com algo como:

> *"metacodex.app" está danificado e não pode ser aberto. Você deve movê-lo para o Lixo.*
>
> *"metacodex" não pode ser aberto porque o desenvolvedor não pode ser verificado.*

Isso **não é** corrupção — o macOS só removeu o app por causa do flag de quarentena. Arraste o metacodex pra `/Applications` primeiro, e rode **um** desses no Terminal:

```bash
# Recomendado — limpa TODOS os atributos estendidos (inclui com.apple.quarantine)
sudo xattr -cr /Applications/metacodex.app
```

Se isso sozinho não bastar (raro, mas acontece em certas versões do macOS quando o binário não tem assinatura nenhuma), assine ad-hoc por cima:

```bash
sudo codesign --force --deep --sign - /Applications/metacodex.app
```

Depois abra o metacodex normalmente. O mesmo truque vale pra qualquer app Tauri/Electron não assinado e é seguro — você está só removendo um flag de quarentena, não desativando o Gatekeeper no sistema inteiro.

> 🛈 Se você compilou o app você mesmo com `pnpm tauri build`, o `.app` resultante já roda direto de `src-tauri/target/release/bundle/macos/` sem esse erro. O workaround só vale pra builds baixadas de outro lugar.

## Onde as coisas ficam no disco

```
~/.metacodex/
├── settings.json          # prefs do usuário editáveis (tema, idioma, fontes, terminal, debounces, densidade)
├── keybindings.json       # só os atalhos diferentes do padrão
└── state/
    ├── projects.json       # roots de projetos registrados + lastActiveProjectId
    ├── resume.json         # sessões recentes de agente (podadas pros últimos 30 dias no boot)
    └── workspace/<id>.json # por projeto: abas abertas, aba ativa, paths expandidos
```

Tudo é JSON puro, com pretty-print e editável à mão. Escrita atômica (tmp → rename). **Terminais e abas de CLI não são persistidas de propósito** — shells não são respawnadas automaticamente no start do app.

## Arquitetura, em uma tela

```
+-----------------------------------+         +-----------------------------------+
|    React 19 + TypeScript (UI)     |  IPC    |       Rust + Tauri 2 (shell)      |
|-----------------------------------|<------->|-----------------------------------|
| Stores Zustand por feature        | invoke  | commands/  fs / git / pty / ...   |
| Editor CodeMirror 6               |  +      | PtyManager (portable-pty)         |
| xterm.js v5.5 + addon Canvas      | emit    | WatcherManager (notify)           |
| Diálogos / menus Radix            |         | ProjectsCache (Arc<RwLock<…>>)    |
| Tailwind + theming por tokens     |         | ensure_within_roots em todo FS    |
| react-i18next (en / pt-BR)        |         | git2 / grep-searcher / ignore     |
+-----------------------------------+         +-----------------------------------+
                                                            |
                                                            v
                                                   ~/.metacodex/  (JSON)
```

A fronteira é estrita: **Rust detém todo OS/IO; React detém renderização e estado efêmero de UI.** Nada em `src/` lê disco ou spawna processo diretamente — todo efeito colateral passa por um comando Tauri listado em `src/lib/ipc.ts::CMD` e registrado em `src-tauri/src/lib.rs::invoke_handler!`.

Segurança de path é centralizada: todo comando de filesystem chama `paths::ensure_within_roots(target, &roots)` antes de qualquer `fs::*`. `is_within` faz normalização lexical apenas — sem resolver symlink — então um link simbólico não consegue escapar do sandbox via realpath.

Pra tour completo veja [`CLAUDE.md`](./CLAUDE.md) e [`AGENTS.md`](./AGENTS.md).

## Contribuindo

1. Forke e crie branch a partir de `main`.
2. `pnpm install`, depois `pnpm tauri dev`.
3. Mantenha a fronteira Rust/TS limpa — nada de `fs::*` ou spawn de processo fora de um comando Tauri com roots-check.
4. Tokens são quem manda no visual; **nunca hardcode cor** em componente — passe por `src/styles/tokens.css`.
5. Toda string de UI passa por `t()` e tem que ser adicionada em **ambos** os arquivos de locale (`en` e `pt-BR`).
6. `pnpm build` (que roda `tsc --noEmit`) tem que passar antes de abrir PR.

O playbook longo — incluindo a regra de ordem de carga do xterm.js, a regra do `lineHeight = 1.0`, a regra de motion dos popups, e o layout de persistência do projeto — vive em [`CLAUDE.md`](./CLAUDE.md).

## Licença

[MIT](./LICENSE) © Victor.

---

<sub>Construído com Tauri 2, React 19, CodeMirror 6, xterm.js, libgit2 e muitos design tokens opinados.</sub>
