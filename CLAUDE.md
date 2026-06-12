# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

metacodex is a premium **local-first developer workspace** built as a Tauri 2 desktop app. It has two top-level views, toggled in the title bar:

- **Code**: VS Code-style file navigation + a terminal-native AI coding workflow (Claude Code, Codex CLI, OpenCode, etc. launched as PTY tabs).
- **Agent**: a first-class agent UI driven by an **opencode sidecar** (chat with streaming, skills browser, cron-scheduled tasks). See "Agent View" below.

macOS-first; the Tauri/Rust shell handles PTYs, filesystem, search, watcher, git, and the agent sidecar/cron, while the React frontend is purely UI/state.

## Commands

Package manager is **pnpm**. There is no test suite for the frontend and no separate lint command: `tsc --noEmit` (run via `pnpm build`) is the only TS static check. The Rust side has unit tests (notably `agent/cron.rs`), run with `cargo test` inside `src-tauri/`.

| Task | Command |
|---|---|
| Run the desktop app (Vite + Tauri) | `pnpm tauri dev` |
| Run dev alongside the installed app (isolated state) | `METACODEX_HOME="$HOME/.metacodex-dev" pnpm tauri dev` |
| Run only the Vite frontend (no native shell) | `pnpm dev` |
| Type-check + production frontend build | `pnpm build` |
| Type-check only | `pnpm exec tsc --noEmit` |
| Rust check / tests | `cargo check` / `cargo test` (in `src-tauri/`) |
| Production Tauri bundle | `pnpm tauri build` |
| Preview built frontend in browser | `pnpm preview` |

The Vite dev server binds to **port 1420** (`strictPort: true`); Tauri's `beforeDevCommand` boots it. Don't change the port without updating `src-tauri/tauri.conf.json`. `src-tauri/**` is excluded from Vite's watcher so Rust changes don't trigger frontend HMR (Tauri reloads the native shell on its own).

**Dev isolation:** `tauri-plugin-single-instance` is registered only in release builds (`#[cfg(not(debug_assertions))]` in `lib.rs`); in debug it is skipped so `pnpm tauri dev` opens its own window instead of being routed to the installed app. `config_paths::config_root()` honors a `METACODEX_HOME` env var (when set and non-empty) so dev state doesn't clobber the installed `~/.metacodex`.

## Architecture

### Two-process split

The boundary is strict: **Rust owns all OS/IO; React owns rendering and ephemeral UI state.** Nothing in `src/` reads from disk or spawns processes directly; every side effect goes through a Tauri command. (One sanctioned exception: the Agent chat talks HTTP directly to the local opencode sidecar, see "Agent View".)

- **Rust commands** are declared in `src-tauri/src/lib.rs::invoke_handler!` and implemented under `src-tauri/src/commands/*`. They return `AppResult<T>`; `AppError` serializes as `{ code, message }` (see `src-tauri/src/error.rs`).
- **TS mirror** lives in `src/lib/ipc.ts`; the `CMD` const enum lists every command name. **Adding a new command requires editing both `lib.rs` and `ipc.ts`** (the comment in `ipc.ts` says so explicitly; treat it as a rule).
- **Events** flow Rust → TS via `tauri::Emitter`. Names are centralized in `src-tauri/src/events.rs` (`EV_*` consts) and `src/lib/events.ts` (`EV` const). Today: `pty://data`, `pty://exit`, `fs://changed`, `project://changed`, `fs://error`.

### Path safety (security-critical)

