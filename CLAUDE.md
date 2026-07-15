# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

metacodex is a premium **local-first developer workspace** built as a Tauri 2 desktop app: VS Code-style file navigation plus a terminal-native AI coding workflow (Claude Code, Codex CLI, OpenCode, etc. launched as PTY tabs). macOS-first with a full Windows port (cfg-guarded, single codebase). The Tauri/Rust shell owns PTYs, filesystem, search, watcher and git; the React frontend is purely UI/state.

**Removed feature, do not resurrect:** the second top-level view ("Agent view": opencode sidecar, agent chat, cron, MCP registry, agent entities) was removed in v0.0.12. The root docs `AGENT_VIEW_HANDOFF.md`, `AGENTS_DESIGN.md`, `AGENT_HARNESS_FEATURES.md`, `AGENT_P1_TEST_CHECKLIST.md` and `REVIEW_CRON_SCHEDULED_TASKS.md` describe that removed feature and are historical only. The single surviving code reference is the startup migration `config_paths.rs::archive_legacy_agent_state()`, which moves old agent state into `state/legacy-agent/`. Note the word "agent" elsewhere in the codebase refers to the LIVE terminal-CLI feature (per-tab status of coding agents like Claude Code running in a PTY), not the removed view.

**Removed feature, do not resurrect:** remote SSH projects were removed after the initial implementation proved to be the wrong product direction. The only surviving code is startup compatibility that archives old access and trust state under `state/legacy-ssh/`, removes legacy SSH projects from the active registry, and archives their workspace state.

## Commands

Package manager is **pnpm**. There is no frontend test suite and no separate lint command: `tsc --noEmit` (run via `pnpm build`) is the only TS static check. The Rust side has unit tests (notably the path sandbox in `util/paths.rs`), run with `cargo test` inside `src-tauri/`.

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

The Vite dev server binds to **port 1420** (`strictPort: true`); Tauri's `beforeDevCommand` boots it. Don't change the port without updating `src-tauri/tauri.conf.json`. `src-tauri/**` is excluded from Vite's watcher so Rust changes don't trigger frontend HMR.

**Dev isolation:** `tauri-plugin-single-instance` is registered only in release builds (`#[cfg(not(debug_assertions))]` in `lib.rs`); in debug it is skipped so `pnpm tauri dev` opens its own window instead of being routed to the installed app. `config_paths::config_root()` honors a `METACODEX_HOME` env var (when set and non-empty) so dev state doesn't clobber the installed `~/.metacodex`.

## Architecture

### Two-process split

The boundary is strict: **Rust owns all OS/IO; React owns rendering and ephemeral UI state.** Nothing in `src/` reads from disk or spawns processes directly; every side effect goes through a Tauri command.

- **Rust commands** are declared in `src-tauri/src/lib.rs::invoke_handler!` and implemented under `src-tauri/src/commands/*`. They return `AppResult<T>`; `AppError` serializes as `{ code, message }` (see `src-tauri/src/error.rs`).
- **TS mirror** lives in `src/lib/ipc.ts`; the `CMD` const lists every command name. **Adding a new command requires editing both `lib.rs` and `ipc.ts`** (treat it as a rule). Never `invoke()` with a raw string.
- **Events** flow Rust to TS via `tauri::Emitter`. Names are centralized in `src-tauri/src/events.rs` (`EV_*` consts; `fs://changed` lives in `watcher.rs`) and `src/lib/events.ts` (`EV` const). Today: `pty://data`, `pty://exit`, `pty://backpressure`, `fs://changed`, `fs://renamed`, `app://before-quit`, `git://clone-progress`, `app://open-file`.

### Path safety (security-critical)

`src-tauri/src/projects.rs` keeps a `ProjectsCache` (`Arc<RwLock<Vec<Project>>>`) of registered project roots. **Every filesystem command** (`fs_ops.rs`, `search.rs`, `git.rs`) calls `paths::ensure_within_roots(target, &roots)` before touching disk. The guard: (1) rejects any `..` component fail-closed (a `..` can hide a symlinked component from the walk), (2) checks lexical containment in a registered root (no realpath, intentional), (3) walks each component below the root and rejects symlinks.

Paths OUTSIDE project roots are reachable only through unforgeable grants minted behind consent boundaries: `preview_grants.rs` (files opened via preview mode or macOS "Open With", see `open_files.rs`) and `directory_grants.rs` (clone parent dirs picked via native dialog). `config_paths.rs` carries the `~/.metacodex` carve-out. If you add a new FS-touching command it MUST validate through one of these paths before any `fs::*` call.

