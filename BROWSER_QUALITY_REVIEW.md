# Review de qualidade: browser in-app

Status do baseline: **não aprovado** para crescer em cima desta forma.
Data: 2026-08-20
Baseline revisado: `5fa6982be2716073fa8b4f6713aa639bbb6ab615` mais as mudanças iniciais ainda não commitadas.
Escopo do baseline: implementação em `wip/v3-shell` (`components/browser/*`, `features/browser/*`, `src-tauri/src/commands/browser.rs`, `browser_capture.rs`, `browser_init.js`, e os encaixes em `AppShell`, `RightWorkbench`, IPC e capabilities).
Barra: review de qualidade estrutural. Comportamento "funciona no macOS" não é critério de aprovação.

Este documento é o briefing para o Codex. Não é um catálogo de nits. Cada item pede um reframe que apaga complexidade, não um polimento da forma atual.

## Status da correção

Os bloqueios descritos abaixo foram tratados na implementação que acompanha este documento. O texto original foi preservado como registro do baseline revisado. A correção substitui o ping-pong por payload autenticado e validado em Rust, centraliza e serializa o modo no host, espera a confirmação de composição do webview filho antes do snapshot, remove overlays React sobre o preview nativo, decompõe o painel e troca testes de grep por testes comportamentais. Os limites vigentes são 8.192 bytes para a URL da página, 1.024 bytes para o título e 32 KiB para a URL percent-encoded da ponte.

---

## Veredito

O browser acerta o recorte de produto: superfície no workbench direito, um webview filho isolado, sem iframe, sem Agent View, screenshot nativo, entrega por path no PTY. Isso está alinhado com `docs/research-in-app-browser.md`.

A implementação **não** está alinhada com a qualidade do restante do shell. O protocolo de pick/capture é um ping-pong que a página pode adulterar. O modo vive em três lugares. O painel React é um orquestrador. O z-order do webview nativo fura menus, tooltips e toasts. Os testes caracterizam o fonte com `toContain`, não o comportamento.

Não empilhar recents, fila de anotações, freeze de animação, import de cookies ou screenshot Windows **em cima deste desenho**. Primeiro colapsar o protocolo e o dono do modo. Depois, e só depois, voltar funcionalidade.

---

## Mapa da feature (o que existe hoje)

### Superfície

- Aba `browser` no workbench direito (`RightWorkbenchTab`), ao lado de Changes e Files.
- Atalhos: `Mod+Shift+B` abre, `Mod+Alt+M` expande.
- Start page React (webview escondido) lista listeners localhost do projeto ativo.
- Página viva: webview filho `preview-browser` posicionado no placeholder.
- Expandido: coluna vira `fixed inset-0`; o piso do centro cai de 280px para 72px.

### Modos

`browse | pick | draw | capture`

- **pick:** overlay na página, `[` / `]` sobe/desce ancestral, clique envia contexto + PNG do rect.
- **draw:** canvas laranja na página, dock React embaixo (webview encolhe 52px), envia viewport com o traço.
- **capture:** arraste uma região, double-rAF, PNG recortado.
- Contexto compacto (padrão) ou diagnóstico, no menu "mais".

### Runtime nativo

- Tauri 2 `unstable` + `Window::add_child`.
- Perfil em `~/.metacodex/state/browser-profile/`.
- Capturas em `~/.metacodex/state/browser-captures/` (máx. 8, 24h, write atômico).
- Filho **sem** label nas capabilities (`default.json` só `main`).
- Navegação: só `http` / `https` / `about`. `file`, `data`, `javascript` e o host da ponte são bloqueados.
- `target=_blank` permitido vira `navigate` no mesmo webview.
- Screenshot: `WKWebView.takeSnapshot` no macOS. Windows ainda retorna erro.
- Ponte página -> Rust: `window.open("https://mcx.invalid/...?token=...")`, interceptado em `on_navigation` / `on_new_window`.

### Entrega ao agente

`sendVisualToCli` escolhe o último CLI focado e running do projeto ativo, escreve no PTY, só então ativa a aba. Sem CLI: erro localizado. Não escreve em shell puro.

