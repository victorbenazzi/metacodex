# Agent View: features P1 / P2 (tradução do harness opencode para a UI)

Status em 2026-06-10. Este documento é o plano de implementação das capacidades que o
opencode (sidecar, v1.16.0) já expõe via HTTP e que a interface do Agent View ainda não
traduz. Ele nasceu de um mega review + gap analysis contra o OpenAPI real do sidecar
(`GET /doc`, 149 endpoints, ~85 tipos de evento SSE) e assume que **todo o pacote de
correções de 2026-06-10 já está aplicado** (ver "Estado atual" abaixo).

Cada feature traz: objetivo, superfície de API, onde encaixa no código, esboço de
implementação, UI/UX, i18n, riscos e critérios de aceite. Onde um shape de payload não
foi verificado no spec, está marcado **[verificar]** com o comando de inspeção pronto.

---

## Estado atual (o que JÁ está coberto, não refazer)

Implementado e verde (`pnpm build`, `cargo test 23/23`) em 2026-06-10:

- Permissões ao vivo v1+v2 com roteamento para sessões filhas (swarm), recuperação de
  pendências via `GET /permission` + `GET /api/permission/request` no `selectSession`,
  e restore do card quando o reply falha.
- **Question API completa** (`question.asked`/`v2`, reply/reject, card com opções,
  múltipla escolha e texto livre): `chat/QuestionCard.tsx`.
- **Todo list do agente** (`todo.updated` + `GET /session/{id}/todo`): `chat/TodoCard.tsx`.
- `session.error` tratado (erro inline + status idle); meta do assistant capturada
  (cost, tokens, modelID, variant, finish) com footer no hover; tool parts com status
  (spinner / erro com output expandível); partes `file`/`patch`/`retry`/`compaction`
  renderizadas; `message.removed`/`message.part.removed` tratados.
- Delete + rename de sessão (menu "..." na thread), filhos do swarm recuperados via
  `GET /session/{id}/children` ao reabrir histórico.
- Reconexão automática do SSE com backoff re-resolvendo a porta via Rust + banner.
- Streamdown tematizado por tokens + plugin shiki + traduções; fila única de helpers
  HTTP em `features/agent/oc.ts` (`qs`, `errMessage`, `oneShotPrompt`, `archiveSession`).
- Hardening Rust: SIGTERM antes de SIGKILL, timeouts, backup de JSON corrompido,
  roots-check no cron, overlap guard, DST, identidade de processo na adoção.

### Mapa de arquivos (onde as features abaixo encaixam)

| Camada | Arquivo | Papel |
|---|---|---|
| Transporte + estado do chat | `src/features/agent/chat.store.ts` | `ocFetch` (toda chamada leva `?directory=`), sessão ativa, send, prompts pendentes |
| Fronteira de eventos | `src/features/agent/chat.events.ts` | ÚNICO lugar que conhece nomes/shapes de evento SSE. Toda feature nova de evento entra aqui |
| Vocabulário puro | `src/features/agent/opencode.ts` | Tipos + mappers sem I/O (rulesets, QuestionInfo, TodoItem...) |
| Helpers HTTP | `src/features/agent/oc.ts` | `qs`, `errMessage`, `oneShotPrompt`, `archiveSession` |
| Histórico da sidebar | `src/features/agent/sessions.store.ts` | Lista por diretório, pin/archive/rename/remove, runningById |
| Render do thread | `src/components/agent/chat/*` | ChatThread, ChatMessage, PermissionCard, QuestionCard, TodoCard, SubagentCard |
| Composer | `src/components/agent/AgentComposer.tsx` + `composer/*` | Pickers, mention "/" e "@", attachments |
| Sidecar (Rust) | `src-tauri/src/agent/runtime.rs` | Lifecycle, modelos (keys stripped), run headless |

### Invariantes que TODA feature deve respeitar

1. **Directory scoping:** toda chamada HTTP ao opencode leva `?directory=` (use
   `ocFetch` no chat.store ou `qs()` de `oc.ts`). Sem isso a call roda no cwd do sidecar.
2. **Eventos só em `chat.events.ts`:** nomes de evento e shapes de payload não vazam
   para componentes. Isso é o que mantém a migração v2 (P2.1) barata.
3. **Dependência one-way:** `sessions.store` nunca importa `chat.store`.
4. **Segredos nunca no webview:** qualquer payload novo vindo do sidecar que possa
   ecoar config (keys) passa por sanitização no Rust (precedente: `sanitize_mcp_status`).