### Shell layout (post v0.0.12 redesign)

- `src/app/AppShell.tsx` owns only the CSS grid and top-level composition: a title bar row (`--title-bar-h`, 44px) over columns [projects sidebar | explorer | center | side panel (optional right column: launcher or Git/Review)]. The sidebars are floating cards separated by gap columns; the gaps come from `--panel-gap-x` / `--panel-gap-y` (tokens.css) and collapse to 0 with their panel in the same `grid-template-columns` transition. That transition is always on except while a `ResizeHandle` is being dragged (`resizing` flag). Bootstrap, filesystem sync, workspace persistence and tab actions live in `src/app/hooks/`.
- The projects sidebar has two forms, toggled from the title bar and persisted in `features/ui/codeSidebar.store.ts` (localStorage): the collapsed icon rail (`components/project-rail/MiniProjectSidebar.tsx`) and the expanded list (`components/code-sidebar/ExpandedProjectsSidebar.tsx` + `CodeProjectGroup.tsx`) with nested per-project sections: Histórico (resume registry), and in vertical layout also Agentes, Terminais and Arquivos (open file tabs).
- **Projects reorder by drag in BOTH sidebar forms** through the shared `components/ui/useListReorder.tsx` hook (pointer events, 8px threshold, trailing-click suppression, `data-no-drag` opt-out for nested interactive regions). Do NOT add `setPointerCapture` there: capturing suppresses the nested button's click under composed Radix Slots in WKWebView (see the hook's note). The context menu also offers Move up / Move down as the keyboard-friendly path. Order persists via `reorder_projects`.
- **Active project identity:** accent bar + medium label on the expanded row (`SidebarRow` `accent` prop), accent bar + tinted glyph on the rail tile, and glyph + name in the title bar center. **Per-project session status** (worst of the per-tab agent statuses, plus session count) renders as a dot on the row and as a tile corner badge: rollup in `features/terminal/projectStatus.ts`, dot in `components/project-rail/ProjectStatusDot.tsx`, tone mapping shared with the tab dot in `components/tabs/statusTone.ts`.
- `interface.layoutMode` setting: `horizontal` (top tab bar, sidebar shows only Histórico) or `vertical` (no tab bar; the sidebar sections are the ONLY tab management surface, which is why the Arquivos section must list every non-process tab kind).
- Title bar (`src/app/TitleBar.tsx`): sidebar toggle + add-project (open folder / clone from GitHub) on the left; active project glyph + name, branch (ahead/behind) and `UpdatePill` center; the side panel toggle right; custom min/max/close controls on Windows only. (Workspace save failures surface in the Cmd+Shift+D diagnostics log, not a title-bar dot.)

### State (frontend)

Zustand stores per feature (`src/features/<feature>/*.store.ts`):

- `projects/project.store.ts`: list + activeProjectId. Its `remove()` tears down every live resource (PTYs, tab bucket, explorer/git caches, watcher) BEFORE the Rust registry forgets the project.
- `tabs` store (`src/components/tabs/tabsStore.ts`): `byProject: Record<projectKey, { tabs, activeTabId }>`; `WORKSPACE_NULL` is the bucket key when no project is active.
- `explorer`, `git`, `editor` + `editor-status`, `search`, `theme`, `keybindings`, `worktrees`, `resume`, `terminal`, `command-palette`: feature-local slices.
- `settings` (dialog open/close) vs `settings.data` (user preferences, the single source of truth for tunables).
- `terminal/agent-status.store.ts`: per-tab `idle | working | needs-attention | done` derived from OSC + heuristics; powers the tab dot, the per-project rollup and Cmd+Shift+U.
- `terminal/tabMetadata.store.ts`: per-tab branch / cwd / listening ports (polled); powers `TabTooltip` and the sidebar port chips.
- `side-panel/sidePanel.store.ts`: the right column's single `view` (`closed | launcher | review`).
- `diagnostics/diagnostics.store.ts`: the Cmd+Shift+D diagnostic log panel (also where workspace save failures are recorded).
- `updates/updates.store.ts`: updater lifecycle (silent boot check, `UpdatePill`, About pane).
- `ui/codeSidebar.store.ts` (collapsed + per-project expansion, localStorage) and `ui/toast.store.ts`.
- Never reach across stores inside a component; derive in `AppShell`, app hooks or selectors. Cross-surface commands go through `src/app/appCommands.ts`, registered by `AppShell` and read by keyboard shortcuts, command palette, editor keymaps and preview controls. Tabs are keyed by project: switching projects swaps the visible bucket; terminals from other projects stay alive in memory.

