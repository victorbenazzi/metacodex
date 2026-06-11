# Agent View, handoff de continuação

Status em 2026-06-08. Tudo abaixo está **implementado e compilando** (`tsc`, `cargo check`, `pnpm build` todos verdes), mas **ainda não foi testado vivo na GUI** (a sessão anterior não tinha permissão de Acessibilidade/Gravação de Tela pra dirigir a janela). Nada foi commitado nem enviado: rode `git status` pra ver a árvore de trabalho.

Plano completo: `/Users/victor/.claude/plans/vc-um-arquiteto-fizzy-melody.md`.

---

## Como rodar e testar (com o metacodex instalado FECHADO)

```bash
cd ~/Documents/metacodex
pnpm tauri dev
```

Primeira compilação ~30-40s. Em build de debug o `single-instance` é pulado (mudança proposital, veja "Dev isolation"), então se um dia quiser rodar junto com o app instalado:

```bash
METACODEX_HOME="$HOME/.metacodex-dev" pnpm tauri dev   # estado isolado, janela separada
```

**Pré-requisitos:** `pnpm`; `opencode` instalado e logado no `opencode-go` (o Victor já está). Na 1ª vez que abrir o Agent (ou Settings → Agent) o sidecar `opencode serve` sobe sozinho (1-2s); modelo default `deepseek-v4-flash`.

### Roteiro de teste
1. Topbar: clica em **Agent** (onde ficava "metacodex").
2. **Cmd+,** → seção **Agent**: deve mostrar bolinha verde "Running, opencode v1.16.0" + dropdown de modelos opencode-go.
3. Volta pro Agent, escreve no composer e envia: deve aparecer sua mensagem e o reply em streaming (texto + bloco de reasoning colapsável).
4. Sidebar **Chat**: New chat + histórico de sessões.
5. **Work → Skills**: lista real das skills do disco.
6. **Work → Scheduled Tasks**: **Create** abre o modal (Name + Requirement + Schedule). Em Schedule, clica um preset (ex.: "Every minute" = `* * * * *`) ou digita um cron; a descrição legível confirma. Salva, depois **Run now** no card; deve rodar e mostrar "última execução" com bolinha verde. Para ver o disparo automático, use `* * * * *` e espere o próximo minuto.
7. Toggle **Code**: os terminais continuam vivos (o Agent View é overlay, o Code fica montado por baixo).

Se algo travar, o terminal do `pnpm tauri dev` mostra o erro (Rust no stderr; erros de front no devtools do webview).

---

## Arquitetura travada

- **Motor = opencode** rodando como sidecar (`opencode serve`, binário Bun, MIT). Não escrevemos loop de agente.
- **Provider = opencode-go** (subscription GO). Chave guardada pelo opencode (auth store dele), nunca no webview.
- **Chat = webview fala direto com o opencode** (CORS é permissivo): `EventSource` no `/event` + `fetch` nos POSTs. **Não** usamos AI SDK `useChat`/transport (a via direta é mais robusta). **streamdown** renderiza as respostas.
- **Rust é o broker** só onde precisa: ciclo de vida do sidecar, listagem de modelos com chaves removidas, e o cron.
- **Cron em Rust** baseado em **expressão cron padrão de 5 campos** (avaliador próprio em `agent/cron.rs`, sem dependência). Tick tokio de 20s avalia contra o relógio local e dispara no minuto que casa (dedupe por minuto via `last_fired_minute`); a string cron é o artefato portável que um trigger.dev/Railway consome depois. As sessões headless rodam com `?directory=<raiz>` e ruleset `full-auto` (senão travam esperando aprovação). Roda só com o app aberto.

### Fatos do opencode HTTP (confirmados em spike)
- Sobe com `opencode serve --port 0 --print-logs` → imprime `opencode server listening on http://127.0.0.1:PORT`.
- `GET /global/health` → `{healthy, version}`
- `GET /config/providers` → `{providers:[{id,name,models:{modelId:{name,...}}}], default:{providerId:modelId}}`. **VAZA `key` por provider**, por isso o Rust filtra antes de devolver.
- `POST /session {}` → `{id:"ses_..."}`
- `POST /session/{id}/message` body `{parts:[{type:"text",text}], model:{providerID,modelID}}` → mensagem final (sync; o streaming vem pelo `/event`).
- `POST /session/{id}/abort` ; `GET /session/{id}/message` (histórico) ; `PUT /auth/{providerID}` body `{type:"api_key",key}`.
- `GET /event` (SSE), tipos relevantes:
  - `message.part.delta` → `properties:{sessionID,messageID,partID,field:"text",delta}`
  - `message.part.updated` → `properties:{part:{id,type:"text"|"reasoning"|"tool"|"step-start"|"step-finish",text,messageID,sessionID}}`
  - `message.updated` → `properties:{info:{id,role:"user"|"assistant",sessionID,finish}}`
  - `session.idle` → `properties:{sessionID}` (fim do turno)

---

## O que está pronto (por fase)

