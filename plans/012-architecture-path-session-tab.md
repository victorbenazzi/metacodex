# 012 — Deepen Path authorization, Session controller, Tab lifecycle

**Status:** planned  
**Branch context:** architecture review 2026-07-15 (Strong candidates)  
**Domain language:** `CONTEXT.md`  
**Not in scope:** typed IPC, command bus, Project runtime FS merge, git domain split, Projects cache SoT, Workspace state serialize into Tab lifecycle

## Vocabulary (from CONTEXT.md)

| Term | Meaning in this plan |
|------|----------------------|
| Project | Registered root + tab bucket |
| Project root | Path bound for FS access |
| Tab | Open work unit in a bucket |
| Process tab | `terminal` or `cli` Tab |
| Preview tab | File Tab outside roots via Preview grant |
| PTY Session | Live portable-pty child |
| Session controller | start / stop / onVisible for a Process tab |
| Path authorization | Target must sit in a Project root (empty registry denies) |
| Preview grant | Capability for out-of-root file |
| Tab lifecycle | Open factories + open helpers + close policy |
| Close request | Confirm decision + target tab ids (not kill) |

## Goals

1. **Path authorization:** one deep module for roots checks; `reveal_in_finder` gated (roots or Preview grant).
2. **Session controller:** one deep module for Process tab PTY lifecycle; kill keyed by tab id.
3. **Tab lifecycle:** one deep module for open/close policy; every UI surface uses it for Process tabs; kill via Session controller then store close.

## Non-goals

- Moving `tabsStore` file location (optional later re-export only).
- Extracting workspace hydrate/save into Tab lifecycle.
- Unifying Preview grants and Directory grants into one type.
- Dropping `AppHandle` from all of `fs_ops` in phase 1 (optional cleanup if cheap).
- Frontend unit test harness setup beyond pure functions testable with existing or minimal tooling (note: repo has no Vitest today; phase 2/3 prefer pure modules so tests can land when harness exists).

## Dependency graph

```
Phase 1 Path authorization     (Rust only, no FE deps)
        │
        ▼
Phase 2 Session controller     (FE terminal; no Tab lifecycle yet)
        │
        ▼
Phase 3 Tab lifecycle          (uses Session controller.stop)
```

Ship as three sequential PRs (or three commits on one branch). Do not merge phase 3 before phase 2.

---

# Phase 1 — Path authorization

## Outcome

Every FS-touching command that meant “inside Project roots” calls one entry point. Finder reveal allows Project roots **or** active Preview grant path.

## Interface (Rust)

Add to `src-tauri/src/util/paths.rs` (or `util/path_auth.rs` re-exported from `paths`):

```rust
/// Empty registry → PathNotAllowed. Then ensure_within_roots.
pub fn require_within_project_roots(
    cache: &ProjectsCache,
    path: &str,
) -> Result<(), AppError>;

/// Resolve project by id; check path is under that Project's root only.
pub fn require_within_project(
    cache: &ProjectsCache,
    project_id: &str,
    path: &str,
) -> Result<(), AppError>;
```

Keep existing `ensure_within_roots(path, roots: &[String])` as the primitive used internally and for tests.

Optional thin helper on `AppHandle` is **not** required: callers already have `app.state::<Arc<ProjectsCache>>()`.

## Call site migration

| Location | Today | After |
|----------|--------|--------|
| `fs_ops::require_within_roots` | local helper | call `require_within_project_roots` or delete helper and call paths directly |
| `commands/search.rs` `ensure_root_allowed` | private | delete; call `require_within_project_roots` |
| `commands/git.rs` `ensure_root_allowed` + inline in `git_status` / `git_file_head_content` | duplicated | single call |
| `commands/terminal.rs` `pty_spawn` | roots for one project path | prefer `require_within_project` when `project_id` set |
| `commands/terminal.rs` `pty_update_cwd` | inline | `require_within_project_roots` |
| `commands/projects.rs` `reveal_in_finder` | **no check** | see Finder below |
| `commands/watcher.rs` | project id / path equality | leave unless easy to share empty-registry message |

## Finder reveal

`reveal_in_finder(path)` becomes something like:

```text
1. If require_within_project_roots(cache, path) ok → open
2. Else if PreviewGrants contains any grant whose path == path → open
   (or resolve by scanning grant map for path match)
3. Else PathNotAllowed
```

**Note:** Preview grants are keyed by grant id, not path. Options:

- **A (preferred):** add `PreviewGrants::contains_path(path: &str) -> bool` (scan values; O(n), n ≤ 512).
- **B:** change command signature to require `grantId` from UI for preview reveals only (breaking frontend).