### O que foi cortado de propósito

A pesquisa pedia recents em `browser-history.json`. Os testes atuais **proíbem** recents. Não ressuscitar no mesmo PR de qualidade. Fila de anotações, freeze, import de Chrome e CDP também ficam fora até o núcleo estar simples.

---

## O que está sólido (não desfazer)

1. **Fronteira de processo.** React não fala com disco nem spawna processo. Comandos passam por `CMD` / `invoke_handler`. Eventos passam por `events.rs` / `events.ts`.
2. **Filho sem IPC Tauri.** O label `preview-browser` não está em `capabilities/default.json`. A ponte por URL é a consequência correta disso.
3. **Token da ponte.** 128 bits, no closure do script injetado, rotacionado na criação do webview. Não vai para `window`, DOM, `localStorage`.
4. **Navegação sem poll.** `pushState` / `replaceState` / `popstate` / `hashchange` / `load` publicam `browser://navigated`. O painel não chama `currentUrl()` em intervalo.
5. **Eval assíncrono com timeout.** `eval_now` usa oneshot + `tokio::time::timeout(3s)`. O teste de "eval lenta não bloqueia outra task" cobre o contrato REQ-020 / NFR-005.
6. **Snapshot nativo.** `setAfterScreenUpdates(false)` evita o flash do WKWebView. Crop com pad de 8px. Write atômico. Prune no boot e após capture.
7. **Start page a partir de metadata que já existe.** `serversFromSessions` não varre a máquina. Filtra loopback, projeto ativo, PID>0.
8. **`killProcess` não é um kill solto.** `pty_kill_process` só termina PID da árvore da sessão.
9. **Escape e clique exigem `isTrusted`.** Conteúdo carregado não despacha comando global (`dispatchBindingFromChild` foi removido).
10. **Painel permanece montado** com `display:none`, no mesmo espírito do `docHost`. O webview é escondido, não destruído.

Esses pontos são o núcleo que o reframe tem de preservar.

---

## 1. Blocker: o protocolo pick/capture é um ping, depois um eval na página

Este é o problema que, se resolvido, apaga uma categoria inteira de código.

Fluxo atual de pick:

1. JS na página grava `pendingPick` e abre `https://mcx.invalid/selection?token=...`.
2. Rust valida token + modo e emite `browser://picked` **vazio**.
3. React chama `browser_take_pick`.
4. Rust faz `eval("window.__mcx.takePick()")` e faz parse frouxo do JSON.
5. React tira screenshot, formata, escreve no PTY.

Capture de região é o mesmo desenho com `pendingCapture` / `takeCaptureRegion`.

Por que isso é a forma errada:

- **A página controla o payload.** `window.__mcx` está no `window`. Qualquer script da página pode trocar `takePick` e devolver JSON no shape de `BrowserPick`. O host confia. O PNG é nativo, o texto que vai para o agente não é.
- **Dois hops onde um basta.** Localização **já** manda `url`, `title` e `loading` na query autenticada. Pick e capture não. O código trata os três eventos da ponte como se fossem iguais, mas dois deles são só um toque no ombro.
- **Parse silencioso.** `serde_json::from_str(&raw).unwrap_or(Null)` e depois `.ok()` em `from_value`. Shape inválido vira `None`. O usuário clica e nada acontece. Sem erro, sem log.
- **Estado pendente na página.** `pendingPick` / `pendingCapture` existem só para sobreviver ao round-trip. Race: segundo clique, Escape no meio, página navegando.
- **Dois comandos IPC que não precisavam existir:** `browser_take_pick`, `browser_take_capture_region`.

### Movimento de judo

Colocar o payload no mesmo canal autenticado que `location` já usa. Apagar o eval de leitura.

Contrato alvo:

```
página  ->  https://mcx.invalid/{selection|capture}?token=...&<campos>
Rust    ->  valida token, modo, scheme, tamanho, campos conhecidos
Rust    ->  emite browser://picked { pick }  ou  browser://capture-selected { rect }
React   ->  tira PNG, formata, envia. Sem takePick. Sem takeCaptureRegion.
```