- **Fase 0 (shell):** toggle Agent|Code na topbar; overlay opaco do Agent View que preserva os terminais; sidebar Work|Chat + hero (Fraunces). Tokens, i18n en+pt-BR.
- **Fase 1 (runtime):** `AgentRuntime` (spawn/health/reuse/kill do `opencode serve`); `agent_list_models` com chaves removidas; Settings → Agent (status + chave GO + modelo default).
- **Fase 2 (chat):** `chat.store` (EventSource + fetch) monta a thread dos eventos; composer funcional (Enter envia, Shift+Enter quebra, stop); render com streamdown + reasoning colapsável + tool chips; histórico de sessões. AgentView é **lazy-loaded** (streamdown/shiki/mermaid fora do bundle do Code View).
- **Fase 3 (work/harness):** Skills browser **real** (Rust lê `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`, `~/.metacodex/skills`, parse de frontmatter); navegação das abas Work; projeto ativo exibido.
- **Fase 4 (cron):** scheduler tokio **real** por expressão cron + persistência (`~/.metacodex/state/agent-cron.json`) + CRUD (create/update/delete/enable) + Run now + notificação + `last_status`. UI Scheduled Tasks reskin do Kimi (header+Create, empty state, cards) com modal (Name/Requirement/Schedule) e campo de cron (presets + descrição via `cronstrue` en/pt-BR). **WebBridge** foi removido (2026-06-10): automação de browser entra via MCP (ex.: Playwright), não como superfície própria.

---

## Fase 5 (controle do harness), IMPLEMENTADA 2026-06-08 (builds verdes, falta verificação viva)

Composer agora dirige o harness de verdade (antes era visual). Núcleo em `src/features/agent/opencode.ts` (presets → `PermissionRuleset`, mapeamento de modo, tipos) + reescrita do `chat.store.ts`.

- **Directory scoping (era o bug crítico):** todo call ao opencode leva `?directory=<raiz do projeto>`. Antes o agente rodava no cwd de launch do app, não no projeto. Picker em `composer/ProjectPicker.tsx`; default = projeto metacodex ativo (init em `AgentView`). Trocar de projeto reinicia o chat (sessão é atada ao diretório).
- **Picker de modelo inline:** `composer/ModelPicker.tsx`, agrupado por provider, grava em `settings.agent.{providerId,modelId}` (mesmo slice do Settings, ficam em sync). `AgentView` chama `loadModels()` no mount.
- **Permissões reais (3 presets + aprovação ao vivo):** `composer/PermissionPicker.tsx` (Sempre perguntar / Auto-aprovar edições / Tudo liberado) → `PermissionRuleset` na criação da sessão e PATCH na sessão viva. Pedidos ao vivo: eventos SSE `permission.asked` / `permission.v2.asked` viram card em `chat/PermissionCard.tsx`; resposta via `POST /session/{id}/permissions/{id}` `{response}` (v1) ou `POST /permission/{id}/reply` `{reply}` (v2).
- **Agent / Agent Swarm (single vs orquestrador):** toggle persiste em `settings.agent.mode`. Ambos mandam `agent` (primário, prefere `build`, de `GET /agent`); swarm adiciona `system` (SWARM_SYSTEM) que instrui decompor e delegar em subagents via tool `task`. Não há primário "swarm" nativo no opencode, então a diferença real é o system hint + a delegação visível.

## Histórico de conversas por projeto (sidebar), IMPLEMENTADO 2026-06-09 (builds verdes, falta verificação viva)

Referência visual: Cursor (projeto pai > threads aninhadas). Tudo parte do opencode; nada de registry paralelo de sessões.

- **Fonte de dados:** `GET /session?directory=<raiz>` por projeto (filhas de swarm filtradas por `parentID`, arquivadas por `time.archived`). Store novo `src/features/agent/sessions.store.ts` (`byDirectory`, `runningById`, `drafts`); o `chat.store` empurra `baseUrl` e encaminha os eventos SSE (`session.created|updated|deleted|status|idle`) pra ele, dependência só numa direção.
- **Status ao vivo:** bolinha `--warn` pulsando enquanto o harness roda a sessão (`session.status`/`session.idle` + poll de `GET /session/status` a cada 10s, que pega runs headless de cron em outros projetos), cinza quando terminou. Lista completa re-busca a cada 30s.
- **Pin / arquivar (nativos do opencode):** hover na thread troca o timestamp pelos botões; pin = `PATCH /session/{id}` `{metadata:{pinned:true}}` (ordena primeiro, mostra o glifo de pin), arquivar = `{time:{archived:<ms>}}` (some da lista; desarquivar seria `archived: 0`, sem UI por ora).
- **Rascunhos (linha do lápis):** prompt digitado e não enviado persiste por projeto em `~/.metacodex/state/agent-ui.json` (comandos `agent_ui_state_read|write`, mesmo padrão opaco do settings.json). Só o composer de chat novo participa (digitar no meio de uma thread não é rascunho). Clicar na linha do lápis abre o composer naquele projeto com o texto.
- **Expansão dos grupos:** projeto vazio começa fechado (abrindo, mostra "Nenhuma conversa ainda"); ao entrar a primeira conversa/rascunho abre sozinho. Toggle manual do usuário vira escolha explícita, persiste no mesmo `agent-ui.json` (`expanded`) e ganha do derivado dali em diante.
- **UI:** `ProjectSection.tsx` reescrito (linha do projeto com chevron + `+` no hover; `+` abre composer já no projeto), `SidebarThreads.tsx` novo (`ProjectThreads`, compartilhado com o pane Chat, que agora lista o histórico real do diretório ativo). Bucket "Trabalhar sem pasta" (sessões do cwd default do sidecar) aparece no topo quando tem conteúdo.