5. **i18n nos DOIS locales** (`src/features/i18n/locales/{en,pt-BR}.json`), tokens de
   design sempre, popups com fade opacity-only, **nunca travessão** em nenhum texto.
6. **Espelho IPC:** comando Tauri novo = `lib.rs::invoke_handler!` + `src/lib/ipc.ts::CMD`.
   (A maioria das features abaixo NÃO precisa de Rust novo: o webview fala HTTP direto.)

### Como inspecionar a API do sidecar (faça antes de cada feature)

O sidecar roda local; o spec completo vem dele:

```bash
# achar a porta do sidecar vivo
PORT=$(lsof -nP -iTCP -sTCP:LISTEN -a -p $(pgrep -f "opencode serve" | head -1) | awk 'NR>1 {sub(".*:","",$9); print $9; exit}')
curl -s "http://127.0.0.1:$PORT/doc" -o /tmp/opencode-spec.json

# request body de um endpoint
jq '.paths."/session/{sessionID}/revert".post.requestBody' /tmp/opencode-spec.json
# response de um endpoint
jq '.paths."/session/{sessionID}/diff".get.responses."200"' /tmp/opencode-spec.json
# shape de um schema
jq '.components.schemas.SnapshotPart' /tmp/opencode-spec.json
# string discriminadora de um evento
jq '.components.schemas.EventSessionDiff.properties.type' /tmp/opencode-spec.json
```

---

# P1: capacidades core do harness

> **STATUS 2026-06-10: P1 COMPLETO (P1.1 a P1.10 implementados).** `pnpm build` e
> `cargo test` (23/23) verdes. Shapes confirmados contra o `/doc` do sidecar 1.16.0;
> divergências encontradas e acomodadas:
> - P1.2: `GET /api/session/{id}/context` retorna mensagens (não uso); o medidor usa
>   SOMENTE a estimativa local (tokens da última assistant message, incluindo
>   `cache.read/write`, vs `limit.context` do catálogo, agora extraído no Rust).
> - P1.7: `file.edited` NÃO carrega `sessionID`; acumulação por heurística
>   (só com turno ativo), rehidratação derivada das tool parts.
> - P1.10: `/api/permission/saved` é keyed por `projectID` (não directory);
>   resolvido via `GET /project/current?directory=`.
> - P1.4: `GET /command` também lista skills (`source: "skill"`); o popup filtra
>   essas (seção Skills já as cobre) e o roteamento do send casa qualquer nome do
>   catálogo (expansão de template no servidor).
> Falta apenas o passe visual ao vivo (roteiro de teste por feature abaixo).

Ordem de ataque sugerida: **1 + 2 juntos** (ciclo de confiança: ver o que mudou e
desfazer), depois **3** (fricção diária), depois **4, 5, 6**, e por fim **7 a 10**.

## P1.1 Checkpoints / Desfazer (revert)

**Objetivo.** O agente edita arquivos; hoje não existe undo. Entregar "restaurar a
conversa e os arquivos até esta mensagem", com preview do que será descartado.

**API (v1.16.0):**
- `POST /session/{sessionID}/revert` body **[verificar]** (esperado: `{ messageID, partID? }`).
- `POST /session/{sessionID}/unrevert` (desfaz o revert).
- Campo `revert` no objeto `Session` (indica revert ativo e até onde).
- `GET /session/{sessionID}/diff` (diff acumulado da sessão) **[verificar response]**.
- Partes `snapshot` (checkpoint de arquivos) e `patch` já chegam no stream e já são
  modeladas no `PartType`; hoje `snapshot` renderiza null e `patch` vira chip simples.
- Após um revert o opencode emite `message.removed` para as mensagens descartadas
  (o reducer já remove do thread).

**Implementação:**
1. `chat.store.ts`: ações `revertTo(messageID)` e `unrevert()`; estado `revert` da
   sessão (ler do `session.updated` em `chat.events.ts` e do `GET /session/{id}`).
2. `ChatMessage.tsx`: hover action em mensagens do usuário ("Restaurar até aqui"),
   com `ConfirmDialog` mostrando o resumo do diff (chamar `GET /session/{id}/diff`
   antes para listar arquivos afetados).
3. Banner persistente no `ChatThread` enquanto `session.revert` ativo: "Você restaurou
   para <msg>. N mensagens descartadas. [Desfazer]" (chama `unrevert`).
