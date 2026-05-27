<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./public/white-metacodex-icon.png">
  <img src="./public/black-metacodex-icon.png" alt="metacodex" width="96">
</picture>

# metacodex

**A premium local-first developer workspace for terminal-native AI coding.**

VS Code-style file navigation. Cursor-grade visual calm. Claude Code, Codex CLI, OpenCode and friends — running as real PTY tabs in a native desktop shell.

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-Edition%202021-CE412B?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![macOS first](https://img.shields.io/badge/Platform-macOS%20first-000000?logo=apple&logoColor=white)](#requirements)

[Português 🇧🇷](./README.pt-BR.md)

</div>

---

## What is metacodex?

metacodex is a desktop app that puts the **file tree, the editor, the terminal, and your AI coding agent in the same window**, without throwing away the things developers actually rely on (real PTYs, real `$SHELL -l`, real git, your `.zshrc`).

It's built as a **Tauri 2** shell — a small Rust core that owns every system call (PTY, filesystem, search, watcher, git) — and a **React 19 + TypeScript** frontend that is purely UI and state. Everything lives **local-first**: no auth, no cloud round-trip, no telemetry. Settings, projects and per-workspace state persist as hand-editable JSON in `~/.metacodex/`.

It feels closer to Linear / Raycast than to a typical Electron IDE: token-driven theming, a single opacity fade for every popup, native-style focus rings, and a tab bar that doesn't leak browser chrome.

## Download & install

**For Apple Silicon Macs (M1 / M2 / M3 / M4).** Three steps, ~30 seconds:

1. **Download** [`metacodex_<latest>_aarch64.dmg`](https://github.com/victorbenazzi/metacodex/releases/latest) from the Releases page.
2. **Open the `.dmg`** and drag `metacodex.app` into `/Applications`.
3. **Open Terminal and paste this one line:**
   ```bash
   sudo xattr -cr /Applications/metacodex.app && open /Applications/metacodex.app
   ```
   *One-time per install. macOS quarantines unsigned apps; this clears the flag and opens metacodex.*

That's it — no account, no setup wizard. Future versions arrive automatically (see [Auto-update](#auto-update) below).

> Intel Mac, Windows and Linux builds are temporarily disabled while we verify each platform end-to-end. Apple Silicon ships first because it's what the maintainer runs daily; the others come back one by one. Open an issue if you want a specific platform prioritised.
>
> Stuck on *"app is damaged"* or *"developer cannot be verified"*? See the full [signature workaround](#macos-signature-error-app-is-damaged--cannot-be-opened).

## Auto-update

From **v0.0.3** onwards, metacodex updates itself. Shortly after launch the app checks this repo's `latest.json`; when a newer release exists, a blue **Update** pill appears in the top bar. One click → the new payload is downloaded, signature-verified against the bundled public key, swapped in place, and the app relaunches. No reinstall.

> ⚠️ If macOS re-quarantines the app after an in-place update (rare, but happens to unsigned bundles), run `sudo xattr -cr /Applications/metacodex.app` once and reopen. Yes, we know — Apple charges $99/year to make this message go away. The day metacodex pays its own credit card, we'll sign it. Until then: terminal.

## Why

| Pain | metacodex's take |
|---|---|
| AI coding CLIs feel great in isolation but lousy as a workspace | First-class **PTY tabs** for Claude Code, Codex CLI, OpenCode, Antigravity, Hermes, OpenClaw — launched through `$SHELL -l -i -c` so your `mise` / `nvm` / `.zshrc` PATH is intact. |
| Electron IDEs are heavy, slow to launch, fragile on resize | Tauri 2 native shell, ~tens of MB binary, instant cold start. |
| "Open with terminal" is a context-switch | Terminal and editor live in the **same tab bar**, keyed per project. |
| Cloud-bound settings get out of sync | Plain JSON in `~/.metacodex/`. Edit it in vim if you want. |
| File watchers, search, git all reinvented per app | One debounced `notify` watcher per project, ripgrep-grade search via `grep-searcher`, `libgit2` via `git2`. |

## Features

### Workspace
- **Project rail** with reorderable projects, recent-file tint, and per-project tab buckets — switching project swaps the entire visible tab set; tabs from other projects stay alive in memory.
- **Resizable panels** (Explorer / main / Source Control).
- **Welcome / empty states** that surface recent agent sessions (`resume.json`).
- **Command palette** (`Cmd+Shift+P`) for commands and files.

### File Explorer (fully mutable)
- Create, rename, delete, drag-move — VS Code parity.
- Every mutation is roots-checked in Rust; moves **refuse on conflict** instead of overwriting.
- Open editor tabs follow renames; closed paths drop dead tabs.
- Atomic writes (`<path>.metacodex.tmp` → `rename`).

### Editor (CodeMirror 6)
- Language packs for TS/JS, Rust, Go, Python, Java, C/C++, PHP, HTML/CSS/Less/Sass, JSON, YAML, SQL, Markdown, Vue, Angular, and more.
- Sticky scroll headers, merge view, search/replace, autocomplete.
- Markdown / image / PDF previews as native tab kinds.

### Terminal & AI CLIs
- xterm.js v5.5 with the Canvas renderer (carefully deferred load order — see `useXterm.ts`), DOM fallback on failure.
- Bundled **JetBrains Mono Nerd Font** for TUI glyphs (Claude Code box-drawing, Codex spinners) — `lineHeight` is pinned to 1.0 by design.
- One-click launcher for any CLI in the registry (`cli-registry.ts`): Claude Code, Codex CLI, OpenCode, Antigravity, Hermes, OpenClaw, Pi.
- **Agent status** per tab (`idle | working | needs-attention | done`) driven by OSC parsing + heuristics; jump to the next attention with `Cmd+Shift+U`.
- **Tab tooltip** with per-tab branch, cwd, and listening ports (polled from Rust).
- OS notifications + sound when an agent finishes or needs you.

### Source Control
- Right-panel SCM view backed by `libgit2`.
- **Worktrees** — list, create, switch, merge from the same panel.

### Settings & Keybindings
- Plain JSON in `~/.metacodex/settings.json` and `~/.metacodex/keybindings.json` (the latter only stores overrides).
- Editor & terminal font, scrollback, sticky headers, debounces, UI density (compact / comfortable / spacious — drives every `--space-*` token via a CSS `calc()`).
- Every shortcut rebindable (`Cmd+,` → Keybindings, or edit the JSON).
- Theme: light / dark / system. Follows `prefers-color-scheme` by default.

### Internationalisation
- English (default) and Brazilian Portuguese out of the box (`react-i18next`).
- All UI strings go through `t()` — never hardcoded.

## Requirements

metacodex is **macOS-first**. Linux is largely supported by the same Rust/Tauri stack but is not yet QA'd by the maintainers. Windows is not supported.

To run from source you need:

| Tool | Why |
|---|---|
| **macOS 12+ (Monterey or newer)** | Tauri 2 baseline |
| **Xcode Command Line Tools** | `xcode-select --install` |
| **Rust** (stable) | Tauri Rust core — install via [`rustup`](https://rustup.rs) |
| **Node.js 20+** | Vite / TS |
| **pnpm** | Package manager — `npm i -g pnpm` (or `corepack enable`) |

## Install (from source)

```bash
# 1. Clone
git clone https://github.com/victorbenazzi/metacodex.git
cd metacodex

# 2. Install JS deps
pnpm install

# 3. Run the desktop app (Vite + Tauri, hot reload)
pnpm tauri dev
```

The Vite dev server binds to **port 1420** (`strictPort: true`); Tauri's `beforeDevCommand` boots it. Don't change the port without updating `src-tauri/tauri.conf.json`.

## Build a release bundle

```bash
# Produces a .app / .dmg under src-tauri/target/release/bundle/
pnpm tauri build
```

The release profile is tuned for size (`opt-level = "s"`, `lto`, `panic = "abort"`, `strip`). Expect a fairly small native binary.

## Available commands

| Task | Command |
|---|---|
| Run the desktop app | `pnpm tauri dev` |
| Run only the Vite frontend (no native shell) | `pnpm dev` |
| Type-check + production frontend build | `pnpm build` |
| Type-check only | `pnpm exec tsc --noEmit` |
| Production Tauri bundle | `pnpm tauri build` |
| Preview the built frontend in a browser | `pnpm preview` |

There is no test suite and no separate lint step — `tsc --noEmit` (run as part of `pnpm build`) is the static check.

## macOS signature error ("app is damaged" / "cannot be opened")

If you download an **unsigned build** of metacodex (for example a `.dmg` from a release that wasn't notarised by Apple), macOS Gatekeeper will quarantine it and refuse to launch with one of:

> *"metacodex.app" is damaged and can't be opened. You should move it to the Trash.*
>
> *"metacodex" cannot be opened because the developer cannot be verified.*

This is **not** corruption — macOS just stripped the quarantined app. Drag metacodex into `/Applications` first, then run **one** of these in Terminal:

```bash
# Recommended — clear ALL extended attributes (incl. com.apple.quarantine)
sudo xattr -cr /Applications/metacodex.app
```

If that alone isn't enough (rare, but happens on certain macOS releases when the binary has no signature at all), also ad-hoc resign it:

```bash
sudo codesign --force --deep --sign - /Applications/metacodex.app
```

Then re-open metacodex normally. The same trick applies to any unsigned Tauri/Electron app and is safe — you're stripping a quarantine flag, not disabling Gatekeeper system-wide.

> 🛈 If you built the app yourself with `pnpm tauri build`, the resulting `.app` already runs from `src-tauri/target/release/bundle/macos/` without these errors. The signature workaround is only needed for builds downloaded from elsewhere.

## Where things live on disk

```
~/.metacodex/
├── settings.json          # editable user prefs (theme, language, fonts, terminal, debounces, density)
├── keybindings.json       # only shortcuts that differ from defaults
└── state/
    ├── projects.json       # registered project roots + lastActiveProjectId
    ├── resume.json         # recent agent sessions (pruned to last 30 days at boot)
    └── workspace/<id>.json # per-project: open tabs, active tab, expanded paths
```

Everything is plain, pretty-printed, hand-editable JSON. Writes are atomic (tmp → rename). **Terminals and CLI tabs are intentionally not persisted** — shells aren't auto-respawned on app start.

## Architecture, in one screen

```
+-----------------------------------+         +-----------------------------------+
|     React 19 + TypeScript (UI)    |  IPC    |       Rust + Tauri 2 (shell)      |
|-----------------------------------|<------->|-----------------------------------|
| Zustand stores per feature        | invoke  | commands/  fs / git / pty / ...   |
| CodeMirror 6 editor               |  +      | PtyManager (portable-pty)         |
| xterm.js v5.5 + Canvas addon      | emit    | WatcherManager (notify)           |
| Radix dialogs / menus / tooltips  |         | ProjectsCache (Arc<RwLock<…>>)    |
| Tailwind + token-driven theming   |         | ensure_within_roots on every FS   |
| react-i18next (en / pt-BR)        |         | git2 / grep-searcher / ignore     |
+-----------------------------------+         +-----------------------------------+
                                                            |
                                                            v
                                                   ~/.metacodex/  (JSON)
```

The boundary is strict: **Rust owns all OS/IO; React owns rendering and ephemeral UI state.** Nothing in `src/` reads from disk or spawns processes directly — every side effect goes through a Tauri command listed in `src/lib/ipc.ts::CMD` and registered in `src-tauri/src/lib.rs::invoke_handler!`.

Path safety is enforced in one place: every filesystem command calls `paths::ensure_within_roots(target, &roots)` before any `fs::*` call. `is_within` does lexical normalisation only — no symlink resolution — so a symlink can't escape the sandbox via realpath.

For the deep tour see [`CLAUDE.md`](./CLAUDE.md) and [`AGENTS.md`](./AGENTS.md).

## Contributing

1. Fork & branch from `main`.
2. `pnpm install`, then `pnpm tauri dev`.
3. Keep the Rust/TS boundary clean — no `fs::*` or process spawn outside a roots-checked Tauri command.
4. Tokens drive the visuals; **never hardcode colours** in components — go through `src/styles/tokens.css`.
5. All UI text must go through `t()` and be added to **both** locale files (`en` and `pt-BR`).
6. `pnpm build` (which runs `tsc --noEmit`) must pass before opening a PR.

The longer playbook — including the xterm.js load-order rule, the `lineHeight = 1.0` rule, the popup-motion rule, and the project's persistence layout — lives in [`CLAUDE.md`](./CLAUDE.md).

## License

[MIT](./LICENSE) © Victor.

---

<sub>Built with Tauri 2, React 19, CodeMirror 6, xterm.js, libgit2 and a lot of opinionated design tokens.</sub>