Regras do payload (espelhar `location`):

- Só campos allowlisted.
- Sem campo duplicado.
- Caps de bytes por campo (já existem 512 / 240 / 640 no formatter; subir isso para a ponte).
- URL total <= 8 KiB (já é `MAX_BRIDGE_URL_BYTES`).
- `kind` como enum, não `String`.
- Rect com números finitos, width/height >= 8.

O que some se isso for feito direito:

- `pendingPick`, `pendingCapture`
- `browser_take_pick`, `browser_take_capture_region`
- `eval_now` nesses dois caminhos
- o `unwrap_or(Null).ok()` que engole erro
- o listener React que "busca" o que a página já tinha

`eval` continua existindo só para **empurrar** modo e limpar desenho (`setMode`, `clearDraw`). A página deixa de ser a fonte da verdade do pick.

`window.__mcx.takePick` / `takeCaptureRegion` não devem existir. Se a página precisa guardar algo entre o clique e o `window.open`, que seja local ao handler, serializado na hora, sem API no `window`.

Risco residual a documentar, não a "resolver" com mais magia: a URL da ponte passa por `window.open`, então um `performance` entry ou um hook agressivo em `open` pode ver o token. Mitigação suficiente: token 128-bit, uma mensagem por gesto `isTrusted`, payload allowlisted. Não girar um custom protocol agora.

---

## 2. Blocker: o modo tem três donos

Cópias hoje:

| Lugar | Tipo | Quem escreve |
|---|---|---|
| `useBrowserUiStore.mode` | `BrowserMode` | React, otimista, **antes** do IPC |
| `BrowserState.mode` | `Mutex<String>` | Rust; string solta; valor desconhecido vira `"browse"` |
| `state.mode` em `browser_init.js` | string | `setMode` via eval, **e** o próprio JS no Escape e no `onUp` de capture |

Sintomas concretos:

- `changeMode` no painel faz `setMode(next)` e só então `browserApi.setMode`. Se o IPC falha, a UI mostra pick e o overlay na página não liga. O `console.warn` é o único rastro.
- Escape na página seta `state.mode = "browse"` **antes** do host. Capture faz a mesma coisa e ainda esconde o overlay para o PNG não trazer a caixa. Motivo real, dono errado.
- Pick sai do modo **antes** de enviar (`await changeMode("browse"); await sendPickToAgent(...)`). Falha de PTY deixa o modo em browse. REQ-025 pedia manter o modo em falha. Screenshot de viewport respeita. Pick e região não. Três fluxos, três políticas.
- `browser_set_mode` não rejeita modo inválido. Engole e grava `"browse"`.

### Movimento de judo

Rust é o dono. Um enum. React manda intenção. JS só espelha.

```rust
enum BrowserMode { Browse, Pick, Draw, Capture }
```

- IPC `browser_set_mode` rejeita valor fora do enum (`AppError::InvalidArgument`), não faz fallback.
- Evento `browser://mode` (ou campo no estado que o frontend já consulta) para o store espelhar.
- JS **não** atribui `state.mode` sozinho. Escape e fim de capture mandam a mensagem autenticada. Rust decide. Rust dá `setMode` de volta por eval.
- Esconder overlay antes do snapshot de região é uma operação explícita do host: `setMode(Browse)` -> espera ack curto -> `capture`. Não um atalho no `onUp` da página.
- Falha de envio **não** troca o modo. Sucesso volta para `browse`. Um único sítio, no controller de entrega, não em três listeners.

Isso apaga a família de `if (mode !== "browse")` espalhada no painel.

---

## 3. Blocker: z-order do webview nativo fura a chrome React

O research já avisava: o webview filho fica **acima** do HTML da janela. O código trata isso em um caso (dialogues globais via `overlayLock` escondem o webview) e ignora os outros.

O placeholder nativo cobre só a área abaixo da barra de 36px. Tudo que a chrome pinta para baixo entra no retângulo do filho e some.

Quebra hoje:

- Dropdown de screenshot (viewport / região) abre para baixo. Fica sob o webview. O usuário não consegue escolher região sem um milagre de colisão do Radix.
- Dropdown "mais" (contexto compacto/diagnóstico, abrir externo, home). Mesmo furo.
- Tooltips `side="bottom"` dos botões da barra. Mesmo furo.
- Toasts globais são `fixed bottom-16px right-16px z-[1000]` no webview **principal**. O filho nativo ignora z-index. Com o browser aberto na coluna direita, o toast de "enviado ao agente" cai em cima do preview e não aparece. O teste `does not hide the native webview while browser feedback toasts are visible` **cristaliza o bug**: proíbe esconder, não oferece outro canal.

O dock de desenho funciona porque **encolhe o webview** (`BROWSER_DRAW_DOCK_H`). Esse é o padrão que o resto recusou seguir.

### Movimento de judo

Uma política só: *nada de overlay React sobre o retângulo nativo*.

Opções, em ordem de preferência:

1. **Chrome compacta sem dropdown para baixo.** Screenshot vira dois botões na barra, ou um split que abre **para cima** / para o lado, dentro da faixa de 36px + header. Contexto compacto/diagnóstico vira toggle, não menu. Home e "abrir externo" cabem como `IconButton`. Apaga o Radix que compete com o filho.
2. **Feedback de envio na própria chrome do browser** (texto de um linha na barra, 2s). Não usar `useToastStore` para o ciclo pick/capture/draw. O toast global continua para o resto do app. O teste que hoje trava o overlayLock contra toasts vira: "entrega visual não usa toast global".
3. Se ainda restar um menu, o open/close dele liga o mesmo mecanismo do draw dock: encolher o webview enquanto o menu está aberto. Não `overlayLock` global (isso apaga a página inteira e pisca).

Não "aumentar z-index". Não "portal para `document.body`". Isso já está feito e não atravessa superfície nativa.

---

## 4. `BrowserPanel` é o orquestrador que não deveria existir

586 linhas, um componente. Faz:

- chrome (back/forward/reload, address, pick, draw, capture, expand, menus)
- sync de bounds (rAF + ResizeObserver + overlay lock + dock)
- listeners da ponte (nav, pick, capture, escape)
- navegação + validação de URL
- captura + formatação + entrega + toasts
- stop de processo via `ptyApi.killProcess`
- expand/collapse

Isso viola a regra do repo: componente não atravessa stores nem dispara efeito de PTY. O painel fala com `useBrowserUiStore`, `useToastStore`, `ptyApi`, `invoke(CMD.openExternalUrl)` e quatro stores via `useBrowserRuntimeContext`.

Não é só "extrair hooks". Se o protocolo do item 1 e o dono do modo do item 2 existirem, metade desses `useEffect` some. O que sobra cabe em três peças chatas:

| Peça | Responsabilidade |
|---|---|
| `useBrowserHost` | bounds, hide, overlay lock, dock offset. Um `ResizeObserver`. |
| `browserDelivery.ts` | `sendScreenshot`, `sendPick`, toasts **ou** status na chrome, política de modo pós-envio. Um sítio para REQ-024/025. |
| `BrowserChrome.tsx` | barra, address, botões. Sem IPC direto além de `onBack` / `onGo` / `onMode`. |

`sendPickToAgent` hoje vive no fundo de `BrowserPanel.tsx` e duplica o switch `no-cli | failed | sent` de `sendScreenshot`. Depois do reframe, uma função.

`browserApi.currentUrl` e o comando `browser_url` ficam mortos no painel (o teste até proíbe `currentUrl()`). Ou o host usa na recuperação de crash, ou sai do `CMD` e do `invoke_handler`. Não deixar API zumbi.

`identity.ts`: `serverForUrl` / `portOfUrl` só aparecem em teste. Restos de recents. Apagar com os recents, não deixar helper órfão.

---

## 5. Feature logic vazou para o `AppShell`

`AppShell.tsx` conhece o browser demais:

- `CENTER_FLOOR` 280 vs `CENTER_FLOOR_BROWSER` 72
- `browserExpanded && "fixed inset-0 z-30 bg-canvas"`
- resize handle desliga quando expandido
- `ShellToggles` some quando expandido + view browser

`RightWorkbench` recalcula `expanded` com uma fórmula **parecida e não igual**:

```ts
// AppShell
browserWantsExpand && panelView === "browser" && panelOpen && !activeDocTabId

// RightWorkbench
wantsExpand && surface === "browser" && !showingDoc
```

Dois predicados, um layout. Vai divergir.

### Movimento de judo

Um predicado no shell, derivado uma vez:

```ts
type WorkbenchLayout = "column" | "browserOverlay"
```

Quem decide: `sidePanel.view`, `browser.expanded`, `activeDocId`. `AppShell`, `RightWorkbench` e `ShellToggles` leem isso. Sem `if (browser)` espalhado. Expandir browser deixa de ser um caso especial de grid e vira um modo de layout, no mesmo espírito de `shellFocus`.

Não criar um store novo se `sidePanel` + `browser.ui` já têm os bits. Criar um seletor. O bug é a duplicação, não a falta de framework.

---

## 6. Fronteira de tipos e camadas

Estes não são nits. Eles sustentam o ping-pong e o modo triplicado.

- **`BrowserMode` e `BrowserPick` existem duas vezes**, com contratos diferentes. Rust: `kind: String`, `mode: Mutex<String>`. TS: unions. Não há schema compartilhado. O parse `.ok()` esconde o drift.
- **`DevServer` vive em `browser.service.ts`**, o arquivo de IPC. Não é um tipo de comando. Mover para `devServers.ts`.
- **`formatVisualContext` vs `formatPickContext` vs o array literal em `sendScreenshot`.** Três jeitos de montar o bloco "Visual context from in-app browser". Um builder, um header, um `target: element | text | region | viewport`.
- **`normalizeBrowserUrl` aceita qualquer scheme com `://`.** `file://` e `javascript://` passam no frontend e só morrem no Rust. O address bar deveria recusar o que `is_allowed_url` recusa. Uma função, dois lados, ou o frontend importa o predicado (hoje ele só existe em Rust). Duplicar o predicado em `url.ts` e testar os mesmos casos que `browser.rs` já testa.
- **Caps da spec vs código.** Spec: URL 8192, title 1024. Ponte: URL 4096, title 512, URL total 8192. Escolher um número, documentar no validador, testar o número real.
- **`about:` é permitido por scheme.** `is_blank_href` trata qualquer `about:` como blank. `about:srcdoc` cairia nesse balde. Fechar: allowlist `about:blank` só.

---

## 7. `browser_init.js` é um runtime de 552 linhas sem teste real

Um IIFE com overlay, pick, draw, capture, history hook, React fiber walk, Shadow DOM, breadcrumb. Injetado como string. Os testes **leem o arquivo** e procuram substrings (`toContain('bridge("capture")')`, `toContain("function deepElementFromPoint")`).

Isso não trava comportamento. Trava a existência de um identificador. Refactor que extraia `deepElementFromPoint` e quebre o grep "passa".

Não precisa de um bundler no guest. Precisa de funções testáveis **antes** do wrap:

1. Extrair predicados puros (cssPath, targetAtDepth, collectPick shape, isTextTarget) para um módulo com testes. O IIFE injetado chama esses nomes, ou o arquivo gerado concatena. Mesmo que o ship continue sendo um único `include_str!`, a lógica deixa de viver só dentro do envelope.
2. O mínimo aceitável se a extração for cara: um teste Node que faz `vm.runInNewContext` do IIFE com um DOM mínimo e exercita `collectPick` / ancestor. Grep deixa de ser a suíte.

Hardcode `#f54e00` no guest é aceitável (a página não tem os tokens). Uma constante no topo do IIFE, não cinco cópias mágicas.

`window.__mcxInstalled` e `window.__mcx` no objeto da **página** são a superfície de ataque do item 1. Depois do reframe, o objeto no `window` só precisa de `setMode` e `clearDraw` (o host empurra). Quanto menor, melhor.