### Persistence (`~/.metacodex/`)

Plain, pretty-printed, hand-editable JSON written atomically (tmp then rename) via `src-tauri/src/config_paths.rs`. Config (user-editable) split from state (app-managed):

```
~/.metacodex/
├── settings.json        # user prefs (theme, language, fonts, terminal, debounces, uiDensity, layoutMode)
├── keybindings.json     # shortcut overrides (only what differs from defaults)
└── state/
    ├── projects.json     # registry + lastActiveProjectId (ordering = sidebar order)
    ├── resume.json       # recent CLI sessions (pruned to last 30 days at boot, prune_blocking)
    ├── last-session.log  # diagnostics ring-buffer dump on quit
    ├── last-crash.json   # last ErrorBoundary catch
    ├── legacy-agent/     # archived state from the removed Agent view (startup migration)
    ├── legacy-ssh/       # archived state from the removed SSH feature (startup migration)
    └── workspace/{id}.json  # per-project: open tabs, active tab, expanded paths
```

`config_paths::ensure_dirs()` runs in `lib.rs` setup before `projects::hydrate`. The settings/keybindings commands pass an opaque `serde_json::Value`: the frontend owns the schema + validation (`settings.types.ts::mergeSettings` clamps every field), so adding a pref needs no Rust recompile.

`src/app/hooks/useWorkspacePersistence.ts` saves a `WorkspaceState` per project, debounced (`workspaceSaveDebounceMs`, default 350), with a flush handshake on quit (`app://before-quit`). **Terminals and CLI tabs are intentionally NOT persisted**; only `editor | markdown | image | pdf` round-trip through `SerializedTab` (`commands/workspace.rs`). A per-project `hydrationStatus` map (`pending | loaded | failed`) guards against clobbering persisted state with an empty bucket after a failed or not-yet-finished load.

### PTY model

`PtyManager` in `src-tauri/src/pty/mod.rs` is managed singleton state. Each session:

1. Allocates a master/slave pair via `portable_pty::native_pty_system`.
2. Spawns a dedicated blocking reader `std::thread` feeding a **bounded** `mpsc::channel` (4096 chunks; when the drainer lags, `blocking_send` parks the reader and a `pty://backpressure` event is emitted at most 1/s). Don't make this async; the reader is blocking. Chunks are never dropped (TUIs emit stateful ESC sequences).
3. A `tokio::spawn` drainer batches and emits `pty://data` (base64).
4. A waiter task polls `child.try_wait()` and emits `pty://exit` with a `reason` (`normal | reader_error | killed | drainer_stalled`); it is the ONLY emitter of exit events and the only code that evicts the session. A `Notify` cancel token + level-triggered `killed`/`reader_failed` flags close the lost-wakeup races. On Windows each child is wrapped in a KILL_ON_JOB_CLOSE Job Object.

Shells launch via `pty/shell.rs::detect_login_shell` (`$SHELL -l` on Unix). **CLIs launch through `$SHELL -l -i -c "<cli args>"`** so `.zshrc`/`mise`/`nvm` re-source PATH before the CLI execs (the GUI process inherits a sparse PATH on macOS). The command string is built ONLY from the static `cli-registry.ts`; any interpolated dynamic value must be shell-escaped (see `resumeLaunch.ts`).

### xterm.js quirk (do not break this)

`src/components/terminal/useXterm.ts` has a load order that took debugging:

1. Construct `Terminal` with **explicit `cols`/`rows`** (e.g. 100×28); passing nothing crashes `term.open()`.
2. `loadAddon(FitAddon)` then `loadAddon(WebLinksAddon)` then `term.open(container)`.
3. **Defer `CanvasAddon` and the first `fit.fit()` to `requestAnimationFrame`**: xterm.js v5.5 crashes if the canvas renderer attaches before its internal init completes. Falling back to the DOM renderer is acceptable (`console.warn` on canvas failure).

Also load-bearing: terminal `lineHeight` stays 1.0 (box-drawing glyphs), never `fit()` a hidden (display:none) terminal, and force `viewport.syncScrollArea` after a no-op fit. If you touch this, test Cmd+T, window resize and theme switch.

### File watcher

One `notify_debouncer_mini::Debouncer` per project root, owned by `WatcherManager`. `src/app/hooks/useFilesystemSync.ts` calls `watcherApi.watch/unwatch` on project switch; `projects::remove` ALSO unwatches on the backend (authoritative teardown, the frontend call is best-effort). `watch()` is idempotent per (id, path). Emitted paths have their canonicalized prefix rewritten back to the requested root (FSEvents resolves symlinks/firmlinks; the explorer caches by the raw root, so without the rewrite events would never match). `fs://changed` carries `{ projectId, paths }`; the filesystem sync hook refreshes dir + subtree (macOS coalesces bursts into dir-level events) and throttles git status.