`src-tauri/src/projects.rs` keeps a `ProjectsCache` (`Arc<RwLock<Vec<Project>>>`) of registered project roots. **Every filesystem command** (`fs_ops.rs`, `search.rs`, `git.rs`) calls `paths::ensure_within_roots(target, &roots)` before touching disk. `is_within` does *lexical* normalization (no symlink resolution, intentional, so a symlink can't escape the sandbox via realpath). If you add a new FS-touching command, it MUST do this check before any `fs::*` call.

Known gap: opencode's own tools run in its Bun process, outside this sandbox. The permission presets cover `external_directory`, but a roots guardrail via an opencode plugin is still a planned item (see `AGENT_VIEW_HANDOFF.md`).

### State (frontend)

State is split into **Zustand stores per feature** (`src/features/<feature>/<feature>.store.ts`):

- `projects.store`: list + active id (hydrated from Rust on mount).
- `tabs` store (`src/components/tabs/tabsStore.ts`): `byProject: Record<projectKey, { tabs, activeTabId }>`. Use `WORKSPACE_NULL` as the bucket key when no project is active (Day-1 users can open terminal tabs before adding any project).
- `explorer`, `git`, `editor` + `editor-status`, `search`, `theme`, `keybindings` (rebindable shortcuts): feature-local slices.
- `settings` (dialog open/close) vs `settings.data` (user preferences, see Persistence): kept separate so the dialog can mount/unmount without thrashing prefs.
- `worktrees` (`features/git/worktrees.store.ts`): list per project + `occupancyByPath` (which paths have a tab pointing at them).
- `source-control` (`features/source-control/sourceControl.store.ts`): right-panel open/closed.
- `resume` (`features/resume/resume.store.ts`): recent agent sessions registry; rendered on Welcome + ProjectEmptyState.
- `terminal` (`features/terminal/terminal.store.ts`): PTY session registry mirroring Rust state.
- `agent-status` (`features/terminal/agent-status.store.ts`): per-tab `idle | working | needs-attention | done` derived from OSC + heuristics; powers the tab status dot and Cmd+Shift+U jump.
- `tabMetadata` (`features/terminal/tabMetadata.store.ts`): per-tab branch / cwd / listening ports, polled via `useTabMetadataPolling`; powers `TabTooltip`.
- `command-palette` (`features/command-palette/command-palette.store.ts`): open + mode (commands vs files).
- `view` (`features/ui/view.store.ts`): which top-level view is active (Agent | Code).
- Agent View stores under `features/agent/`: `runtime.store` (sidecar status), `chat.store` (sessions/messages/streaming, talks HTTP to opencode), `sessions.store` (per-project conversation history + running status + composer drafts; fed by `chat.store`, never imports it back), `nav.store` (sidebar Work|Chat navigation + which Customize tab is open), `cron.store` (scheduled tasks, mirrors Rust `CronStore`).
- Never reach across stores inside a component; derive in `AppShell` or selectors.
- Tabs are **keyed by project**: switching the active project swaps the entire visible tab bucket. Terminals/CLIs from project A stay alive in memory but aren't shown while project B is active.

### Agent View (opencode sidecar)

Full status + test script live in `AGENT_VIEW_HANDOFF.md` (root). The locked-in architecture:

- **Shell:** the Agent | Code toggle lives in `src/app/TitleBar.tsx`; `AgentView` renders as an opaque **overlay** in `AppShell` while the Code view stays mounted underneath, so terminals never die on toggle. `AgentView` is **lazy-loaded** so streamdown/shiki/mermaid stay out of the Code bundle.
- **Engine = opencode**, spawned as a sidecar (`opencode serve --port 0`). We do not write an agent loop. `AgentRuntime` (`src-tauri/src/agent/runtime.rs`) owns spawn / health-check / adopt-existing / kill; the server URL is read from a log file (not a pipe, broken-pipe caused 100% CPU). Provider is opencode-go; keys live in opencode's auth store, never in the webview.
- **Chat = webview talks HTTP directly to the sidecar** (CORS is permissive): `EventSource` on `/event` for streaming + `fetch` for POSTs, all in `features/agent/chat.store.ts` (event mapping in `chat.events.ts`). We deliberately do NOT use AI SDK `useChat`/transport. **streamdown** renders replies (text + collapsible reasoning + tool chips).
- **Rust is the broker only where needed:** sidecar lifecycle, model listing (`agent_list_models` strips provider `key`s, because opencode's `GET /config/providers` leaks them), skills listing (`agent/skills.rs` reads `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`, `~/.metacodex/skills`), and cron.
- **Directory scoping:** every opencode call carries `?directory=<project root>`. Sessions are tied to a directory; switching the project in the composer's `ProjectPicker` restarts the chat. Default = active metacodex project.
- **Permissions:** 3 presets (always-ask / auto-approve-edits / full-auto) map to a `PermissionRuleset` in `features/agent/opencode.ts`, sent on session create and PATCHed live. Live approval requests arrive as SSE `permission.asked` / `permission.v2.asked` events and render as `chat/PermissionCard.tsx`. **`runtime.rs::full_auto_ruleset` is a manual Rust mirror of the TS `rulesetForPreset("full-auto")`**: if you change one, change the other, or headless scheduled runs hang waiting for approval nobody will give.
- **Composer pickers** (`components/agent/composer/`): model (`ModelPicker`, grouped by provider, filtered by `settings.agent.enabledModels`: default shows only opencode-go; Settings → Agent → Models toggles the rest), reasoning effort (`VariantPicker`: appears with a slide-in only when the active model exposes `variants` in the catalog; the chosen name rides the message POST as `variant`, persisted per model in `settings.agent.variantByModel`), project (`ProjectPicker`), permission preset (`PermissionPicker`), and Agent vs Agent Swarm mode. All persist into the `settings.agent` slice (same slice the Settings dialog's Agent tab uses, so they stay in sync). The Settings dialog itself is split into two top-level tabs (Code | Agent) in `SettingsDialog.tsx`; the Agent sidebar's gear opens straight onto the Agent tab via `useSettingsStore.openTab("agent")`. Swarm = same primary agent + a system hint instructing decomposition into subagents via the `task` tool (opencode has no native swarm primary).
- **Attachments:** pending chips live in `features/agent/composer.store.ts` (singleton: fed by the "+" menu, paste, AppShell's global drag-drop branch, and the "@" menu); `attachments.ts` materializes them into opencode file parts (`{type:"file", mime, filename, url}` with `data:`/`file://` URLs, file parts FIRST in `parts[]`). Attachments never ride the persisted drafts and are cleared on project switch. The window-global `onDragDropEvent` in `AppShell` branches on the active view: Agent view = attach, Code view = preview/add-project. Never register a second listener.
- **"/" and "@" autocomplete:** `composer/useMention.ts` (caret-token detection) + `composer/MentionPopup.tsx` (plain absolutely-positioned panel, NOT a Radix menu: a menu would steal textarea focus). "/" lists skills (shared cache in `features/agent/skills.ts`); "@" lists Files & Folders, Branch and Past chats; context chips materialize at send time in `contextParts.ts`. The composer's onKeyDown delegates to the popup BEFORE the Enter-submit branch.
- **Vision relay:** when the active model lacks the `attachment` capability (flag parsed in `runtime.rs::parse_providers`, surfaced on `AgentModel`), image parts detour through `features/agent/visionRelay.ts`: a throwaway one-shot session on a vision model (settings `agent.visionProviderId/visionModelId`, empty = auto via `firstVisionModel`) describes them; the description replaces the images as a text part and the user bubble shows "via vision relay".
- **MCP servers:** opencode reads MCP only from config files, so Rust owns a registry (`agent/mcp.rs`, `McpStore` → `state/agent-mcp.json`) and renders the ENABLED entries to `state/opencode-config.json`, passed to the sidecar via the `OPENCODE_CONFIG` env var (merged on top of the user's global opencode config; regenerated before every spawn). Mutations return `requiresRestart`; the restart is ALWAYS user-triggered (`agent_runtime_restart`): it kills live SSE streams and `--port 0` means a new base URL, which `mcp.store.restart()` re-binds via `chat.store.rebindBase`. Secrets are redacted to a sentinel before crossing IPC and round-trip on save. Featured servers (web search: Brave + Exa via npx) are pinned to the Rust catalog so the label can't smuggle a different command. UI: the MCP tab of the Customize page (`panels/CustomizePanel.tsx` hosts lateral tabs Skills | MCP Servers | Tools; the MCP content lives in `panels/McpPanel.tsx::McpSection`) + the "+" menu submenu.

### Agentes (agent entities)

Design + status: `AGENTS_DESIGN.md` (root); vocabulário em `CONTEXT.md`; ADRs em `docs/adr/`. Resumo do que está construído (fases 1-4):

- **Entidade**: cada Agente vive em `~/.metacodex/agents/<slug>/` (repo git; o harness commita checkpoints): `AGENT.md` (persona), `agent.json` (modelo, preset, projetos, heartbeat, dreamAfterRuns, continuationCap, avatar), `HEARTBEAT.md`, `MEMORY.md` + `memory/` (camadas global e `memory/projects/<key>/`), `skills/` (entra no catálogo do `skills.rs`), `reports/`, `logs/` (`runs.jsonl` + `state.json`), `journal/`, `proposals/`. Rust: `agent/entities.rs` (CRUD, slug = boundary de segurança via `home_dir`) + `agent/life.rs` (memória, logs, reports, propostas, prompts de heartbeat/dream) + `agent/executor.rs` (orquestração das execuções autônomas). `agent.json` é hand-editable e por isso NORMALIZADO na leitura: preset desconhecido falha fechado para "ask", knobs clampados. Concorrência: execuções da mesma entidade são serializadas (claim `entity:<slug>` no running set do CronStore) e toda seção crítica curta sobre o home (state.json, propostas, memória + checkpoint git) passa por `entities::state_mutex(slug)`.
- **Compilação**: entidades viram `config.agent` (`mcx-<slug>`, mode "all") na MESMA camada `OPENCODE_CONFIG` do MCP (`mcp.rs::regenerate_opencode_config`). PATCH /config não funciona (spike 2026-06-11); hot-apply = `POST /global/dispose` + reload do catálogo (`entities.store::hotApply`), sem restart do sidecar.
- **Chat**: AgentPicker no composer espelha a entidade selecionada em `chat.store.entity` (deps continuam periferia → chat.store; o caminho inverso é por injeção: `registerSessionEntityHandler`); entity trava modelo/variant/preset (pickers individuais somem) e troca de entidade faz `stop()` (drena a fila pro composer) + sessão nova; editar o preset da entidade selecionada re-aplica o ruleset na sessão viva (PATCH). Sessões são carimbadas com `metadata.entityId` na criação e `selectSession` re-vincula a entidade dona (sem misturar personas). Memória entra como `system` em todo send, inclusive slash commands (`chat.store::entitySystem` → `agent_entity_memory_context`).
- **Execução autônoma**: `executor.rs::run_entity_execution` (future BOXADA: execução spawna dream que é execução) + `runtime.rs::run_entity_turn` (`run_prompt` é um wrapper fino dele). Preset DO agente (espelho Rust dos 3 rulesets em `ruleset_for_preset`, pinado pelo teste `ruleset_mirrors_frontend_presets`; default = fail-closed "ask"), Continuação `CONTINUE:` / `CONTINUE_IN N:` com cap (marker procurado nas últimas linhas), report escrito pelo harness, dream após N execuções ok (só o dream COMPLETO zera o contador; full-auto, `?directory=<home>`), heartbeat no tick do scheduler (`HEARTBEAT_OK` = log-only). Permissão pendente em run autônoma: asks com alvo dentro do agent home são AUTO-APROVADOS pelo watcher (memória/journal/propostas em preset restritivo); o resto vira notificação OS + linha "needs-you (pending)" imediata no runs.jsonl (com session id) + abort no budget de 30 min; aprovar = abrir a conversa da run pela aba Atividade (cobre heartbeat/dream, cujas sessões vivem no home e não aparecem em projeto nenhum). Antes de cada run autônoma o executor regenera o OPENCODE_CONFIG + `POST /global/dispose` (hand-edits nunca ficam stale).
- **UI**: section `agents` no `nav.store`; `panels/AgentsPanel.tsx` (lista + perfil com abas Persona | Memória | Atividade | Propostas | Agenda) + `entities/` (builder com avatar emoji/foto e "descreva o agente" via `entities.fromText.ts`, AgentAvatar, AgentProfileTabs). Propostas: aprovar aplica bloco ```persona ao AGENT.md; rejeitar vira memória.

### Cron / Scheduled Tasks

- **Evaluator:** `src-tauri/src/agent/cron.rs` is a hand-rolled, self-contained, unit-tested standard 5-field cron parser/matcher (Vixie DOM/DOW OR-semantics, names, steps, ranges, lists). No crate on purpose: the cron string is the portability artifact a future external scheduler (trigger.dev, Railway, GitHub Actions) consumes, so it must stay plain standard cron.
- **Scheduler:** `agent/scheduler.rs` (`CronStore`, managed in `lib.rs`). A tokio tick every 20s matches tasks against the local clock; dedupe per minute via `last_fired_minute`. Due tasks fire concurrently as **headless opencode runs**: standalone tasks via `runtime.rs::run_prompt` (full-auto, original behavior), tasks with `agent_id` as an Execution of that agent entity (`run_entity_execution`: its persona, memory, preset, report + run log). The same tick also fires due agent heartbeats. Runs only while the app is open. Persists to `~/.metacodex/state/agent-cron.json`. `next_run_at` is display-only derived state, never the firing source of truth.
- **UI:** `components/agent/panels/ScheduledTasksPanel.tsx` + `ScheduledTaskDialog.tsx` + `CronField.tsx` (presets + human description via `cronstrue`, en/pt-BR, in `features/agent/cron.describe.ts`). The cronstrue Save gate is optimistic; the Rust evaluator is the real authority and rejects on save. "Create from chat" (`cron.fromText.ts`) runs a throwaway one-shot prompt to prefill the dialog, never auto-saves.
- Commands: `agent_runtime_start|status|stop|restart`, `agent_list_models`, `agent_set_credentials`, `agent_list_skills`, `agent_cron_list|create|update|delete|set_enabled|run_now`, `agent_mcp_list|featured|upsert|delete|set_enabled|status`, `agent_entity_list|create|update|delete`, `agent_entity_memory_context|tree|read|write|delete`, `agent_entity_activity`, `agent_entity_proposals|proposal_resolve`, `agent_entity_heartbeat_read|write`, `agent_entity_status`.

### Persistence (`~/.metacodex/`)

All persistence lives in a `~/.metacodex/` dot-folder in the user's home (NOT `~/Library/Application Support`; `tauri-plugin-store` was removed). Rust writes plain, pretty-printed, hand-editable JSON directly via `src-tauri/src/config_paths.rs` (atomic tmp→rename; carries a `// SECURITY:` carve-out from `ensure_within_roots` since these files sit outside project roots). Config (user-editable) is split from state (app-managed):

```
~/.metacodex/
├── settings.json        # user prefs (theme, language, fonts, terminal, debounces, uiDensity, agent)
├── keybindings.json     # shortcut overrides (only what differs from defaults)
└── state/
    ├── projects.json     # registry + lastActiveProjectId
    ├── resume.json       # recent agent sessions (pruned to last 30 days at boot)
    ├── agent-cron.json   # scheduled tasks + run history (CronStore)
    ├── agent-mcp.json    # MCP server registry (holds API keys; written 0600)
    ├── opencode-config.json # GENERATED opencode config layer (OPENCODE_CONFIG); never hand-edit
    └── workspace/{id}.json  # per-project: open tabs, active tab, expanded paths
```

`config_paths::ensure_dirs()` runs in `lib.rs` setup **before** `projects::hydrate` and `CronStore::load()` (load persists, so dirs must exist first). The settings/keybindings commands pass an opaque `serde_json::Value`: the frontend owns the schema + validation, so adding a pref needs no Rust recompile.

`AppShell.tsx` saves a `WorkspaceState` per project, debounced (the delay is the `workspaceSaveDebounceMs` setting, default 350). **Terminals and CLI tabs are intentionally NOT persisted** (see the comment in `src-tauri/src/commands/workspace.rs`: shells aren't auto-respawned on app start). Only `editor | markdown | image | pdf` round-trip through `SerializedTab`. `hydratedWorkspaces: Set<string>` in `AppShell` guards against clobbering persisted state with an empty bucket on the first render after a project switch.

User preferences hydrate into `src/features/settings/settings.data.store.ts` (`AppSettings` + `DEFAULT_SETTINGS` + clamping `mergeSettings`); it persists debounced and is the single source of truth for tunables (editor/terminal fonts, scrollback, cursor, sticky headers, debounces, agent provider/model/mode). **Do NOT expose terminal `lineHeight` or the file-read size limits as settings** (breakage risk: see the xterm lineHeight rule below).

### PTY model

`PtyManager` in `src-tauri/src/pty/mod.rs` is the singleton state owned by Tauri (`app.manage(...)` in `lib.rs`). Each session:

1. Allocates a master/slave pair via `portable_pty::native_pty_system`.
2. Spawns the child via a **dedicated `std::thread`** doing blocking `reader.read(...)` into an `mpsc::unbounded_channel` (don't try to make this async; `portable-pty`'s reader is blocking).
3. A `tokio::spawn` drainer emits `pty://data` (base64-encoded bytes) per chunk.
4. A second `tokio::spawn` polls `child.try_wait()` every 250ms and emits `pty://exit`. A `Notify` cancel token lets `pty_kill` short-circuit the loop.

Shells are launched via `pty/shell.rs::detect_login_shell` (`$SHELL -l` on Unix). **CLIs launch through `$SHELL -l -i -c "<cli args>"`** so `.zshrc`/`.zprofile`/`mise`/`nvm` re-source PATH before the CLI execs. The Tauri GUI process inherits a sparse PATH on macOS, so without this, `claude` / `codex` / etc. won't be on PATH.

### xterm.js quirk (do not break this)

`src/components/terminal/useXterm.ts` has a load order that took debugging:

1. Construct `Terminal` with **explicit `cols`/`rows`** (e.g. 100×28); passing nothing crashes `term.open()`.
2. `loadAddon(FitAddon)` → `loadAddon(WebLinksAddon)` → `term.open(container)`.
3. **Defer `CanvasAddon` and the first `fit.fit()` to `requestAnimationFrame`**: xterm.js v5.5 crashes if the canvas renderer attaches before its internal init completes. Falling back to the DOM renderer is acceptable (we `console.warn` on canvas failure).

If you touch this, test with Cmd+T (new terminal) → resize the window → switch theme. All three must keep working.

### File watcher

One `notify_debouncer_mini::Debouncer` per project root, lifecycle owned by `WatcherManager` (a `parking_lot::Mutex<HashMap<projectId, Debouncer>>`). `AppShell` calls `watcherApi.watch(project.id, project.path)` when a project becomes active and `unwatch` on cleanup. `fs://changed` events carry `{ projectId, paths }`; the listener in `AppShell` invalidates explorer caches for affected directories and refreshes git status.

### Theming

- **Tokens drive everything.** Never hardcode colors in components. Tailwind `colors: { canvas, ink, hairline, ... }` map to CSS variables in `src/styles/tokens.css`. Light/dark switches via `data-theme` on `<html>`.
- **Type scale is enforced** (since 2026-06-11): use the Tailwind tiers `text-label` (11) / `text-caption` (12) / `text-ui` (13) / `text-content` (14, chat+markdown prose) / `text-title` (15) / `text-display-s|display|display-l`. Never `text-[Npx]`, with two sanctioned exceptions: the 10px mono micro-label pattern (Badge, Kbd, `editorial-caps`) and one-off display sizes on hero surfaces. Uppercase eyebrows = `text-label tracking-label` (or 10px micro-label), never ad-hoc `tracking-[0.0Nem]`. **If you add a fontSize tier to `tailwind.config.js`, register it in `src/lib/cn.ts`** (tailwind-merge classGroups), or twMerge will treat it as a text COLOR and silently drop it when merged with `text-ink`/`text-muted`.
- **Radius**: token classes only (`rounded-xs|sm|md|lg|xl|pill`). Never `rounded-full` (use `rounded-pill`), never `rounded-2xl`, never `rounded-[var(--radius-*)]` (the named class compiles to the same CSS). Dialogs = `md`, menus = `md` with `sm` items, chat/cards = `lg`+`xl`, inputs/buttons = `sm`.
- **Motion durations**: bare `transition-*` defaults to `--dur-fast` (set in `tailwind.config.js`); use `duration-fast|base|slow` when explicit. Never `duration-100/150/200/300`.
- **Buttons**: use `Button` (`components/ui/Button.tsx`) for text buttons and `IconButton` (`components/ui/IconButton.tsx`, sizes sm 18 / md 24 / lg 28) for icon-only controls instead of ad-hoc `<button>` styling; both carry the canonical hover (`surface-strong/55`), focus ring, `disabled:opacity-40`, and (Button primary) `press-feedback`. Primary CTAs styled by hand must include `press-feedback` + a focus-visible treatment.
- **Text over update-blue surfaces** uses `text-on-update` (white in both themes); `text-on-primary` would fail contrast in dark mode there.
- The xterm theme is built from the same CSS vars (`--term-*`) and re-applied on theme change.
- Dark/light follows `prefers-color-scheme` by default; user can override via Settings (`Cmd+,`). The choice persists to `~/.metacodex/settings.json` (the durable source of truth); `localStorage` (`metacodex:theme`) is kept only as a synchronous first-paint cache to avoid a theme flash on boot. `theme.store.ts` stays unaware of settings; `settings.data.store` subscribes to it one-way (no import cycle).

## Conventions to follow

- **Never use em-dashes** (`—`/`–`) in any text: code comments, UI copy, docs, commit messages, any language. Use comma, colon, parentheses, or rewrite. Hyphen only for compound words and ranges.
- **i18n everywhere:** react-i18next with `en` (default) + `pt-BR`. Never hardcode UI strings; add keys to BOTH locale JSONs (`src/features/i18n/locales/`) and use `t()`/`Trans`.
- **Explorer is fully mutable** (since 2026-05-21): create / rename / delete / drag-move all wired through `explorer.store` → Rust commands (`create_file`, `create_dir`, `rename_path`, `delete_path`, `move_path`). Every mutation passes `ensure_within_roots` (no path outside a registered project root can be touched). Moves **refuse on conflict** rather than overwrite. If you add a new mutation, it MUST: (a) go through a roots-checked Rust command, (b) write atomically, (c) call `tabsStore.remapForRename` / `closeForRemovedPath` so open editor tabs follow.
- **Atomic writes** for files: write to `<path>.<ext>.metacodex.tmp`, then `rename`. See `fs_ops::write_file_text` (project files, roots-checked) and `config_paths::write_json_atomic` (`~/.metacodex` config, app-derived paths).
- **Popup motion:** all popups share one pure-opacity fade (no slide/scale, no backdrop-blur). Opacity-only is load-bearing (transform breaks modal centering).
- **Path aliases**: `@/*` → `src/*` (Vite + tsconfig). Imports inside `src/` should use `@/...` not relative `../../`.
- **IDs**: `nanoid` on the frontend (via `src/lib/idGen.ts` `newId(n)`); UUIDv4 on the Rust side for PTY session ids.
- **Strict TS**: `noUnusedLocals` + `noUnusedParameters` are on. Prefix intentionally-unused parameters with `_`.
- **Keyboard shortcuts** are rebindable. Declare the command in `src/features/keybindings/commands.ts` (id + default binding + i18n key), then route its id to a side effect in `KeyboardShortcuts.tsx`'s `dispatchCommand`, which calls either a handler on `window.__metacodex` (attached by `AppShell`) or a store. `KeyboardShortcuts` resolves events through `useKeybindingsStore` (no hardcoded key checks); user overrides persist to `keybindings.json`. Editor-scoped shortcuts stay in CodeMirror's keymap (`EditorTab.tsx`), not the global registry.
- **Tauri capabilities** live in `src-tauri/capabilities/default.json`. New plugin permissions must be added there or the IPC silently rejects.
- **Drag & drop:** prefer pointer events + `setPointerCapture` over HTML5 drag (WKWebView silently cancels `dragstart` through composed Radix Slots).
- **`pnpm-lock.yaml` is committed**; keep it in sync, don't introduce `npm install`/`yarn add`.

## Where to look first

| You want to… | Start here |
|---|---|
| Add a new Tauri command | `src-tauri/src/commands/<area>.rs` + register in `lib.rs::invoke_handler!` + mirror in `src/lib/ipc.ts::CMD` |
| Change app shell layout | `src/app/AppShell.tsx` (grid template lives there) |
| Agent View shell / Agent|Code toggle | `src/app/TitleBar.tsx` (toggle) + `features/ui/view.store.ts` + `components/agent/AgentView.tsx` (lazy overlay in `AppShell`) |
| Agent chat (streaming, sessions, permissions) | `features/agent/chat.store.ts` + `chat.events.ts` + `opencode.ts` (rulesets/types); UI in `components/agent/chat/` + `composer/` |
| Composer attachments / "@" e "/" autocomplete | `features/agent/composer.store.ts` + `attachments.ts` + `contextParts.ts`; UI `components/agent/composer/{AttachmentChips,PlusMenu,MentionPopup,useMention}` |
| Vision relay (image → text for non-vision models) | `features/agent/visionRelay.ts` + `runtime.store.ts::firstVisionModel`; capability flag from `runtime.rs::parse_providers` |
| MCP servers (registry, featured Brave/Exa, restart) | `src-tauri/src/agent/mcp.rs` (McpStore + config generator) + `features/agent/mcp.store.ts`; UI `components/agent/panels/CustomizePanel.tsx` (MCP tab, content in `McpPanel.tsx::McpSection`) + PlusMenu submenu |
| Sidebar conversation history (per project, pin/archive/drafts) | `features/agent/sessions.store.ts`; UI in `components/agent/SidebarThreads.tsx` + `ProjectSection.tsx`; drafts + expansion persist via `agent_ui_state_read`/`agent_ui_state_write` |
| Agent sidecar lifecycle / models / skills | `src-tauri/src/agent/runtime.rs` + `skills.rs`; commands in `src-tauri/src/commands/agent.rs`; `features/agent/runtime.store.ts` |
| Scheduled Tasks / cron | `src-tauri/src/agent/cron.rs` (evaluator) + `scheduler.rs` (CronStore); UI `components/agent/panels/ScheduledTask*` + `CronField.tsx`; `features/agent/cron.store.ts` + `cron.describe.ts` + `cron.fromText.ts` |
| Add a new tab kind | `src/components/tabs/types.ts` (discriminated union) → `TabContent.tsx` (renderer) → `AppShell.handleOpenFile` (routing) |
| Add a new CLI to the launcher | `src/features/terminal/cli-registry.ts::DEFAULT_CLI_REGISTRY` |
| Add/change a user setting | `src/features/settings/settings.types.ts` (`AppSettings` + `DEFAULT_SETTINGS` + `mergeSettings`) → wire its consumer → control in `SettingsDialog.tsx` + i18n keys (both locales) |
| Add/rebind a keyboard shortcut | `src/features/keybindings/commands.ts` (registry) → dispatch in `KeyboardShortcuts.tsx` |
| Touch the right panel (Source Control) | `src/components/source-control/SourceControlPanel.tsx` + `features/source-control/sourceControl.store.ts` (open/closed) |
| Worktrees (list / create / merge) | `features/git/worktrees.store.ts` + `worktrees.service.ts` + `components/source-control/Worktree*Dialog.tsx`; Rust side in `commands/git.rs` (`git_worktree_*`, `git_merge_into`) |
| Resume registry (recent agent sessions) | `features/resume/resume.store.ts` + `components/resume/ResumeCards.tsx`; Rust side `commands/resume.rs` (persists to `~/.metacodex/state/resume.json`) |
| Agent status (idle/working/needs-attention/done) | OSC parsing in `components/terminal/oscHandlers.ts` + heuristic in `agentHeuristic.ts` → writes to `features/terminal/agent-status.store.ts` |
| Tab tooltip / per-tab branch+ports | `features/terminal/tabMetadata.store.ts` + `useTabMetadataPolling` → `components/tabs/TabTooltip.tsx` |
| OS notifications / sound | `commands/notifications.rs` (`notify_show`) ← dispatched from `features/terminal/notificationDispatch.ts` when an agent event fires |
| UI density (compact / comfortable / spacious) | `settings.types.ts::UI_DENSITY_MULTIPLIER` → `AppShell` writes `--density-multiplier` → every `--space-*` token in `tokens.css` is `calc()` against it |
| Empty / loading / missing state | `components/ui/EmptyState.tsx` (shared chrome: hairline card, Fraunces display, optional icon) |
| Where config + state persist | `~/.metacodex/` via `src-tauri/src/config_paths.rs` (honors `METACODEX_HOME`) |
| Tweak design tokens | `src/styles/tokens.css` (light + dark blocks) → `tailwind.config.js` if exposing a new token to Tailwind classes |
| Tauri app config (window, identifier, bundle) | `src-tauri/tauri.conf.json` |
| Tauri capability/ACL grants | `src-tauri/capabilities/default.json` |
| Agentes (entidades: builder, perfil, memória, propostas) | `AGENTS_DESIGN.md` (design) + `src-tauri/src/agent/{entities,life}.rs` + `features/agent/entities.store.ts` + `components/agent/{panels/AgentsPanel.tsx,entities/,composer/AgentPicker.tsx}` |
| Execução autônoma de agente (continuação, report, dream, heartbeat) | `src-tauri/src/agent/executor.rs` (orquestração + status por entidade) + `runtime.rs::run_entity_turn` + `life.rs` (prompts e arquivos) |
| Agent View status / live-test script | `AGENT_VIEW_HANDOFF.md` (root) + review notes in `REVIEW_CRON_SCHEDULED_TASKS.md` |
| Agent View roadmap (P1/P2: revert, compact, fila de prompts, commands, shell, fork...) | `AGENT_HARNESS_FEATURES.md` (root): plano de implementação por feature, com APIs do opencode e critérios de aceite |
