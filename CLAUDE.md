# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

metacodex is a premium **local-first developer workspace** built as a Tauri 2 desktop app — VS Code-style file navigation + a terminal-native AI coding workflow (Claude Code, Codex CLI, OpenCode, etc. launched as PTY tabs). macOS-first; the Tauri/Rust shell handles PTYs, filesystem, search, watcher, and git, while the React frontend is purely UI/state.

## Commands

Package manager is **pnpm**. There is no test suite, no separate lint command — `tsc --noEmit` (run via `pnpm build`) is the only static check.

| Task | Command |
|---|---|
| Run the desktop app (Vite + Tauri) | `pnpm tauri dev` |
| Run only the Vite frontend (no native shell) | `pnpm dev` |
| Type-check + production frontend build | `pnpm build` |
| Type-check only | `pnpm exec tsc --noEmit` |
| Production Tauri bundle | `pnpm tauri build` |
| Preview built frontend in browser | `pnpm preview` |

The Vite dev server binds to **port 1420** (`strictPort: true`) — Tauri's `beforeDevCommand` boots it; don't change the port without updating `src-tauri/tauri.conf.json`. `src-tauri/**` is excluded from Vite's watcher so Rust changes don't trigger frontend HMR (Tauri reloads the native shell on its own).

## Architecture

### Two-process split

The boundary is strict: **Rust owns all OS/IO; React owns rendering and ephemeral UI state.** Nothing in `src/` reads from disk or spawns processes directly — every side effect goes through a Tauri command.

- **Rust commands** are declared in `src-tauri/src/lib.rs::invoke_handler!` and implemented under `src-tauri/src/commands/*`. They return `AppResult<T>`; `AppError` serializes as `{ code, message }` (see `src-tauri/src/error.rs`).
- **TS mirror** lives in `src/lib/ipc.ts` — the `CMD` const enum lists every command name. **Adding a new command requires editing both `lib.rs` and `ipc.ts`** (the comment in `ipc.ts` says so explicitly; treat it as a rule).
- **Events** flow Rust → TS via `tauri::Emitter`. Names are centralized in `src-tauri/src/events.rs` (`EV_*` consts) and `src/lib/events.ts` (`EV` const). Today: `pty://data`, `pty://exit`, `fs://changed`, `project://changed`, `fs://error`.

### Path safety (security-critical)