4. Diff viewer: reaproveitar o caminho de diff existente do Code view se possível
   (AppShell `handleOpenDiff`); senão, dialog com diff unificado renderizado via o
   shiki já compartilhado (`features/theme/shikiHighlighter.ts`, lang `diff`).

**i18n:** `agent.chat.revert.*` (restoreHere, confirmTitle, confirmBody, activeBanner,
undo, filesAffected).

**Riscos:** semântica exata do body do revert; interação com sessão em streaming
(bloquear revert enquanto `status !== "idle"`); swarm (revert só na raiz).

**Aceite:** reverter restaura arquivos no disco + remove mensagens do thread; unrevert
traz tudo de volta; reabrir a sessão mostra o estado correto; nada disso roda com
turno em andamento.

## P1.2 Compactar conversa + medidor de contexto

**Objetivo.** Mostrar o quanto da janela de contexto a sessão consumiu e oferecer
compactação (nativa do harness) antes de estourar.

**API:**
- `GET /api/session/{sessionID}/context` (v2) **[verificar response]**: uso de contexto.
- `POST /session/{sessionID}/summarize` body **[verificar]** (esperado: `{ providerID, modelID }`).
- Evento `session.compacted` (string confirmada) + parte `compaction` (divisor já
  renderizado no ChatMessage).
- Fallback sem v2: o catálogo de modelos tem `limit` (janela) e cada assistant message
  já carrega `tokens` (capturados); dá para estimar uso = tokens da última mensagem
  vs `limit.context`. Para isso, expor `limit` no `ModelInfo` do `runtime.rs::parse_providers`
  (hoje não passa) + `AgentModel` no TS.

**Implementação:**
1. `chat.store.ts`: `contextUsage: { used: number; limit: number } | null`, atualizado
   ao fim de cada turno (`session.idle`) via o endpoint v2, com fallback estimado.
2. UI: barra fina acima do composer (só aparece > 50%), âmbar > 80%; tooltip com
   números. Botão/menu "Compactar conversa" (no PlusMenu ou ao lado do medidor),
   desabilitado durante streaming.
3. Após `session.compacted`, recarregar o thread (`selectSession` do id atual) para
   alinhar com o histórico compactado.

**i18n:** `agent.chat.context.*` (usage, compact, compacting, compactDone).

**Aceite:** medidor reflete o uso após cada turno; compactar reduz o uso e insere o
divisor; estimativa de fallback nunca quebra quando o endpoint v2 não existir.

## P1.3 Fila de prompts (digitar durante o streaming)

**Objetivo.** Hoje o composer bloqueia o envio enquanto um turno roda. O harness
suporta enfileirar; a UI deve aceitar "manda essa depois".

**API:**
- `POST /session/{sessionID}/prompt_async` **[verificar body/semântica]**: enfileira
  e retorna imediato. Eventos v2 `PromptAdmitted` / `PromptPromoted` sinalizam a fila.
- **Plano B 100% local** (recomendado começar por ele): fila no `chat.store`
  (`queued: OutgoingDraft[]`); em `session.idle`, despachar o próximo via `send()`.
  Sem dependência de semântica nova, comportamento idêntico ao usuário.

**Implementação:**
1. `AgentComposer`: quando `busy`, o botão vira "Enfileirar" (ou Enter enfileira) em
   vez de desabilitar; chips de fila acima do composer com remover/editar.
2. `chat.store`: `queue: { text, parts }[]`, consumida em `session.idle` (e descartada
   em `stop()`/troca de sessão, com devolução do texto ao draft).
3. Migrar para `prompt_async` depois, se a semântica confirmar (mesma UI).

**i18n:** `agent.composer.queue.*` (queued, queueHint, removeQueued).

**Aceite:** enviar 2 mensagens durante um turno gera 2 turnos em sequência, sem corrida;
Stop limpa a fila devolvendo o texto; troca de sessão não vaza fila.

## P1.4 Custom commands no "/"

**Objetivo.** O "/" hoje só lista skills. O opencode tem commands de usuário
(`~/.config/opencode/command/*`) com template/agent/model próprios.

**API:**
- `GET /command` lista (`name`, `description`, `agent?`, `model?`, `template` **[verificar shape]**).
- `POST /session/{sessionID}/command` body **[verificar]** (esperado: `{ command, arguments? }`).