Use **A** so existing `revealTabInFinder` stays path-only.

Command signature gains `AppHandle` (and uses managed `ProjectsCache` + `PreviewGrants`).

## Tests (Rust)

In `util/paths` tests (or path_auth tests):

1. Empty `ProjectsCache` → deny any path.
2. Path under registered root → allow (use real temp dir + cache with one project if cache construction allows; otherwise unit-test empty check + `ensure_within_roots` composition with a mock-friendly thin wrapper).
3. Existing `..` and symlink tests keep working.
4. Finder: unit-test the decision function if extracted:

```rust
fn may_reveal(path, roots_ok, preview_ok) -> bool
```

or integration-style with `PreviewGrants::grant_path` + `contains_path`.

## Acceptance

- [ ] No remaining private `ensure_root_allowed` / `require_within_roots` duplicates
- [ ] `reveal_in_finder` rejects arbitrary paths outside roots without a grant
- [ ] Preview file reveal still works for granted paths
- [ ] `cargo test` in `src-tauri/` green
- [ ] `cargo check` green

## Out of phase 1

- Directory grant path for finder (clone parent is a dir; reveal is file-oriented)
- Config path carve-out for finder
- Refactoring `fs_ops` off `AppHandle` (nice-to-have follow-up)

---

# Phase 2 — Session controller

## Outcome

`TerminalTab` is chrome + `useXterm` + controller lifecycle. Spawn, data pump, prefill, fit-on-visible, OSC/heuristic wire, exit handling, kill live in Session controller. Kill is `stop(tabId)` and idempotent.

## Location

`src/features/terminal/sessionController.ts`  
Optional split if file grows:

- `sessionController.ts` — public factory + map tabId → sessionId
- `fitOnVisible.ts` — pure-ish rAF stable-size fit policy (comments migrate from TerminalTab)

## External interface

```ts
type PtyIo = {
  spawn: typeof ptyApi.spawn;
  kill: typeof ptyApi.kill;
  write: typeof ptyApi.write;
  resize: typeof ptyApi.resize;
};

type SessionControllerDeps = {
  pty: PtyIo;
  subscribeData: typeof subscribePtyData;
  subscribeExit: typeof subscribePtyExit;
};

type StartArgs = {
  tabId: string;
  projectId: string | null;
  cwd: string;
  label: string;
  cliLaunchCommand?: string;
  cliToolId?: string;
  prefillCommand?: string;
  term: Terminal;           // xterm instance
  fit: FitAddon;
  getContainer: () => HTMLElement | null;
  disposed: () => boolean;
  onExit?: (info: { code: number; reason: PtyExitReason }) => void;
  // title updates go through tabsStore inside via projectKey callback or direct store (global OK)
};

type SessionController = {
  start(args: StartArgs): Promise<void>;
  stop(tabId: string): Promise<void>;
  onVisible(tabId: string, visible: boolean): void;
};

function createSessionController(deps: SessionControllerDeps): SessionController;
```

**Singleton for production:** module-level controller with real `ptyApi` + `subscribePty*`, so `project.store` and Tab lifecycle can `import { sessionController } from '...'` without React.

**Identity:** internal `Map<tabId, { sessionId, cleanups }>`. `stop(tabId)` kills if mapped, always clears map entry and store session if present.

## What moves out of TerminalTab

| Concern | Destination |
|---------|-------------|
| spawn + StrictMode cancel kill | `start` |
| subscribe data/exit | `start` |
| prefill write | `start` |
| term.onData / onResize → pty | `start` |
| OSC + heuristic + done sweeper | `start` |
| agent status clear on teardown | `stop` / start cleanup |
| fit-on-visible stable frames | `onVisible` |
| ResizeObserver fit | keep in TerminalTab **or** start (prefer keep in TerminalTab: DOM-bound) |
| context menu / clipboard / Shift+Enter | stay in TerminalTab (chrome/input) |
| link provider | stay in TerminalTab or start; either OK if cleanup is owned |

## Project teardown

`project.store.remove`:

```ts
for (const tab of bucket.tabs) {
  if (tab.kind === "terminal" || tab.kind === "cli") {
    await sessionController.stop(tab.id);
  }
}
tabs.dropBucket(id);
// explorer/git clear, unwatch, API remove (unchanged)
```

Remove session-map scan + raw `ptyApi.kill` from `remove`.

## TerminalTab after

```ts
useEffect(() => {
  void sessionController.start({ ... });
  return () => { void sessionController.stop(tabId); };
}, [tabId]);

useEffect(() => {
  sessionController.onVisible(tabId, isVisible);
}, [tabId, isVisible]);
```