`src-tauri/src/projects.rs` keeps a `ProjectsCache` (`Arc<RwLock<Vec<Project>>>`) of registered project roots. **Every filesystem command** (`fs_ops.rs`, `search.rs`, `git.rs`) calls `paths::ensure_within_roots(target, &roots)` before touching disk. `is_within` does *lexical* normalization (no symlink resolution — intentional, so a symlink can't escape the sandbox via realpath). If you add a new FS-touching command, it MUST do this check before any `fs::*` call.

### State (frontend)

State is split into **Zustand stores per feature** (`src/features/<feature>/<feature>.store.ts`):

- `projects.store` — list + active id (hydrated from Rust on mount).
- `tabs` store (`src/components/tabs/tabsStore.ts`) — `byProject: Record<projectKey, { tabs, activeTabId }>`. Use `WORKSPACE_NULL` as the bucket key when no project is active (Day-1 users can open terminal tabs before adding any project).
- `explorer`, `git`, `editor`, `search`, `theme`, `settings` — each own their slice; never reach across stores inside a component, derive in `AppShell` or selectors.
- Tabs are **keyed by project**: switching the active project swaps the entire visible tab bucket — terminals/CLIs from project A stay alive in memory but aren't shown while project B is active.

### Workspace persistence

`AppShell.tsx` saves a `WorkspaceState` (open tabs + active tab + expanded explorer paths) to the Tauri store, debounced 350ms, per project. **Terminals and CLI tabs are intentionally NOT persisted** — see the comment in `src-tauri/src/commands/workspace.rs`: shells aren't auto-respawned on app start. Only `editor | markdown | image | pdf` round-trip through `SerializedTab`.

`hydratedWorkspaces: Set<string>` in `AppShell` tracks which project buckets have already loaded — without this guard, the save effect would clobber the persisted state with an empty bucket on the first render after a project switch.

### PTY model

`PtyManager` in `src-tauri/src/pty/mod.rs` is the singleton state owned by Tauri (`app.manage(...)` in `lib.rs`). Each session:

1. Allocates a master/slave pair via `portable_pty::native_pty_system`.
2. Spawns the child via a **dedicated `std::thread`** doing blocking `reader.read(...)` into an `mpsc::unbounded_channel` (don't try to make this async — `portable-pty`'s reader is blocking).
3. A `tokio::spawn` drainer emits `pty://data` (base64-encoded bytes) per chunk.
4. A second `tokio::spawn` polls `child.try_wait()` every 250ms and emits `pty://exit`. A `Notify` cancel token lets `pty_kill` short-circuit the loop.

Shells are launched via `pty/shell.rs::detect_login_shell` (`$SHELL -l` on Unix). **CLIs launch through `$SHELL -l -i -c "<cli args>"`** so `.zshrc`/`.zprofile`/`mise`/`nvm` re-source PATH before the CLI execs — the Tauri GUI process inherits a sparse PATH on macOS, so without this, `claude` / `codex` / etc. won't be on PATH.

### xterm.js quirk (do not break this)

`src/components/terminal/useXterm.ts` has a load order that took debugging:

1. Construct `Terminal` with **explicit `cols`/`rows`** (e.g. 100×28) — passing nothing crashes `term.open()`.
2. `loadAddon(FitAddon)` → `loadAddon(WebLinksAddon)` → `term.open(container)`.
3. **Defer `CanvasAddon` and the first `fit.fit()` to `requestAnimationFrame`** — xterm.js v5.5 crashes if the canvas renderer attaches before its internal init completes. Falling back to the DOM renderer is acceptable (we `console.warn` on canvas failure).

If you touch this, test with Cmd+T (new terminal) → resize the window → switch theme. All three must keep working.

### File watcher

One `notify_debouncer_mini::Debouncer` per project root, lifecycle owned by `WatcherManager` (a `parking_lot::Mutex<HashMap<projectId, Debouncer>>`). `AppShell` calls `watcherApi.watch(project.id, project.path)` when a project becomes active and `unwatch` on cleanup. `fs://changed` events carry `{ projectId, paths }`; the listener in `AppShell` invalidates explorer caches for affected directories and refreshes git status.

### Theming

- **Tokens drive everything.** Never hardcode colors in components. Tailwind `colors: { canvas, ink, hairline, ... }` map to CSS variables in `src/styles/tokens.css`. Light/dark switches via `data-theme` on `<html>`.
- The xterm theme is built from the same CSS vars (`--term-*`) and re-applied on theme change.
- Dark/light follows `prefers-color-scheme` by default; user can override via Settings (`Cmd+,`). Stored in `localStorage` (key `metacodex:theme`).

## Conventions to follow

- **MVP safety rule: NO file or folder deletion / rename.** The spec explicitly excludes these mutation paths from MVP — don't add `rm`/`mv` commands or UI even if the file browser tempts you to. (Rename for *projects* is fine — that just edits the registry, not the disk.)
- **Atomic writes** for files: write to `<path>.<ext>.metacodex.tmp`, then `rename`. See `fs_ops::write_file_text`.
- **Path aliases**: `@/*` → `src/*` (Vite + tsconfig). Imports inside `src/` should use `@/...` not relative `../../`.
- **IDs**: `nanoid` on the frontend (via `src/lib/idGen.ts` `newId(n)`); UUIDv4 on the Rust side for PTY session ids.
- **Strict TS**: `noUnusedLocals` + `noUnusedParameters` are on. Prefix intentionally-unused parameters with `_`.
- **Runtime keyboard handlers** are attached in `AppShell` via `window.__metacodex = { ... }` and consumed by `KeyboardShortcuts.tsx`. To add a new shortcut, attach a handler on `__metacodex` from `AppShell` and read it in `KeyboardShortcuts`.
- **Tauri capabilities** live in `src-tauri/capabilities/default.json`. New plugin permissions must be added there or the IPC silently rejects.
- **`pnpm-lock.yaml` is committed** — keep it in sync; don't introduce `npm install`/`yarn add`.

## Where to look first

| You want to… | Start here |
|---|---|
| Add a new Tauri command | `src-tauri/src/commands/<area>.rs` + register in `lib.rs` + mirror in `src/lib/ipc.ts::CMD` |
| Change app shell layout | `src/app/AppShell.tsx` (grid template lives there) |
| Add a new tab kind | `src/components/tabs/types.ts` (discriminated union) → `TabContent.tsx` (renderer) → `AppShell.handleOpenFile` (routing) |
| Add a new CLI to the launcher | `src/features/terminal/cli-registry.ts::DEFAULT_CLI_REGISTRY` |
| Tweak design tokens | `src/styles/tokens.css` (light + dark blocks) → `tailwind.config.js` if exposing a new token to Tailwind classes |
| Tauri app config (window, identifier, bundle) | `src-tauri/tauri.conf.json` |