**Implementação:**
1. `features/agent/commands.ts` (novo, espelho de `skills.ts`): cache de `GET /command`.
2. `MentionPopup.tsx`: no trigger "/", duas seções (Skills | Commands), mesma busca fuzzy.
   Selecionar insere `/nome ` como hoje.
3. `chat.store.send()`: se o texto começa com `/nome` que casa com um command,
   despachar via `POST .../command` (com o resto do texto como `arguments`) em vez do
   message POST. Manter o bubble otimista igual.

**Riscos:** colisão de nome skill vs command (prefira o command e mostre a origem na
linha do popup); commands chegam por diretório (respeitar `?directory=`).

**Aceite:** um command definido no opencode aparece no "/", roda com template aplicado
e o turno flui pelo stream normal.

## P1.5 Shell inline ("!")

**Objetivo.** Rodar um comando de terminal dentro da conversa (modo "!" do TUI), com
o output entrando no histórico da sessão.

**API:** `POST /session/{sessionID}/shell` body **[verificar]** (esperado:
`{ command, agent? }`). O output chega como mensagem assistant com tool part `bash`
pelo stream normal (ToolRow já renderiza, incluindo erro).

**Implementação:**
1. `AgentComposer`: detectar prefixo `!` no envio (texto começando com `!` e não `!!`):
   placeholder muda ("Comando de shell..."), borda âmbar sutil.
2. `chat.store`: `sendShell(command)` que POSTa no `/shell` (sessão criada on-demand
   como no send normal) + bubble otimista do usuário com o comando em mono.

**i18n:** `agent.composer.shellHint`, `agent.chat.shellRan`.

**Riscos:** permissões (o ruleset `bash` da sessão se aplica? **[verificar]**; se o
shell ignora ruleset, deixar claro no hint). Swarm: shell sempre na raiz.

**Aceite:** `!git status` mostra o output no thread e fica no histórico ao reabrir.

## P1.6 Fork de conversa

**Objetivo.** Duplicar uma sessão (inteira ou até um ponto) para explorar um caminho
sem perder o original.

**API:** `POST /session/{sessionID}/fork` body **[verificar]** (esperado:
`{ messageID? }`), retorna a sessão nova.

**Implementação:**
1. `sessions.store.ts`: ação `fork(directory, id, messageID?)` que POSTa e retorna o id novo.
2. UI: item "Duplicar conversa" no menu "..." da thread (`SidebarThreads.tsx`); e
   "Duplicar a partir daqui" no hover de mensagem do usuário (par do P1.1).
3. Após fork: `selectSession(novoId)` + `loadSessions(directory)`.

**i18n:** `agent.sidebar.fork`, `agent.chat.forkFromHere`.

**Aceite:** fork cria thread nova com o histórico esperado; original intocada; título
herdado com sufixo (ou o que o harness fizer).

## P1.7 Arquivos tocados pela sessão

**Objetivo.** Ao fim de um turno, responder "o que o agente mudou?" sem caçar tool
chips: chip "N arquivos alterados" com diff a um clique. Par natural do P1.1.

**API:**
- Evento `file.edited` **[verificar props]** (esperado `{ file }`): hoje é dropado.
- `GET /session/{sessionID}/diff`: diff da sessão.
- `GET /file/status?directory=`: status git visto pelo harness (complemento).

**Implementação:**
1. `chat.events.ts`: case `file.edited` acumulando em `editedFiles: Set<string>` por
   sessão no `chat.store` (limpo em `selectSession`/`newChat`; rehidratável derivando
   das tool parts `edit`/`write` do histórico).
2. UI: linha discreta após a última mensagem do turno ("3 arquivos alterados"),
   expandindo para a lista; clique em arquivo abre o diff (mesmo viewer do P1.1).
3. Integração Code view: os arquivos já atualizam via watcher próprio; nada a fazer.

**i18n:** `agent.chat.filesChanged` (plural), `agent.chat.viewDiff`.

**Aceite:** turno que edita 3 arquivos mostra o chip com 3; diff abre certo; cron
runs reabertas pelo histórico também mostram (derivado das tool parts).

## P1.8 Busca via harness no "@" (find/file/symbol)

**Objetivo.** O "@" usa `list_files` do Rust; o harness tem busca própria (respeita o
ignore DELE) + grep + símbolos. Alinhar o que o usuário vê com o que o agente vê.

**API:**
- `GET /find/file?query=&directory=` (fuzzy de paths) **[verificar shape: array de strings?]**.
- `GET /find?pattern=&directory=` (grep, response rica) e `GET /find/symbol?query=`
  (workspace symbols, depende de LSP ativo).