Preserve load-bearing comments for fit (migrate to `fitOnVisible.ts`).

## Tests

Without Vitest, document manual QA. Prefer extracting pure:

- `sanitizeAgentTitle` (already in TerminalTab) → export and unit-test when harness exists
- fit stability policy as pure “given sizes stream, when to fit”

Optional: minimal node test file only if project adds vitest later.

## Manual QA checklist

- [ ] Cmd+T shell spawn, type, exit
- [ ] CLI tab spawn (Claude/Codex if installed)
- [ ] Switch tab hide/show: no clipped TUI, scrollback wheel works
- [ ] StrictMode double-mount: no double session / leaked PTY
- [ ] Close process tab: PTY dies
- [ ] Remove Project with running terminals: no stuck PTYs, other projects OK
- [ ] OSC title / agent status still update
- [ ] Prefill install command still works
- [ ] Shift+Enter newline behavior unchanged

## Acceptance

- [ ] No `ptyApi.kill` outside controller (except controller’s deps)
- [ ] `stop` idempotent (double unmount / remove + unmount)
- [ ] TerminalTab under ~250 lines preferred (chrome + wiring)
- [ ] `pnpm exec tsc --noEmit` green

---

# Phase 3 — Tab lifecycle

## Outcome

One module owns factories, open helpers (Project file + Preview), and Close request policy. All UI Process-tab closes go through it. Kill = Session controller `stop`, then store close. `useTabActions` becomes a thin React adapter.

## Location

```
src/features/tabs/
  tabLifecycle.ts      # public API
  factories.ts         # makeTerminalTab, makeCliTab, makeFileTab, makePreviewTab, makeDiffTab
  closePolicy.ts       # processSummary, planClose / requestClose decision
  openHelpers.ts       # openFileInProject, openPreview, openAfterMoveToProject
  index.ts             # re-exports
```

`tabsStore` may remain at `components/tabs/tabsStore.ts` for now; lifecycle imports it. Optional: `features/tabs/tabsStore.ts` re-export later.

Move `processSummary` / `PendingClose` types from `appShell.helpers.ts` into `closePolicy.ts` (helpers keep `looksLikeFile`, `EMPTY_BUCKET`, etc.).

## External interface (conceptual)

```ts
// Factories (pure)
makeTerminalTab({ projectKey, projectId, cwd, title, prefillCommand? }): TerminalTabT
makeCliTab({ projectKey, projectId, cwd, cli, title? }): CliTabT
makeFileTab({ projectId, path, name, openInEditMode? }): Tab  // editor|markdown|image|pdf
makePreviewTab({ path, grantId }): Tab
makeDiffTab({ projectId, path, status }): DiffTabT

// Open (mutates store)
openTabInProject(projectKey, tab, setActive?: boolean): void  // thin over tabsStore.openTab
openFileInProject(project, path, name, openInEditMode?): void
openPreview(projectKey, grant: PreviewGrant): void
openAfterSentToProject({ dest, oldPath, newPath, ... }): void

// Close policy (pure + imperative execute)
type ClosePlan =
  | { action: "close"; ids: string[] }
  | { action: "confirm"; pending: PendingClose };

planClose(mode, targets: Tab[], singleTab?: Tab): ClosePlan

// After user confirms, or when action === "close":
async function executeClose(projectKey: string, ids: string[]): Promise<void>
// for each id: if process tab → sessionController.stop(id); then tabsStore.closeMany
```

UI owns dialog: if `planClose` returns `confirm`, AppShell sets `pendingClose` and on confirm calls `executeClose`.

## Hard close rule (call sites)

| Surface | Today | After |
|---------|--------|--------|
| Tab bar / `useTabActions` closeTab/closeOthers/closeAll | requestClose local | `planClose` + dialog / `executeClose` |
| `CodeProjectGroup` `closeTabHere` | raw `tabsStore.closeTab` | same planClose/executeClose path |
| Keyboard close active | via useTabActions | unchanged entry, new impl |
| confirmPendingClose | closeMany only (no kill!) | **must** `executeClose` (fixes missing kill on confirm) |

**Bug fix included:** today’s `confirmPendingClose` only `closeMany` and relies on unmount for kill. Phase 3 `executeClose` always `stop` then close, so confirm is safe even if unmount order races.

## Open helpers migration

From `useTabActions` into lifecycle:

- `openFile` (Project)
- `openPreviewFile` / `pickPreviewFile` (pick stays adapter: dialog + `openPreview`)
- `sentToProject` tab open/close preview id
- `newTerminal` / `launchCli` / `openInTerminal` / `launchCliInPath` / `afterWorktreeCreate` / `openDiff`
- `CodeProjectGroup` `newTerminalHere` / `launchCliHere` / file opens → factories + open

OS `app://open-file` + pending grants: thin effect in useTabActions still, body calls `openPreview`.

## useTabActions residual

Keeps:

- open folder dialog, clone/worktree dialog flags
- sendToTerminal (session write via store + ptyApi)
- jumpToNextAttention
- drop target / looksLikeFile + addProject
- clipboard/reveal for non-close tab chrome
- AppCommands assembly + register shape
- pendingClose React state wiring to `planClose` / `executeClose`

Deletes/moves: inline tab object literals for open/close policy.

## CodeProjectGroup

- Import lifecycle factories for “+” terminal/CLI
- `closeTabHere` → planClose; if confirm needed, must surface dialog

**Dialog problem:** Close confirm lives in AppShell today. Sidebar cannot set AppShell state.

**Resolution (pick one; recommended R1):**

- **R1:** Tab lifecycle emits via a tiny module store `usePendingCloseStore` (or callback registry) that AppShell already mounts `CloseTabsConfirm` against. Sidebar and useTabActions both write pending close there.
- **R2:** Pass `onRequestClose(tabId)` from AppShell into sidebar tree (prop drilling).

**Use R1** so hard rule does not depend on prop depth. Store holds `PendingClose | null` + `projectKey`; AppShell renders confirm; confirm calls `executeClose`.

## Tests (pure, when harness exists)

- `planClose`: file-only → close; with Process tabs → confirm; counts terminals vs agents
- factories: ids, kinds, previewGrantId set
- `executeClose` with fake sessionController: stop called before closeMany

## Manual QA

- [ ] Close process tab from tab bar → confirm → PTY gone
- [ ] Close process tab from vertical sidebar → **same confirm**
- [ ] Close others / close all with mix of file + process
- [ ] Close file tab: no confirm
- [ ] Open file / markdown / image / pdf from explorer
- [ ] Preview open + Open With + send to Project
- [ ] New terminal / CLI from AppShell and from CodeProjectGroup (same tab shape)
- [ ] Worktree create opens terminal at path
- [ ] Remove Project still clean (phase 2 path)

## Acceptance

- [ ] No Process tab close via raw `tabsStore.closeTab` from UI components
- [ ] `confirmPendingClose` always goes through `executeClose` (stop + close)
- [ ] Factories are single construction site for Tab objects used by open paths
- [ ] `pnpm exec tsc --noEmit` green
- [ ] useTabActions substantially thinner (target: policy out, dialogs in)

---

# Cross-cutting rules

1. **CONTEXT.md language** in code comments and new symbols where natural (`Process tab`, `Session controller`, not “agent tab” for CLI).
2. **No em-dash** in comments/copy (project rule).
3. **Do not resurrect** Agent view or SSH Projects.
4. **Dual register** Tauri commands only if phase 1 changes command signatures (finder may need `AppHandle`; frontend `invoke` call sites check args).
5. **AGENTS.md / CLAUDE.md:** after phase 3, add a short “where to look” row for Tab lifecycle + Session controller (same edit both files).

## Docs touch list

| File | When |
|------|------|
| `CONTEXT.md` | Already seeded; update only if terms shift |
| `AGENTS.md` + `CLAUDE.md` | End of phase 3: where to look first table |
| `plans/012-...` | Check boxes as phases complete |

## Risk register

| Risk | Mitigation |
|------|------------|
| Finder breaks preview reveal | `contains_path` + manual QA on preview tab reveal |
| Double kill on unmount + executeClose | `stop` idempotent |
| Sidebar confirm without dialog | R1 pending-close store |
| Fit regressions WKWebView | migrate comments + QA checklist phase 2 |
| Scope creep into workspace persistence | explicitly out of phase 3 |

## Suggested commit / PR titles

1. `refactor(rust): centralize path authorization and gate reveal_in_finder`
2. `refactor(terminal): extract session controller for PTY lifecycle`
3. `refactor(tabs): tab lifecycle for open/close policy across UI surfaces`

## Definition of done (all phases)

- Path authorization is the only roots-entry for normal FS/git/search/pty cwd; finder is roots ∪ Preview grant.
- Session controller is the only frontend kill/spawn owner for Process tabs.
- Tab lifecycle is the only open-factory + close-policy owner; Process tab close is uniform; kill then store close.
- Domain terms match `CONTEXT.md`.
- Typecheck + Rust tests green; manual QA checklists passed.