### Theming

- **Tokens drive everything.** Never hardcode colors in components. Tailwind `colors: { canvas, ink, hairline, ... }` map to CSS variables in `src/styles/tokens.css`. Light/dark switches via `data-theme` on `<html>`.
- **11 selectable themes** live in `src/features/theme/themes/*.ts`, all typed by `Theme` (`theme/types.ts`) so every theme is forced to define the full `chrome`/`syntax`/`terminal` key set. `applyTheme.ts` writes those vars; accents, atmosphere, shadows and `--update-blue*` stay per-kind (light|dark) in `tokens.css`.
- **Type scale is enforced:** `text-micro` (10, mono metadata) / `text-label` (11) / `text-caption` (12) / `text-ui` (13) / `text-content` (14) / `text-title` (15) / `text-display-*`. Never `text-[Npx]`; the only sanctioned exception is one-off display sizes on hero surfaces. Section eyebrows/titles are sentence case (first letter capitalized only) via `editorial-caps`; never all-caps titles. `tracking-label` survives only on micro badges/chips (`Badge`). **If you add a fontSize tier to `tailwind.config.js`, register it in `src/lib/cn.ts`** (tailwind-merge classGroups) or twMerge will treat it as a text COLOR and drop it silently.
- **Radius:** token classes only (`rounded-xs|sm|md|lg|xl|pill`). Never `rounded-full` / `rounded-2xl` / `rounded-[var(...)]`.
- **Motion:** bare `transition-*` defaults to `--dur-fast`; use `duration-fast|base|slow` when explicit. Never `duration-100/150/200/300`.
- **Buttons:** use `Button` / `IconButton` from `components/ui/` instead of ad-hoc `<button>` styling; hand-styled primary CTAs must include `press-feedback` + a focus-visible treatment.
- Text over update-blue surfaces uses `text-on-update`.
- The xterm theme is built from the same CSS vars (`--term-*`) and re-applied on theme change. Theme choice persists to `settings.json`; `localStorage` is only a first-paint cache.

## Conventions to follow