**Implementação:**
1. `MentionPopup.tsx`: fonte de "Arquivos" passa a ser `GET /find/file` com debounce
   de ~120ms por tecla (servidor já faz fuzzy; remover o fuzzy local nesse caminho),
   mantendo `list_files` como fallback se a chamada falhar.
2. Categoria nova "Símbolos" no nível raiz do "@" (via `/find/symbol`), inserindo
   `arquivo:linha` como contexto (chip `context-file-range` novo em `attachments.ts`
   ou texto sintético via `contextParts.ts`).

**Aceite:** "@" lista os mesmos arquivos que o agente enxerga (gitignore respeitado);
sidecar caído não quebra o popup (fallback Rust).

## P1.9 Editar / apagar mensagem

**Objetivo.** Corrigir um prompt sem recomeçar a conversa.

**API:**
- `DELETE /session/{sessionID}/message/{messageID}` (session.deleteMessage).
- `PATCH /session/{sessionID}/message/{messageID}/part/{partID}` (part.update).
- Eventos `message.removed` / `message.part.removed` (já tratados no reducer).

**Implementação:**
1. Hover em mensagem do usuário: "Editar e reenviar". Fluxo recomendado: usar o
   **revert (P1.1) até a mensagem**, prefill do composer com o texto antigo, enviar.
   (Deletar mensagens soltas no meio deixa o contexto incoerente; o revert é o
   primitivo certo. Documentado como dependência de P1.1.)
2. "Apagar" simples só para a ÚLTIMA troca (delete do par user+assistant) quando não
   houver revert disponível.

**Aceite:** editar reenvia do ponto certo e o thread/arquivos ficam coerentes;
nada disponível enquanto streaming.

## P1.10 Permissões salvas ("sempre permitir")

**Objetivo.** O reply "always" cria regras persistentes invisíveis. Dar uma tela para
revisar e revogar.

**API:**
- `GET /api/permission/saved` lista (`PermissionSavedInfo`) **[verificar shape]**.
- `DELETE /api/permission/saved/{id}` revoga.

**Implementação:**
1. `CustomizePanel.tsx`: aba lateral nova "Permissões" (ao lado de Skills | MCP | Tools),
   conteúdo num `PermissionsPanel.tsx` novo: lista (ação, pattern, quando), botão revogar.
2. Após responder "always" num card, toast/linha discreta "Salvo em Customize >
   Permissões".

**i18n:** `agent.permissions.*` (title, subtitle, empty, revoke, savedHint).

**Aceite:** um "always" dado aparece na lista; revogar volta a perguntar no próximo uso.

---

# P2: plataforma e estratégico

## P2.1 Migração para a API v2 de eventos

A v1 (`/event` com `message.part.delta` etc.) funciona, mas o opencode está migrando
para `/api/event` com eventos granulares `session.next.*` (schemas `EventSessionNext*`:
Text/Reasoning/ToolInput started-delta-ended, `ToolCalled/Success/Failed/Progress`,
`Retried`, `Compaction*`, `PromptAdmitted/Promoted`, `ShellStarted/Ended`,
`AgentSwitched`, `ModelSwitched`). **[verificar as strings discriminadoras no spec]**.

Plano: `chat.events.ts` é a única fronteira; criar `applyEventV2` mapeando para os
MESMOS folders (`upsertPart`/`appendDelta`/`upsertAssistant`), atrás de uma flag
(`settings.agent.eventsV2`). Ganhos: input de tool ao vivo (`ToolInputDelta`), retry
visível, troca de modelo/agente sinalizada, fila nativa (P1.3). Riscos: paridade de
shapes; rodar as duas em paralelo num build dev e comparar threads.

## P2.2 MCP OAuth

Servidores MCP remotos com OAuth ficam num cinza genérico hoje. API:
`POST /mcp/{name}/auth` (inicia, retorna URL **[verificar]**),
`POST /mcp/{name}/auth/authenticate`, `POST /mcp/{name}/auth/callback`,
`DELETE /mcp/{name}/auth`; status `needs_auth` / `needs_client_registration` já passam
pela sanitização do Rust. Evento `EventMcpBrowserOpenFailed` existe.
UI: no `McpPanel`, dot âmbar para `needs_auth` + botão "Autenticar" (abre browser via
`openExternalUrl` existente); fluxo de callback **[verificar: o sidecar serve o
callback sozinho?]**.