---

## 8. Testes: teatro de caracterização

O que existe e vale:

- `url.test.ts`, `devServers.test.ts`, `context.test.ts`, `sendToAgent.test.ts`, `identity.test.ts` (parte): testes de verdade.
- Rust: allowlist de URL, token, campos desconhecidos, payload grande, modo capture.
- `prune_caps_newest` em `browser_capture.rs`.

O que não vale como prova:

- `browserBridge.test.ts` inteiro: `readFileSync` + `toContain`.
- `BrowserPanel.test.tsx` inteiro: idem. "write failure preserves mode" não instancia o painel e não falha o pick, que **não** preserva o modo.
- `KeyboardShortcuts.test.tsx` "browser content cannot dispatch": só garante que o identificador `dispatchBindingFromChild` não voltou.

O spec de reliability pediu esses greps como pin. Eles viraram a suíte. Para o reframe dos itens 1 e 2, **trocar** os greps de protocolo por testes do validador Rust com payloads de selection/capture, e um teste do delivery que cobre os três `SendVisualResult` sem montar o painel.

Não acrescentar mais `readFileSync` no painel.

---

## 9. Buracos de produto que o desenho atual torna piores

Não são o foco deste review, mas o Codex não deve "aproveitar" o PR de qualidade para enfiá-los no painel.

| Buraco | Por que esperar |
|---|---|
| Screenshot Windows (`CapturePreview`) | Hoje qualquer pick/capture no Windows falha no PNG e o pick ainda manda texto. Implementar **depois** do payload na ponte, no mesmo `capture_png`. |
| Recents / `browser-history.json` | Cortado de propósito. Volta como módulo de persistência, não como estado no `BrowserPanel`. |
| Porta que não é HTTP | Start page mostra 5432/6379 se o PTY escutar. Heurística HTTP (ou probe HEAD no Rust) é feature, não um `if` no `UrlRow`. |
| `https://localhost` | Start page sempre `http://`. Vite com HTTPS quebra. Resolver na lista de servers, não no `go()`. |
| Back/forward sempre enabled | Sem `canGoBack`. Mentira na chrome. Só dá para fazer bem se o host publicar estado de histórico, não chutando `history.back()`. |
| Address bar durante loading | `setUrl` no `go()` e de novo no evento. Sem flag "user is typing". Um campo controlado com `editing` resolve; não misturar no store de URL. |
| Atalhos do app com o filho focado | Spec recusou forwarding de tecla da página. Menu nativo macOS ainda pega `Cmd+W`. JS `Mod+Shift+B` não. Não reabrir o buraco da ponte de tecla. |
| `tauri` `features = ["unstable"]` | Custo de produto do `add_child`. Não tem judo. Documentar no rumo: um webview, não N. |

`stopServer` no start page mata PID da árvore. Correto no backend. No UI, um stop sem confirm em processo de dev é aceitável; não mover isso para `BrowserPanel` depois do split: fica na start page / `devServers`.

---

## 10. Segurança: o que conferir no reframe, não o que reinventar

Já está certo e tem de continuar certo:

- Filho fora de `capabilities/default.json` (`webviews: ["main"]` só).
- Comentário no JSON sobre window-scoped capability: **verificar na mão** que o filho não ganha `core:default`. Se o Tauri 2 ainda injetar internals no child, isso é blocker de release, não de estilo.
- `on_navigation` deny para host da ponte e schemes ruins.
- Clipboard no filho está ligado (`enable_clipboard_access`). Consciente: precisa existir para colar na página. Não é o mesmo que ler o cookie jar.
- `devtools` só em debug.

Não fazer:

- Mandar PNG em base64 no PTY.
- Overlay React por cima do filho.
- Poll de URL.
- Forward de tecla da página para `dispatchCommand`.
- Ressuscitar Agent View, MCP, cron.

---

## Barra de aprovação (o que o Codex tem de deixar verdadeiro)

Não aprovar o follow-up se ainda valer qualquer um destes:

1. Pick ou capture ainda dependem de `eval(takePick)` / `eval(takeCaptureRegion)` ou de `pending*` na página.
2. `BrowserState.mode` continua `String` com fallback silencioso, ou o JS ainda atribui modo sozinho.
3. Dropdown/tooltip/toast da chrome do browser ainda pintam no retângulo nativo.
4. `BrowserPanel.tsx` continua dono de bounds + ponte + PTY + toast + kill.
5. `AppShell` e `RightWorkbench` continuam com predicados diferentes de expand.
6. A suíte nova do protocolo é grep de fonte.
7. Algum arquivo desta feature cruzou 1000 linhas para "caber o refactor".

Arquivos hoje (nenhum passou de 1000; não usar isso como folga):

| Arquivo | Linhas |
|---|---|
| `src-tauri/src/commands/browser.rs` | 657 |
| `src/components/browser/BrowserPanel.tsx` | 586 |
| `src-tauri/src/commands/browser_init.js` | 552 |
| `src-tauri/src/commands/browser_capture.rs` | 225 |

Se `browser.rs` crescer com o validador de payload, **extrair** `bridge.rs` (validate + message enum) antes de cruzar 1000. O validador é o módulo. O comando é o orquestrador fino.

---

## Plano de ataque para o Codex

Uma série, não um PR único. Cada passo deixa o app buildável. Sem `git push`. Sem formatter em arquivo fora da tarefa.

### PR 1: payload autenticado (apaga o ping-pong)

- Estender `validate_bridge` para `selection` e `capture` com campos allowlisted.
- Emitir eventos **com payload**.
- Remover comandos `browser_take_pick` e `browser_take_capture_region` de `lib.rs`, `ipc.ts`, `browser.service.ts`.
- JS: serializar no clique/mouseup, sem `window.__mcx.takePick`.
- Testes Rust do validador (feliz, token ruim, modo errado, campo extra, overflow, rect minúsculo).
- Apagar greps que só existiam para `takePick` / `takeCaptureRegion`.

### PR 2: um dono do modo

- Enum Rust + TS único.
- `browser_set_mode` falha em valor inválido.
- JS não escreve modo; host empurra.
- Delivery único com política REQ-025 (falha mantém modo, sucesso volta a browse).
- Esconder overlay da região vira `setMode(Browse)` no host antes do snapshot.

### PR 3: chrome que não compete com o filho

- Sem dropdown para baixo sobre o preview.
- Feedback de envio na barra, não toast global.
- Atualizar `BrowserPanel.test.tsx`: o overlayLock pode continuar sem toast; o delivery não usa toast.

### PR 4: decompor o painel e o predicado de layout

- `useBrowserHost`, `browserDelivery.ts`, `BrowserChrome.tsx`.
- Seletor único `workbenchLayout`.
- Matar `browser_url` ou usá-lo de verdade na recuperação.
- Matar `serverForUrl` se recents não voltarem neste passo.

### PR 5: testes do guest e caps alinhados

- Predicados do init script testáveis, ou `vm` com DOM mínimo.
- `normalizeBrowserUrl` alinhado a `is_allowed_url`.
- Um número só para caps de URL/title.

Não misturar screenshot Windows, recents, probe HTTP ou fila de anotações nesses PRs.

---

## Leitura obrigatória antes de editar

- Este arquivo.
- `docs/research-in-app-browser.md` (produto e o que **não** fazer).
- `docs/research-agentation-browser-integration.md` (não copiar Agentation, não MCP).
- `specs/agent-runtime-reliability/design.md` seção 8 (ponte autenticada, sem poll, sem key forward). REQ-019 a REQ-025 continuam valendo; o código atual não cumpre REQ-025 no pick.
- `AGENTS.md` / `CLAUDE.md`: IPC espelhado, filho sem capability, sem em-dash, i18n nos dois locales.

---

## Fora de escopo deste review

- Performance de `takeSnapshot` em páginas 3D.
- Acessibilidade completa do overlay na página (o guest não é a chrome do app).
- Linux / WebKitGTK.
- Multi-tab nativo de browser.
- Qualquer ressurreição da Agent View.