- **Never use em-dashes** in any text: code comments, UI copy, docs, commit messages, any language. Use comma, colon, parentheses, or rewrite. Hyphen only for compound words and ranges.
- **i18n everywhere:** react-i18next with `en` (default) + `pt-BR`. Never hardcode UI strings; add keys to BOTH locale JSONs (`src/features/i18n/locales/`) and use `t()`/`Trans`.
- **Explorer is fully mutable:** create / rename / delete / drag-move via roots-checked Rust commands; moves refuse on conflict; every mutation writes atomically and calls `tabsStore.remapForRename` / `closeForRemovedPath`.
- **Atomic writes** for files: `<path>.<ext>.metacodex.tmp` then rename (`fs_ops::write_file_text`, `config_paths::write_json_atomic`).
- **Popup motion:** all popups share one pure-opacity fade (no slide/scale, no backdrop-blur). Opacity-only is load-bearing (transform breaks modal centering).
- **Floating placement:** every floating element keeps an 8px viewport margin and opens AWAY from the nearest screen edge. Prefer Radix primitives (`DropdownMenu`/`ContextMenu`/`Select`/`Tooltip`); the shared wrappers in `components/ui/` already default `collisionPadding={8}`. See `MENU_UX_PLAN.md`.
- **Keyboard shortcuts** are rebindable: declare in `features/keybindings/commands.ts`, route in `KeyboardShortcuts.tsx::dispatchCommand` (via `getAppCommands()` from `src/app/appCommands.ts`, or stores). The global handler ignores plain/Alt bindings while a text field is focused (Mod combos still fire; xterm's helper textarea is exempt). Editor-scoped shortcuts stay in CodeMirror's keymap.
- **Drag & drop:** pointer events + manual gesture tracking, never HTML5 drag (WKWebView cancels `dragstart` through composed Radix Slots). For vertical list reorder, reuse `components/ui/useListReorder.tsx` instead of hand-rolling the gesture.
- **Path aliases:** `@/*` maps to `src/*`. **IDs:** `nanoid` via `lib/idGen.ts` on the frontend; UUIDv4 in Rust. **Strict TS:** `noUnusedLocals`/`noUnusedParameters` on.
- **Tauri capabilities** live in `src-tauri/capabilities/default.json`; new plugin permissions must be added there or the IPC silently rejects.
- **`pnpm-lock.yaml` is committed**; don't introduce `npm install`/`yarn add`.

## Where to look first

| You want to… | Start here |
|---|---|
| Add a new Tauri command | `src-tauri/src/commands/<area>.rs` + register in `lib.rs::invoke_handler!` + mirror in `src/lib/ipc.ts::CMD` |
| Change app shell layout | `src/app/AppShell.tsx` (grid template lives there); use `src/app/hooks/*` for bootstrap, filesystem sync, persistence and tab actions |
| Projects sidebar (rail / expanded, reorder, status dots) | `components/project-rail/*`, `components/code-sidebar/*`, `components/ui/useListReorder.tsx`, `features/terminal/projectStatus.ts`, `features/ui/codeSidebar.store.ts` |
| Title bar (project identity, branch, updates, side panel toggle) | `src/app/TitleBar.tsx` |
| Add a new tab kind | `src/components/tabs/types.ts` (union) → `TabContent.tsx` (renderer) → factories/open helpers in `features/tabs/` → Arquivos section in `CodeProjectGroup.tsx` (vertical layout) |
| Tab open/close policy (factories, confirm, Process kill) | `src/features/tabs/` (`tabLifecycle`, `factories`, `closePolicy`, `pendingClose.store`); React adapter `useTabActions` only |
| PTY Session lifecycle (spawn/stop/fit-on-visible) | `src/features/terminal/sessionController.ts` + `fitOnVisible.ts`; TerminalTab is chrome only |
| Path authorization (Project roots + Finder reveal) | `src-tauri/src/util/paths.rs` + `ProjectsCache::require_within_*`; grants in `preview_grants.rs` / `directory_grants.rs` |
| Add a new CLI to the launcher | `src/features/terminal/cli-registry.ts::DEFAULT_CLI_REGISTRY` |
| Add/change a user setting | `src/features/settings/settings.types.ts` (`AppSettings` + `DEFAULT_SETTINGS` + `mergeSettings`) → consumer → pane in `components/settings/panes/` + i18n keys (both locales) |
| Add/rebind a keyboard shortcut | `src/features/keybindings/commands.ts` → dispatch in `KeyboardShortcuts.tsx` |
| Add an app-wide UI command | `src/app/appCommands.ts` + implementation in `src/app/hooks/useTabActions.ts` or the relevant store-backed dispatcher |
| Source Control panel / worktrees | `src/components/source-control/*` + `features/git/*`; Rust in `commands/git.rs` |
| Clone from GitHub | `components/project-rail/CloneFromGithubDialog.tsx` + `commands/git.rs::git_clone` (+ `git://clone-progress`) |
| Resume registry (recent CLI sessions) | `features/resume/*` + `components/resume/ResumeCards.tsx` + Histórico rows in `CodeProjectGroup.tsx`; Rust `commands/resume.rs` |
| Agent status (idle/working/needs-attention/done) | OSC parsing in `components/terminal/oscHandlers.ts` + `agentHeuristic.ts` → `features/terminal/agent-status.store.ts`; shared tone in `components/tabs/statusTone.ts` |
| Tab tooltip / per-tab branch+ports | `features/terminal/tabMetadata.store.ts` + `useTabMetadataPolling` → `components/tabs/TabTooltip.tsx` |
| OS notifications / sound | `commands/notifications.rs` ← `features/terminal/notificationDispatch.ts` |
| Diagnostics log panel (Cmd+Shift+D) | `features/diagnostics/*` + `components/diagnostics/*`; Rust `commands/diagnostics.rs` |
| Preview mode / macOS "Open With" | `src-tauri/src/open_files.rs` + `preview_grants.rs`; frontend preview tabs |
| Updates (pill, About pane, silent check) | `features/updates/*` + `components/updates/UpdatePill.tsx` |
| UI density | `settings.types.ts::UI_DENSITY_MULTIPLIER` → `--density-multiplier` → `--space-*` tokens |
| Empty / loading / missing state | `components/ui/EmptyState.tsx` |
| Where config + state persist | `~/.metacodex/` via `src-tauri/src/config_paths.rs` (honors `METACODEX_HOME`) |
| Tweak design tokens / add a theme | `src/styles/tokens.css` + `src/features/theme/themes/*` (+ `tailwind.config.js` for new token classes) |
| Tauri app config / capability grants | `src-tauri/tauri.conf.json` / `src-tauri/capabilities/default.json` |
| Shell redesign rationale (v0.0.12) | `REDESIGN_PLAN.md` (root) + `MENU_UX_PLAN.md` |
