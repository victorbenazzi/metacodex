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
[![Desktop](https://img.shields.io/badge/Desktop-macOS%20%7C%20Windows%20%7C%20Linux-26251e)](#requisitos)

[English 🇺🇸](./README.md)

</div>

---

<div align="center">
  <img src="./public/preview.png" alt="metacodex — explorador de arquivos, tela inicial e o launcher de CLIs de IA" width="900">
</div>

## O que é o metacodex?

metacodex é um app desktop que coloca **árvore de arquivos, editor, terminal e seu agente de IA na mesma janela**, sem abrir mão das coisas que dev de verdade depende (PTY real, `$SHELL -l` real, git real, seu `.zshrc`).

A base é uma **shell Tauri 2** — um núcleo Rust pequeno que detém todo I/O do sistema (PTY, filesystem, busca, watcher, git) — e um frontend **React 19 + TypeScript** que é puramente UI e estado. Tudo é **local-first**: sem auth, sem round-trip pra nuvem, sem telemetria. Configurações, projetos e estado por workspace ficam como JSON editável à mão em `~/.metacodex/`.

A sensação é mais próxima de Linear / Raycast do que de uma IDE Electron tradicional: theming via tokens, um único fade de opacidade pra todo popup, focus rings nativos e uma barra de abas que não vaza chrome de browser.

## Download & instalação

Baixe o instalador da sua plataforma na [release mais recente](https://github.com/victorbenazzi/metacodex/releases/latest):

| Plataforma | Download | Instalação |
|---|---|---|
| macOS Apple Silicon | `metacodex_*_aarch64.dmg` | Arraste o app para `/Applications` |
| macOS Intel | `metacodex_*_x64.dmg` | Arraste o app para `/Applications` |
| Windows x64 | `metacodex_*_x64-setup.exe` ou `.msi` | Execute o instalador |
| Debian / Ubuntu x64 | `metacodex_*_amd64.deb` | `sudo apt install ./metacodex_*_amd64.deb` |
| Fedora / RPM x64 | `metacodex-*.x86_64.rpm` | `sudo dnf install ./metacodex-*.x86_64.rpm` |

Sem conta e sem wizard de setup. As builds de macOS não são notarizadas, e as de Windows ainda não possuem assinatura de código.

> [!WARNING]
> O Gatekeeper do macOS bloqueia o DMG atual antes da montagem porque a build usa uma assinatura própria e não foi notarizada pela Apple. Siga as [instruções do Gatekeeper no macOS](#aviso-do-gatekeeper-no-macos) antes da primeira abertura.

## Auto-update

A partir da **v0.0.3**, as builds de macOS e Windows podem se atualizar sozinhas. Logo após abrir, o app consulta o `latest.json` deste repo; quando aparece uma versão nova, surge a pill azul **Update** no chrome central. Um clique baixa o payload, verifica a assinatura contra a chave pública embutida, instala e reabre o app. Pacotes Linux `.deb` e `.rpm` são atualizados pelo fluxo de instalação do sistema.

> [!NOTE]
> Se o macOS colocar o aplicativo em quarentena novamente após um update interno, siga as mesmas [instruções do Gatekeeper](#aviso-do-gatekeeper-no-macos). Uma versão futura assinada com Apple Developer ID e notarizada pela Apple eliminará essa etapa adicional.

## Versão Legacy

O produto publicado antes da reconstrução do workspace 1.0 continua disponível como [Legacy v0.0.19](https://github.com/victorbenazzi/metacodex/releases/tag/v0.0.19). O código está congelado na branch [`legacy/v0`](https://github.com/victorbenazzi/metacodex/tree/legacy/v0). As tags e os artefatos antigos permanecem intactos.

## Por que existe

| Dor | Resposta do metacodex |
|---|---|
| CLIs de IA são ótimas isoladamente mas péssimas como workspace | **Abas de PTY** de primeira classe pra Claude Code, Codex CLI, OpenCode, Grok Build, MiMo Code, Antigravity e Pi. Elas são lançadas via `$SHELL -l -i -c` pra preservar o PATH do `mise`, `nvm` e `.zshrc`. |
| IDE Electron é pesada, lenta pra abrir, frágil em resize | Shell nativa Tauri 2, binário de ~dezenas de MB, cold start instantâneo. |
| "Abrir no terminal" é troca de contexto | Terminal e editor vivem na **mesma barra de abas**, agrupados por projeto. |
| Configurações na nuvem dessincronizam | JSON puro em `~/.metacodex/`. Edite no vim se quiser. |
| Watcher, busca e git reinventados por app | Um `notify` debouncado por projeto, busca nível ripgrep via `grep-searcher`, `libgit2` via `git2`. |

## Funcionalidades

### Workspace
- **Shell de três superfícies** com projetos e sessões ao vivo à esquerda, processo ativo no centro e workbench persistente à direita.
- **Colunas redimensionáveis e recolhíveis** que mantêm terminais e documentos montados enquanto estão ocultos.
- **Histórico por projeto** para sessões recentes de agentes (`resume.json`).
- **Command palette** (`Cmd+Shift+P`) pra comandos e arquivos.
- **Temas Porcelain e Graphite** com densidade compacta, confortável ou espaçosa.

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
- Launcher de um clique pra qualquer CLI do registry (`cli-registry.ts`): Claude Code, Codex CLI, OpenCode, Grok Build, MiMo Code, Antigravity e Pi.
- **Status de agente** por aba (`idle | working | needs-attention | done`) via parsing de OSC + heurística; pule pro próximo "needs-attention" com `Cmd+Shift+U`.
- **Tooltip de aba** com branch, cwd e portas em escuta (pollado do Rust).
- Notificação do sistema operacional + som quando o agente termina ou precisa de você.

### Source Control
- Painel SCM à direita, baseado em `libgit2`.
- **Worktrees** — listar, criar, trocar e fazer merge no mesmo painel.

### Browser de projeto
- Browser nativo dentro do app para servidores de desenvolvimento detectados e arquivos locais autorizados.
- Selecione elementos, desenhe anotações e capture regiões precisas.
- Envie DOM e contexto visual direto para o agente de código ativo.
- Perfil isolado, mensagens autenticadas e controle de caminhos pelos roots do projeto.

### Configurações & Atalhos
- JSON puro em `~/.metacodex/settings.json` e `~/.metacodex/keybindings.json` (este último guarda só os overrides).
- Fonte do editor & terminal, scrollback, sticky headers, debounces, densidade de UI (compact / comfortable / spacious — alimenta cada `--space-*` via `calc()`).
- Todos os atalhos são reconfiguráveis (`Cmd+,` → Keybindings, ou edite o JSON).
- Tema: light / dark / sistema. Por padrão segue o `prefers-color-scheme`.

### Internacionalização
- Inglês (padrão) e Português brasileiro de fábrica (`react-i18next`).
- Toda string de UI passa por `t()` — nunca hardcoded.

## Requisitos

O metacodex 1.0 cobre macOS, Windows x64 e Linux x64 na mesma base Tauri. A captura do browser usa WKWebView no macOS, WebView2 no Windows e WebKitGTK no Linux.

Pra rodar a partir do código você precisa de:

| Ferramenta | Por quê |
|---|---|
| **Sistema desktop suportado** | macOS 12+, Windows 10/11 x64 ou uma distribuição Linux x64 moderna com WebKitGTK 4.1 |
| **Ferramentas da plataforma** | Xcode CLT no macOS, MSVC Build Tools no Windows ou dependências de sistema do Tauri no Linux |
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
# Gera o bundle nativo do sistema operacional atual
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
| Testes unitários do frontend | `pnpm test` |
| Checks e testes Rust | `cargo check` / `cargo test` em `src-tauri/` |
| Bundle Tauri de produção | `pnpm tauri build` |
| Preview do frontend buildado no browser | `pnpm preview` |

Não existe um comando separado de lint para o frontend. TypeScript, Vitest, formatação Rust, Clippy, testes Rust e rastreabilidade de especificação rodam na matriz de qualidade do GitHub Actions.

## Aviso do Gatekeeper no macOS

A build atual do macOS usa uma assinatura própria, não foi assinada com Apple Developer ID e não foi notarizada pela Apple. Por isso, o Gatekeeper pode bloquear o DMG antes da montagem com uma mensagem como:

> *A Apple não pôde verificar se "metacodex_1.0.0_aarch64.dmg" está livre de malware que pode danificar o Mac ou comprometer sua privacidade.*

A Apple não revisou esta build. Continue somente se você baixou o DMG na [release oficial do metacodex](https://github.com/victorbenazzi/metacodex/releases/tag/v1.0.0).

### Recomendado: autorize nos Ajustes do Sistema

1. Clique duas vezes no DMG uma vez e feche o aviso.
2. Abra **menu Apple > Ajustes do Sistema > Privacidade e Segurança**.
3. Role até **Segurança** e clique em **Abrir Mesmo Assim**. A Apple disponibiliza essa opção por aproximadamente uma hora após a tentativa bloqueada.
4. Confirme **Abrir**, monte o DMG e arraste `metacodex.app` para `/Applications`.

Esse é o procedimento de exceção documentado pelo [Suporte da Apple](https://support.apple.com/pt-br/102445).

### Alternativa pelo Terminal

Primeiro confira o checksum SHA-256 do arquivo baixado:

| Mac | Arquivo | SHA-256 esperado |
|---|---|---|
| Apple Silicon | `metacodex_1.0.0_aarch64.dmg` | `859521bc39f023768c244d00cac9135a34eb42474715b7e15e328839819ff5f6` |
| Intel | `metacodex_1.0.0_x64.dmg` | `fdbd4154754d36859f72a5f024e7b498575f1bf52747a15a4e10d90e001b0fc4` |

```bash
shasum -a 256 "$HOME/Downloads/metacodex_1.0.0_aarch64.dmg"
```

Se o checksum for igual, remova a quarentena somente desse DMG e abra o arquivo:

```bash
xattr -d com.apple.quarantine "$HOME/Downloads/metacodex_1.0.0_aarch64.dmg"
open "$HOME/Downloads/metacodex_1.0.0_aarch64.dmg"
```

Quem usa Mac Intel deve substituir `aarch64` por `x64`. Depois da montagem, arraste `metacodex.app` para `/Applications`. Se o Gatekeeper também bloquear o aplicativo copiado, execute:

```bash
sudo xattr -dr com.apple.quarantine "/Applications/metacodex.app"
open "/Applications/metacodex.app"
```

Esses comandos removem a quarentena somente do arquivo especificado do metacodex. Eles não desativam o Gatekeeper no sistema.

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
