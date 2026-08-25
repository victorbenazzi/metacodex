# Baseline: Agent Runtime Reliability Hardening

Captured on 2026-08-20 in `/Users/victor/Documents/metacodex` before production changes for this hardening project.

## Repository state

- Branch: `wip/v3-shell`
- HEAD: `78219d54ea9b42679acc95279fa63f7ae4617f07`
- Upstream: `origin/wip/v3-shell`
- Divergence: 0 commits ahead, 0 commits behind
- Tracked diff summary: 90 files, 1,433 insertions, 3,799 deletions
- Existing worktree changes are user-owned and must be preserved.

### Tracked dirty paths

```text
M AGENTS.md
M CLAUDE.md
M REDESIGN_PLAN.md
M package.json
M pnpm-lock.yaml
M pnpm-workspace.yaml
D public/opencode-logo-dark.svg
D public/opencode-logo-light.svg
M src-tauri/Cargo.lock
M src-tauri/Cargo.toml
M src-tauri/capabilities/default.json
M src-tauri/src/commands/mod.rs
M src-tauri/src/config_paths.rs
M src-tauri/src/events.rs
M src-tauri/src/lib.rs
M src-tauri/src/projects.rs
M src/app/AppShell.tsx
M src/app/KeyboardShortcuts.tsx
D src/app/TitleBar.tsx
M src/app/hooks/useTabActions.ts
M src/app/hooks/useWorkspacePersistence.ts
D src/components/code-sidebar/CodeProjectGroup.tsx
D src/components/code-sidebar/ExpandedProjectsSidebar.tsx
D src/components/file-explorer/ExplorerTogglePill.tsx
D src/components/icons/brand/AntigravityIcon.tsx
D src/components/icons/brand/ClaudeCodeIcon.tsx
D src/components/icons/brand/CodexIcon.tsx
D src/components/icons/brand/GrokIcon.tsx
D src/components/icons/brand/KimiIcon.tsx
D src/components/icons/brand/OpenCodeIcon.tsx
D src/components/icons/brand/PiIcon.tsx
D src/components/icons/brand/XiaomiMiMoIcon.tsx
D src/components/icons/brand/index.ts
D src/components/project-rail/MiniProjectSidebar.tsx
D src/components/project-rail/ProjectTile.tsx
M src/components/resume/ResumeCards.tsx
M src/components/search/SearchDialog.tsx
M src/components/settings/panes/EditorPane.tsx
M src/components/settings/panes/InterfacePane.tsx
M src/components/settings/panes/TerminalPane.tsx
D src/components/side-panel/SidePanel.tsx
D src/components/source-control/ChangesTab.tsx
D src/components/source-control/SourceControlPanel.tsx
D src/components/tabs/NewTabMenu.tsx
D src/components/tabs/TabBar.tsx
M src/components/tabs/TabContent.tsx
D src/components/tabs/TabContextMenu.tsx
D src/components/tabs/TabOverflowMenu.tsx
D src/components/tabs/TabTooltip.tsx
D src/components/tabs/TabWorktreePill.tsx
M src/components/tabs/tabChrome.tsx
M src/components/tabs/tabsStore.ts
M src/components/tabs/types.ts
M src/components/terminal/CliTabComponent.tsx
M src/components/terminal/useXterm.ts
D src/components/ui/SidebarRow.tsx
M src/components/ui/icons.tsx
M src/components/v3-shell/AgentSidebar.tsx
D src/components/v3-shell/LoopsList.tsx
M src/components/v3-shell/RepoRow.tsx
M src/components/v3-shell/RightWorkbench.tsx
M src/components/v3-shell/ShellToggles.tsx
M src/components/v3-shell/WorkbenchNewMenu.tsx
M src/features/editor/editorSavers.ts
M src/features/git/git.actions.ts
M src/features/i18n/locales/en.json
M src/features/i18n/locales/pt-BR.json
M src/features/keybindings/commands.ts
M src/features/keybindings/types.ts
D src/features/loops/loops.store.ts
M src/features/resume/resumeLaunch.ts
M src/features/settings/settings.types.ts
M src/features/side-panel/sidePanel.store.ts
M src/features/tabs/factories.ts
M src/features/tabs/index.ts
M src/features/tabs/tabLifecycle.ts
M src/features/terminal/agent-status.store.ts
M src/features/terminal/agentHeuristic.ts
M src/features/terminal/sessionController.ts
M src/features/terminal/useTabMetadataPolling.ts
M src/features/theme/themes/index.ts
M src/features/ui/codeSidebar.store.ts
M src/features/v3-shell/v3Shell.store.ts
M src/index.css
M src/lib/events.ts
M src/lib/ipc.ts
M src/styles/fonts.css
M src/styles/tab-strip.css
M src/styles/tokens.css
M vite.config.ts
```