## O que falta / próximos passos (deferido)

1. **Verificação viva na GUI** (não foi possível clicar nesta sessão): selecionar modelo, trocar projeto, alternar preset de permissão e aprovar um card ao vivo, alternar Agent/Swarm.
2. **Agent builder** (meta-agente que cria agentes por linguagem natural; portar `generate-agent-config` do VensyAgents em `/Users/victor/Documents/VensyAgentsApp/packages/ai`).
3. **Guardrail de roots** via plugin opencode (`@opencode-ai/plugin`): negar caminhos fora das raízes registradas (replica `ensure_within_roots`, já que as tools do opencode rodam no processo Bun, não no sandbox Rust). Os presets de permissão já cobrem `external_directory`, mas não substituem o sandbox lexical do Rust.
4. **Gestão de MCPs** na UI (`GET/POST /mcp`).
5. **Automação de browser** via MCP (sugestão: Playwright MCP, JS-nativo, sem Python); a superfície WebBridge foi removida da UI em 2026-06-10.
6. **Tema do markdown (streamdown)** usa o default da lib; afinar pros tokens do metacodex.
7. **Tasks** (a seção Tasks na sidebar Work ainda é placeholder).

---

## Arquivos mexidos

**Frontend novos:** `src/features/ui/view.store.ts`; `src/features/agent/{runtime,chat,nav,cron}.store.ts`; `src/components/ui/Segmented.tsx`; `src/components/agent/{AgentView,AgentSidebar,AgentHero,AgentComposer}.tsx`; `src/components/agent/chat/{ChatThread,ChatMessage}.tsx`; `src/components/agent/panels/{PanelShell,SkillsPanel,ScheduledTasksPanel,ComingSoonPanels}.tsx`.

**Frontend editados:** `src/app/TitleBar.tsx` (toggle); `src/app/AppShell.tsx` (overlay + lazy AgentView); `src/lib/ipc.ts` (CMD do agente); `src/features/settings/settings.types.ts` (slice `agent`); `src/components/settings/SettingsDialog.tsx` (AgentPane); `src/features/i18n/locales/{en,pt-BR}.json` (namespace `agent`); `package.json` (+streamdown).

**Rust novos:** `src-tauri/src/agent/{mod,runtime,skills,scheduler}.rs`; `src-tauri/src/commands/agent.rs`.

**Rust editados:** `src-tauri/src/lib.rs` (módulo agent, manage AgentRuntime+CronStore, registro de comandos, start do scheduler, **single-instance pulado em debug**); `src-tauri/src/commands/mod.rs` (`pub mod agent`); `src-tauri/src/config_paths.rs` (override `METACODEX_HOME`); `src-tauri/Cargo.toml` (+reqwest, feature `json`).

**Comandos Tauri adicionados:** `agent_runtime_start|status|stop`, `agent_list_models`, `agent_set_credentials`, `agent_list_skills`, `agent_cron_list|create|update|delete|set_enabled|run_now`.

---

## Dev isolation (por que `pnpm tauri dev` agora roda junto do instalado)

- `lib.rs`: o `tauri-plugin-single-instance` é registrado só em **release** (`#[cfg(not(debug_assertions))]`). Em dev ele é pulado, senão o launch de dev é roteado pro app instalado e nenhuma janela de dev aparece.
- `config_paths.rs`: `config_root()` honra `METACODEX_HOME` (quando setado e não vazio), pra dev usar um dir de estado separado e não pisar no `~/.metacodex` do instalado.
- Ambas as mudanças são inofensivas em produção (var não setada, single-instance ativo).

---

## Convenções a manter

- **Tokens sempre** (`src/styles/tokens.css`), nada de cor hardcoded. Movimento de popup só opacidade.
- **Sem travessão** (—/–) em nenhum texto/código/commit, em qualquer idioma.
- **i18n:** toda string nova vai em `en` + `pt-BR`, nunca hardcode.
- **Skills obrigatórias** em frontend: `frontend-design` + `ui-ux-pro-max`.
- **Git:** commit local ok quando fizer sentido; **nunca push / PR sem pedido explícito** do Victor. Sem trailer `Co-Authored-By: Claude`.
- Adicionar comando Tauri = editar `src-tauri/src/lib.rs` (`generate_handler!`) **e** `src/lib/ipc.ts` (`CMD`).
