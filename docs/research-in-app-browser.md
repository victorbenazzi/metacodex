# Pesquisa: browser nativo no workbench direito

Status: implementado. Ver `components/browser/*`, `features/browser/*`, `src-tauri/src/commands/browser.rs`.
Data: 2026-08-19.

Objetivo: um browser embutido na coluna direita, no mesmo espírito do Cursor Design Mode e do in-app browser do Codex, sem inflar o bundle e sem ressuscitar a Agent View removida.

## O que Cursor e Codex realmente fazem

### Cursor

Fontes: [Design Mode](https://cursor.com/docs/agent/design-mode), [Browser tools](https://cursor.com/docs/agent/tools/browser).

- O browser abre como painel (Agents Window) ou janela separada.
- Design Mode (`Cmd+Shift+D`): clicar num elemento, desenhar na página, ou descrever a mudança.
- Ao clicar, o agente recebe dois sinais: identidade do elemento (xpath, atributos, estilos computados, e props da fiber tree do React) e um screenshot da região.
- O browser do agente também navega, clica, digita, captura tela, lê console e rede. Estado (cookies, localStorage, IndexedDB) persiste por workspace.
- Cursor é Electron. O motor é Chromium em todas as plataformas. Screenshot e inspeção passam por CDP / webview Chromium, não por um iframe.

### Codex (app desktop OpenAI)

Fonte: [In-app browser](https://developers.openai.com/codex/app/browser).

- Painel compartilhado entre usuário e agente (`Cmd+Shift+B`).
- Foco em localhost, previews e páginas públicas. Comentários visuais em elementos ou áreas.
- Perfil isolado: **não** herda cookies, abas nem extensões do Chrome do usuário. Login autenticado fica no browser normal ou na extensão Chrome (`@Chrome`).
- O app menciona import de perfil em Settings > Browser quando disponível no dispositivo. Isso é opt-in, não automático.

### O que isso implica no metacodex

Cursor e Codex têm um composer de chat que aceita chips e imagens. O metacodex não: o agente vive num PTY (`terminal` / `cli`). A ponte visual precisa ser arquivo em disco + texto no PTY, não um attachment de chat.

Já existe `sendToTerminal(text)` em `src/app/appCommands.ts`, que escreve no PTY focado. Claude Code e Codex CLI leem imagem pelo **caminho do arquivo** de forma confiável em todos os SOs. Paste de clipboard é frágil (macOS `Ctrl+V` ok, Windows nativo falha).

## Encaixe no shell atual

A coluna direita já é o lugar certo.

- Superfícies: `changes | files` em `sidePanel.store.ts`.
- Documentos: `editor | markdown | image | pdf | diff`, hospedados num sibling que permanece montado mesmo com `display:none` (`AppShell` `docHost`).
- Menu `+` em `WorkbenchNewMenu.tsx`.
- Portas em escuta já são coletadas por `pty_metadata_batch` (`lsof` no macOS, IP Helper no Windows) e ficam em `tabMetadata.store`.

Recomendação de produto: **nova superfície `browser`**, não um `TabKind` de documento na v1. Combina com o mockup (aba Browser ao lado de Changes). O webview nativo fica vivo fora do React, como o `docHost`.

Não usar iframe. O CSP de `tauri.conf.json` não permite `frame-src` arbitrário, e iframe cross-origin bloqueia inspeção, overlay e screenshot.

## Motor: o que "Chrome built-in" significa aqui

O metacodex é Tauri 2. O webview do SO já está no processo.

| Plataforma | Motor real | É Chromium? | Peso extra |
|---|---|---|---|
| macOS | WKWebView (WebKit) | Não | ~0 |
| Windows | WebView2 (Edge Chromium) | Sim | ~0 (runtime do SO) |
| Linux (futuro) | WebKitGTK | Não | ~0 |

Alternativas rejeitadas para v1:

- **CEF / Chromium embarcado**: Chromium real no macOS, mas +100 MB no bundle, atualizações de segurança próprias, foge do "leve".
- **Chrome instalado + CDP** (`--remote-debugging-port`): útil depois, para sessão autenticada do Chrome real. Depende do binário do usuário. Não é o preview padrão.
- **Playwright/puppeteer no sidecar**: pesado, processo extra, UI ruim para navegar à mão.

Recomendação: **webview filho nativo** (WKWebView / WebView2). No Windows isso *é* Chromium. No macOS é Safari, o mesmo trade-off de todo app Tauri. Perfil isolado via `WebviewBuilder::data_directory` (e `data_store_identifier` no macOS 14+). Sem IPC Tauri no filho.

A API de multiwebview do Tauri 2 está atrás da feature `unstable` (`Window::add_child` / `new Webview(...)`). `auto_resize` acompanha a **janela**, não a coluna CSS. Bounds precisam ser sincronizados a partir de um placeholder React (`getBoundingClientRect` + `setPosition` / `setSize` / `setVisible`). Esconder = `setVisible(false)` ou tamanho 0, **não** destruir: recarregar localhost a cada troca de aba mata o estado.

`Cargo.toml` hoje: `tauri = { version = "2", features = [] }`. Multiwebview exige `features = ["unstable"]`. Capabilities: o filho precisa de um label próprio em `default.json` (e **sem** permissões de FS/PTY).

## Peças nativas que o Tauri já oferece

Fonte: [`WebviewBuilder`](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html), [`Webview`](https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html).

- `navigate`, `eval` / `eval_with_callback`
- `on_navigation` (cancelar URL)
- `initialization_script` (overlay de Design Mode injetado em todo load)
- `data_directory`, `incognito`, `devtools`
- `cookies` / `set_cookie` / `delete_cookie` / `clear_all_browsing_data`

Screenshot nativo no wry **ainda não está no release estável** ([PR #1674](https://github.com/tauri-apps/wry/pull/1674), aberto em 2026-02, não mergeado). Caminho imediato: `with_webview` + API da plataforma.

- macOS: `WKWebView.takeSnapshot` (não pede permissão de Screen Recording)
- Windows: `ICoreWebView2.CapturePreview`

Fallback pior: `html2canvas` injetado (quebra em canvas, cross-origin, CSS complexo). Só como último recurso.

## Dev servers e recents (v1)

Não precisa varrer a máquina inteira. Já temos as portas dos PTYs vivos.

Fluxo:

1. Agregar `listeningPorts` de todas as sessões do projeto (`tabMetadata.store`).
2. Deduplicar por porta. Preferir `127.0.0.1` / `localhost` / `*`.
3. Heurística HTTP: 80, 443, 3000-3010, 4173, 4321, 5173, 5174, 8080, 8888, 1420, etc. Opcional: HEAD `http://127.0.0.1:{port}` com timeout curto no Rust.
4. Título: nome da tab/CLI que abriu a porta (`pnpm tauri dev` → `localhost:1420`).
5. Clique → `navigate` no webview filho.

Histórico recente: JSON em `~/.metacodex/state/browser-history.json` (atômico, mesmo padrão de `config_paths`). Campos: url, title, lastVisited, source (`typed | server | history`). A start page (HTML local, sem webview ainda, ou `about:blank` + chrome React) lista Servidores e Recents, como no mockup.

Importar **histórico do Chrome** é um SQLite separado (`History`), sem criptografia. No macOS exige Full Disk Access. Fazer depois, opt-in, e só URLs (não títulos de sites autenticados se o usuário recusar).

## Cookies: o pedaço difícil

Pedido: importar cookies (e histórico) do Chrome.

Fatos:

- Chrome guarda cookies em SQLite (`~/Library/Application Support/Google/Chrome/<Profile>/Cookies`). Valores vêm criptografados.
- macOS: chave `Chrome Safe Storage` no Keychain, AES-128-CBC (`v10`). O `security` CLI dispara prompt visível. Factível com consentimento.
- Windows Chrome 127+: App-Bound Encryption (`v20`). A chave está amarrada à identidade do Chrome. Outro processo **não** descriptografa de forma suportada. Não implementar bypass.

Codex deliberadamente **não** copia a sessão do Chrome. Cursor isola cookies por workspace.

Recomendação:

1. v1: perfil isolado. Usuário faz login no browser do metacodex quando precisar.
2. v1.5 macOS: "Importar cookies do Chrome" com diálogo de consentimento + prompt do Keychain. Copiar via `set_cookie` no webview filho. Sem senhas, sem cartões.
3. Windows: não importar cookies do Chrome. Oferecer (depois) "anexar ao Chrome aberto via CDP" com o usuário ligando debugging, ou login manual.
4. Alternativa honesta: importar arquivo Netscape/`cookies.json` que o usuário exportou.

Não ler o perfil do Chrome em silêncio. Não injetar no processo do Chrome.

## Design Mode: desenhar, clicar, mandar pro agente

Esta é a feature que justifica o browser. Espelhar Cursor/Codex no que o PTY permite.

### Selecionar componente

`initialization_script` instala um overlay (só com Design Mode ligado):

1. `mousemove`: highlight no `elementFromPoint`.
2. `click` (preventDefault): coletar payload compacto.
3. Payload: css selector estável, xpath, tag, id, classes, `innerText` truncado, `outerHTML` truncado (~2 KB), rect, estilos computados relevantes, URL atual.
4. Bônus React: se `__REACT_DEVTOOLS_GLOBAL_HOOK__` existir, tentar nome do componente e `debugSource` (arquivo + linha). Sem isso, o agente ainda tem screenshot + seletor.

### Screenshot

1. Snapshot nativo do viewport.
2. Recortar pelo rect do elemento (com padding).
3. Compor anotações (setas, caixa, scribble) se o modo desenho estiver ativo.
4. Gravar PNG atômico em `~/.metacodex/state/browser-captures/{id}.png`.
5. Podar arquivos com mais de N dias.

### Desenhar

Overlay SVG/canvas **dentro do webview filho** (z-order). Ferramentas mínimas: caixa, seta, pen, texto curto. O desenho entra no PNG composto. Comentário de texto vai no bloco enviado ao PTY.

Não tentar overlay React por cima do webview filho: o webview nativo fica acima do HTML da janela principal.

### Entrega ao agente

O caminho confiável:

```
sendToTerminal(
  [
    "Visual context from in-app browser",
    `url: ${url}`,
    `element: ${selector}`,
    component ? `component: ${component} (${file}:${line})` : null,
    `screenshot: ${absolutePngPath}`,
    note ? `note: ${note}` : null,
  ].filter(Boolean).join("\n")
)
```

Claude Code e Codex CLI tratam o path como attachment. `sendToTerminal` já foca a sessão running do projeto. Se não houver CLI aberto, o prefill atual abre um terminal com o texto.

Não mandar o PNG em base64 no PTY (estoura o buffer, TUIs quebram). Não depender de clipboard image.

## Segurança

- Webview filho **sem** IPC Tauri. Sem `core:default` de FS. Label dedicado nas capabilities.
- Perfil em `~/.metacodex/state/browser-profile/`, nunca o data dir do app.
- `on_navigation`: permitir `http(s)`, `localhost`, `127.0.0.1`. Bloquear `file://` e schemes do app.
- Overlay injetado não lê o cookie jar; o Rust controla import.
- Capturas ficam em state local, não no repo do projeto (evita commit acidental).
- A Agent View removida **não** volta. Isto é um preview no workbench + texto no PTY do CLI já existente.

## Peso e performance

- Um webview filho extra: WKWebView/WebView2 já estão no SO. Custo real é RAM da página aberta (igual a uma aba Safari/Edge).
- Manter **um** webview na v1 (não um por URL). Troca de URL = `navigate`, não novo processo.
- Não criar o webview no boot: só ao abrir a superfície Browser.
- Bounds: rAF / ResizeObserver no placeholder, throttle durante drag do `ResizeHandle` (já existe flag `resizing` no `AppShell`).
- Não `fit` / não pintar quando invisível (mesmo cuidado do xterm).

## Fases sugeridas

### P0. Superfície Browser

- `RightWorkbenchTab` ganha `"browser"`.
- Chrome React: back, forward, reload, address bar, start page (Servidores + Recents).
- Webview filho posicionado no placeholder abaixo do chrome.
- Dev servers a partir de `tabMetadata`. Recents persistidos.
- Sem Design Mode ainda.

### P1. Contexto para o agente (o pedaço importante)

- Design Mode: picker + snapshot nativo + crop.
- Grava PNG e chama `sendToTerminal` com path + metadados.
- Atalho próprio (não `Cmd+Shift+D`, já é o log de diagnósticos).

### P2. Desenhar

- Overlay de anotação, composto no PNG.

### P3. Import (opt-in)

- Histórico Chrome (SQLite, Full Disk Access).
- Cookies Chrome no macOS com prompt do Keychain.
- Windows: login no webview, ou CDP depois.

## Riscos

- Feature `unstable` do Tauri pode mudar API.
- WKWebView ≠ Chrome: sites que exigem Chromium (alguns dashboards, DRM) vão falhar no macOS. Mitigação futura: "Abrir no Chrome" / CDP.
- Screenshot via `with_webview` é código por plataforma, não uma linha do Tauri.
- Multiwebview no Windows já teve bugs de bounds/branco no load. Precisa de smoke test ao redimensionar a coluna.
- Injetar script em páginas third-party é esperado para Design Mode, mas deve estar desligado no browse normal.

## Fora de escopo (v1)

- Agente controlando o browser sozinho (click/type automatizados estilo Cursor MCP).
- Extensões Chrome.
- Várias abas de browser nativas.
- CEF.
- Ressuscitar Agent View, chat, MCP registry, cron.