## P2.3 Auth completa de providers

Hoje Settings só grava api_key do opencode-go. API: `DELETE /auth/{providerID}`
(logout), `POST /provider/{providerID}/oauth/authorize` (retorna URL + verifier
**[verificar]**) e `/oauth/callback`, `GET /provider/auth` (estado por provider).
UI: Settings > Agent > Providers com estado conectado/não + entrar (OAuth ou key) +
sair. Atenção: nunca exibir a key; o Rust continua sendo o broker das mutações de
auth (`agent_set_credentials` já existe; adicionar `agent_clear_credentials`).

## P2.4 Skills e Tools direto do harness

`GET /skill` (por diretório) substitui a leitura de 4 pastas no disco como fonte do
painel/popup, refletindo exatamente o que o opencode carregou (inclui plugins).
Manter `agent_list_skills` (Rust) como fallback offline. Tools reais na aba Tools:
`GET /experimental/tool/ids` (marcar como experimental no código).

## P2.5 Config do opencode pela UI (+ Agent builder)

`GET/PATCH /config?directory=` (projeto) e `GET/PATCH /global/config` (global):
rules/instructions, agents custom (`config.agent`), temas. **[verificar: PATCH é
deep-merge?]**. É onde entra o "Agent builder" do handoff (meta-agente que escreve a
config de um agent por linguagem natural, portando `generate-agent-config` do
VensyAgents). UI: Customize ganha "Agents" e "Rules". Cuidado: nunca ecoar seções com
segredos do config no webview (sanitizar no caminho, como nos modelos).

## P2.6 Aviso de update do opencode

Eventos `installation.updated` / `installation.update-available` **[verificar em qual
stream chegam: `/event` ou `/global/event`]** + `POST /global/upgrade`. UI: banner fino
"opencode atualizou para vX, reinicie o agente" reutilizando o contrato de restart do
MCP (`mcp.store.restart`), e opcionalmente botão "Atualizar agora" (upgrade + restart).

## P2.7 Sync multi-cliente

`POST /sync/start`, `/sync/history`, `/sync/replay`, `/sync/steal`. Permite duas
janelas/devices na mesma sessão com replay de eventos. Avançado; só atacar depois da
migração v2 (P2.1), pois o sync é da família nova. **[verificar semântica de steal]**.

## P2.8 Compartilhar sessão

`POST /session/{id}/share` (retorna URL pública) / `DELETE /session/{id}/share`;
campo `share` no Session. Decisão de produto pendente (link público de conversa).
Se entrar: item no menu "..." da thread + badge "compartilhada" + confirm explícito
(é publicação externa).

## P2.9 Projects nativos do opencode

`GET /project`, `GET /project/current`, `PATCH /project/{projectID}`,
`GET /project/{projectID}/directories`. Mapear o bucket "sem pasta" e metadados para a
noção de projeto que o harness já tem (hoje o vínculo é só o path do diretório).
Baixo urgência; revisitar quando houver fricção real.

## P2.10 Logs unificados

`POST /log` (body `{ service, level, message, extra? }` **[verificar]**): logs do
frontend caindo no `opencode.log` que o Rust já mantém. Um lugar só para depurar
sessões problemáticas. Usar com parcimônia (erros do chat.store e do reconnect).

---

## Fora de escopo permanente

Redundantes com o que o metacodex já tem nativo em Rust (não traduzir):

- `/tui/*` (14 endpoints): controle do TUI do opencode.
- `/pty/*` (8): o metacodex tem `PtyManager` próprio.
- `/vcs/*` e `/experimental/worktree`: git e worktrees próprios (`commands/git.rs`).
- `/experimental/console|workspace|project-copy`: superfícies experimentais sem caso de uso aqui.

## Checklist de PR para qualquer feature deste documento

- [ ] Shapes confirmados no `/doc` do sidecar (não confiar só neste documento).
- [ ] `?directory=` em toda chamada nova; eventos novos só em `chat.events.ts`.
- [ ] Estados de loading / erro / vazio (com `EmptyState` quando couber).
- [ ] i18n en + pt-BR; zero travessão; tokens de design; popup opacity-only.
- [ ] Guard de staleness em qualquer fetch que pinte o thread (padrão do `selectSession`).
- [ ] Nada de ação destrutiva/exposição externa sem ConfirmDialog.
- [ ] `pnpm build` e `cargo test` verdes; se mexeu em comando Tauri, espelho IPC atualizado.