### Untracked paths before hardening

The local pnpm store contains 22,575 untracked cache entries under `.pnpm-store/`. It is user-owned and excluded from individual enumeration below.

```text
.npmrc
docs/research-in-app-browser.md
specs/agent-runtime-reliability/design.md
specs/agent-runtime-reliability/requirements.md
specs/agent-runtime-reliability/tasks.md
src-tauri/src/commands/browser.rs
src-tauri/src/commands/browser_capture.rs
src-tauri/src/commands/browser_init.js
src/components/browser/BrowserDrawDock.tsx
src/components/browser/BrowserPanel.tsx
src/components/browser/BrowserStartPage.tsx
src/components/icons/brand/index.tsx
src/features/browser/browser.service.ts
src/features/browser/browser.store.ts
src/features/browser/devServers.test.ts
src/features/browser/devServers.ts
src/features/browser/identity.test.ts
src/features/browser/identity.ts
src/features/browser/sendToAgent.ts
src/features/browser/url.test.ts
src/features/browser/url.ts
src/features/git/lineDiff.test.ts
src/features/tabs/closePolicy.test.ts
src/features/tabs/factories.test.ts
src/features/terminal/agentHeuristic.test.ts
src/features/terminal/attentionProfile.ts
src/features/ui/overlayLock.store.ts
src/test/setup.ts
```

## Toolchain

- Node: `v26.7.0`
- pnpm: `11.17.0`
- rustc: `1.97.1 (8bab26f4f 2026-07-14)`
- Cargo: `1.97.1 (c980f4866 2026-06-30)`
- Host and active target: `aarch64-apple-darwin`
- LLVM: `22.1.6`

## Quality gates before hardening

| Gate | Result | Evidence |
|---|---|---|
| `pnpm test` | PASS | 7 files and 39 tests passed. |
| `pnpm build` | PASS | TypeScript and Vite production build passed. Vite reported a 1,953.39 kB main chunk and a 593.84 kB gzip size warning. |
| `cargo test` | PASS | 18 Rust tests passed. |
| `cargo check --all-targets` | PASS | Dev profile completed successfully. |
| `cargo fmt --all -- --check` | FAIL, existing | Formatting differences span existing tracked and untracked Rust work. Examples include `commands/browser.rs`, `commands/browser_capture.rs`, `commands/git.rs`, `commands/resume.rs`, `commands/terminal.rs`, `pty/mod.rs`, and other pre-existing dirty files. |
| `cargo clippy --all-targets -- -D warnings` | FAIL, existing | `clippy::single_match` at `src-tauri/src/commands/browser.rs:507`. |
| `git diff --check` | PASS | No whitespace errors. |
| `pnpm audit --prod` | FAIL, existing | One high advisory for direct `nanoid`, vulnerable below 5.1.16. Current manifest requests `^5.0.8`. |

## Baseline conclusion

The branch, HEAD, dirty state, passing tests, failing Rust format gate, failing Clippy rule, and `nanoid` advisory match the audited state. Planned files overlap the existing user work by design, so every task must inspect the current diff and preserve the current v3 shell and browser implementation while applying the reliability changes.

## Task 0 acceptance

- [x] Existing failures are distinguished from failures introduced later.
- [x] No source or configuration file changed during Task 0.
- [x] All pre-existing dirty paths are recorded above, with the local pnpm cache summarized separately.

## Final comparison

Qualification on 2026-08-20 changed the gate results as follows:

| Gate | Baseline | Qualified result |
|---|---|---|
| Frontend tests | 7 files, 39 tests passed | 45 files, 116 tests passed |
| Production build | Passed | Passed |
| Rust tests | 18 passed | 53 passed |
| Rust check | Passed | Passed |
| Rust format | Failed | Passed |
| Rust Clippy | Failed | Passed with warnings denied |
| Production audit | Failed on direct `nanoid` advisory | Passed with no known vulnerability |
| Traceability | Not present | 62 requirements, verdicts, and mapped tests matched |
| IPC and event parity | Not present | 82 commands and 12 events matched |

The original user-owned v3 shell and browser work remains in the worktree. The hardening changes were applied around that baseline without resetting, deleting, or publishing it.
