# Design: Agent Runtime Reliability Hardening

> This is a Design-First, Substantial-tier specification for a brownfield Tauri application. The implementation agent must follow the boundaries, contracts, order, and rollback rules in this document. It must not replace these decisions with a broad rewrite.

## 1. Safety rules for the implementation agent

1. Treat every existing tracked or untracked workspace change as user-owned.
2. Never run `git reset`, `git checkout`, `git clean`, or any command that discards local work.
3. Never push, publish, create a pull request, merge, tag, or deploy.
4. Before every task, run `git status --short` and inspect `git diff -- <each planned file>`.
5. Edit only files named by the active task. If a required edit falls outside that list, update the plan before editing.
6. Do not combine tasks because their files overlap. Finish the active task, run its named tests, inspect its diff, and only then continue.
7. Do not use a repository-wide formatter to repair unrelated files. Format only files intentionally changed by the active task. If the global format gate still fails outside those files, record the exact baseline failure and stop.
8. Do not weaken or delete a test to make a gate pass. Fix the implementation or document a genuine specification conflict.
9. Do not add raw Tauri command strings. Every command must be registered in Rust and mirrored through `src/lib/ipc.ts::CMD`.
10. Do not add raw event names. Every event must be centralized in `src-tauri/src/events.rs` and `src/lib/events.ts`.
11. Do not bypass project-root validation, grants, atomic writes, the PTY no-drop channel, or Tauri capabilities.
12. Do not change xterm addon order, initial dimensions, first-frame deferral, hidden fit protection, or terminal line height unless a named task and characterization test require it.
13. Every new user-facing string must be added to both locale files before the task is complete.
14. Every task must leave the app buildable. Temporary compatibility adapters are allowed between tasks. Broken intermediate commits are not allowed.

## 2. Architecture overview

The hardening work introduces explicit ownership at the existing Rust and React boundary. Rust remains responsible for processes, filesystem state, watchers, browser webview state, and durable persistence. React remains responsible for presentation, user intent, and ephemeral UI state.

The target architecture has ten components.

1. `RuntimeSupervisor` in Rust owns global runtime state: `running`, `quiescing`, `stopping`, or `stopped`. It gates PTY and clone creation and coordinates safe app exit.
2. `PtySupervisor` in Rust owns one state machine per PTY session. It prepares IDs, starts children only after attach, sequences events, retains a bounded journal, handles reader failure persistently, drains output, emits exactly one exit, and reaps the child.
3. `PtyEventMultiplexer` in TypeScript installs the global Tauri listeners once before any session can start. It routes sequenced events to per-session consumers and deduplicates replay against live events.
4. `SessionActor` in TypeScript replaces generation changes that occur inside queued operations. It records desired state and an operation revision synchronously, then serializes effects.
5. `QuitCoordinator` has a Rust owner and a frontend adapter. It exchanges a unique token, flush results, failure details, retry, and explicit force quit.
6. `ResumeStore` and `WorkspaceStore` in Rust serialize mutation and reject stale revisions while preserving existing JSON compatibility.
7. `BrowserBridge` uses semantic navigation events, asynchronous evaluation, a per-webview secret, trusted input checks, and no raw global key forwarding.
8. `CliRuntimeService` unifies registry capability, shared discovery, resolved executable path, safe arguments, elevated arguments, and explicit consent.
9. `AttentionCoordinator` and `LiveSessionRegistry` provide global project-aware attention and typed provider session identity.
10. `ResourceScopeCoordinator` derives watcher scope, coalesces Git refreshes, batches metadata work, and reports exact or unavailable port ownership.

## 3. Dependency order

The implementation order is mandatory because later work depends on contracts established earlier.

1. Pin the current behavior with characterization tests and add test infrastructure.
2. Add Rust and TypeScript types without switching production behavior.
3. Introduce the global PTY event multiplexer.
4. Introduce the frontend session actor and fix the immediate stop race.
5. Introduce Rust PTY prepare, attach, start, sequencing, replay, persistent stop reason, and ordered exit.
6. Switch production session startup to the new protocol, then remove the old direct spawn path.
7. Add terminal failure UI and diagnostics.
8. Add the runtime quit coordinator.
9. Serialize persistence and add workspace revisions.
10. Replace browser polling and secure the bridge.
11. Make visual-context delivery await the PTY write.
12. Introduce safe CLI policy and canonical discovery.
13. Fix attention, bootstrap, resume identity, command capability, and project removal.
14. Fix watcher, Git, metadata, port attribution, and status hot paths.
15. Implement renderer detachment only after the stress harness proves it is necessary and the restoration spike passes.
16. Add accessibility, localization, CI, release gates, dependency updates, and final cross-platform verification.

An implementation agent must not start browser, persistence, or performance refactors before the PTY protocol is stable and tested.

## 4. PTY lifecycle design

### 4.1 Rust state model

Create a dedicated supervisor module under `src-tauri/src/pty/`. Do not keep adding lifecycle responsibility to `pty/mod.rs`.

```rust
enum PtyLifecycleState {
    Prepared,
    Attached,
    Starting,
    Running,
    Stopping,
    Exited,
}

enum PtyStopReason {
    Running,
    NormalExit { code: i32 },
    Killed,
    ReaderError,
    DrainerStalled,
    SpawnFailed,
}

struct PtyEventEnvelope {
    session_id: String,
    seq: u64,
    event: PtyEvent,
}

enum PtyEvent {
    Data { data_b64: String },
    Backpressure { queue_depth: usize, stalled_ms: u64 },
    Exit { exit_code: i32, reason: String },
}
```

Use a persistent state channel such as `tokio::sync::watch` for stop reason. Do not use a transient `Notify` as the only signal for reader failure. The waiter must observe the current terminal reason before every wait.

Each session owns the following resources.

1. Child process handle.
2. Blocking reader thread.
3. Existing bounded chunk channel.
4. Drainer task.
5. Waiter task.
6. Persistent stop-reason sender and receiver.
7. Monotonic event sequence counter.
8. Bounded event journal.
9. Lifecycle state.

The journal must retain at least all events from preparation until confirmed attachment. After attachment, it may retain the latest 1,024 envelopes or 4 MiB, whichever bound is reached first. Data remains authoritative in the live terminal after normal attachment. The journal exists for startup and reconnect recovery, not as permanent terminal history.

### 4.2 Rust command contract

Add new commands before removing `pty_spawn`.

```rust
struct PtyPrepareResponse {
    session_id: String,
}

struct PtyAttachRequest {
    session_id: String,
    after_seq: u64,
}

struct PtyAttachResponse {
    events: Vec<PtyEventEnvelope>,
    last_seq: u64,
    state: String,
}
```

Commands:

1. `pty_prepare(spec)`: validate the project, cwd, command kind, and runtime state. Allocate and register a prepared session. Do not spawn a child.
2. `pty_attach(session_id, after_seq)`: mark the prepared session attached and return retained events after `after_seq`.
3. `pty_start(session_id)`: start the child only when attached. Return after the start attempt is known. Events may arrive before this command returns because listeners are already installed.
4. `pty_kill(session_id)`: set persistent stop reason, kill the full owned process scope, await ordered drain and exit within the documented bound.
5. `pty_list()`: return typed session snapshots with lifecycle state and latest sequence.

During migration, keep `pty_spawn` as a compatibility wrapper used by no production caller. Remove it only after command parity and all startup tests pass.

### 4.3 Event ordering

The drainer is the only owner of data emission. The supervisor is the only owner of final exit emission.

Exit ordering is mandatory.

1. Stop accepting reader chunks.
2. Close or drain the chunk channel.
3. Await the drainer with a bounded timeout.
4. Emit one final exit envelope with the next sequence number.
5. Mark lifecycle state exited.
6. Remove the session from live maps.
7. Retain a short terminal snapshot only as long as needed for attach recovery.

No data event may be emitted after the exit envelope.

### 4.4 Frontend event multiplexer

Create `src/features/terminal/ptyEventMultiplexer.ts`.

Responsibilities:

1. Install global data, backpressure, and exit listeners exactly once.
2. Expose `ensureReady(): Promise<void>` that rejects when any listener cannot be installed.
3. Expose `subscribe(sessionId, consumer)` before `pty_start` is called.
4. Track `lastSeq` per session.
5. Buffer live envelopes that arrive while an attach replay request is in flight.
6. Merge replay and live envelopes by sequence.
7. Discard duplicate or older envelopes.
8. Report a sequence gap as a diagnostic and request replay from the last consumed sequence.
9. Dispose per-session consumers without removing the global Tauri listeners.

Do not let every terminal component install its own Tauri listener.

### 4.5 Frontend session actor

Replace the current generation pattern with an actor-like entry.

```ts
type DesiredSessionState = "running" | "stopped";

type SessionPhase =
  | "idle"
  | "preparing"
  | "attaching"
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed";

interface SessionEntry {
  revision: number;
  desired: DesiredSessionState;
  phase: SessionPhase;
  sessionId: string | null;
  chain: Promise<void>;
}
```

Every public `start` or `stop` call must update `revision` and `desired` synchronously before appending work to `chain`. No queued operation may increment the revision after awaiting an older operation.

The actor checks its captured revision and current desired state after every asynchronous boundary. If a start becomes obsolete after preparation, it kills or abandons the prepared session before returning. If it becomes obsolete after child startup, it calls `pty_kill` and waits for completion.

The actor owns all listeners and terminal subscriptions. React cleanup asks the actor to stop. React cleanup does not directly kill the PTY.

## 5. Terminal state and diagnostics design

Create one typed public state per tab.

```ts
type TerminalRuntimeState =
  | { phase: "starting"; step: "listeners" | "prepare" | "attach" | "child" }
  | { phase: "running"; sessionId: string }
  | { phase: "failed"; step: string; error: AppError; retryable: boolean }
  | { phase: "exited"; code: number; reason: PtyExitReason };
```

`TerminalTab` renders exclusively from this state.

1. `starting` shows the existing loading presentation and current startup step.
2. `running` shows xterm.
3. `failed` shows localized summary, normalized detail, Retry, Copy diagnostics, and Close tab.
4. `exited` keeps the transcript and shows restart when appropriate.

Every failure in listener install, prepare, attach, start, write, resize, or kill must record a structured diagnostics entry. Console logging may remain as secondary developer output, but never as the only user-visible response.

## 6. Quit coordination design

### 6.1 Rust coordinator

Add a managed `RuntimeSupervisor` or `QuitCoordinator` state.

```rust
enum RuntimeState {
    Running,
    Quiescing { token: String, deadline: Instant },
    Stopping { token: String },
    Stopped,
}

struct QuitFailure {
    area: String,
    code: String,
    message: String,
}

struct QuitReadyRequest {
    token: String,
    failures: Vec<QuitFailure>,
}
```

Commands and events:

1. Event `app://prepare-quit` with token and deadline milliseconds.
2. Command `app_quit_ready(token, failures)`.
3. Event `app://quit-blocked` with token and failures.
4. Command `app_retry_quit(token)`.
5. Command `app_force_quit(token)`.

The close handler is single-flight. Repeated close requests during quiescing must not create new timers or duplicate cleanup tasks.

If `failures` is empty, transition to stopping, abort clones, stop PTYs, stop watchers, wait for owners, and exit. If failures exist or the five-second deadline expires, return to running, emit `quit-blocked`, and keep the window open. Force quit is the only path that may exit after a failed flush.

### 6.2 Frontend coordinator

Move quit flushing out of `useWorkspacePersistence` into one app-level coordinator. Individual persistence modules expose `flush(): Promise<FlushResult>`.

Run independent flushes concurrently, but serialize saves that target the same durable document. Return every failure. Do not stop after the first rejection.

The blocked-quit UI must list each failed area and provide Retry and Force Quit. Force Quit copy must state that unsaved state can be lost.

## 7. Persistence design

### 7.1 Resume store

Replace command-local read-modify-write with one managed in-memory store protected by a mutex.

At application setup:

1. Read and validate `resume.json` once.
2. Apply existing pruning.
3. Store canonical records in memory.
4. Persist mutations in the same serialized critical section or through a single writer actor.

Record identity is provider plus provider session ID. A mutation merges `last_seen_at`, branch, cwd, title, and launch metadata using the newest mutation revision.

### 7.2 Workspace revisions

Add a backward-compatible persisted revision.

```ts
interface WorkspaceSaveRequest {
  projectId: string;
  revision: number;
  state: WorkspaceState;
}

type WorkspaceSaveResult =
  | { status: "accepted"; revision: number }
  | { status: "stale"; acceptedRevision: number };
```

The frontend increments a per-project revision synchronously when workspace state becomes dirty. A debounced save captures that revision. A quit flush waits for any current save, then writes only the latest dirty revision.

The backend tracks the highest accepted revision per project. Existing workspace files without a revision load as revision zero. A stale request returns `stale` and does not touch disk.

### 7.3 Failure behavior

A failed save must not clear dirty state. Diagnostics must include project or area, revision, error code, and retry outcome. Retrying the same revision is allowed when no newer revision has been accepted.

## 8. Browser design

### 8.1 Remove polling

Remove the 500 millisecond interval from `BrowserPanel`.

At document start, the injected bridge wraps `history.pushState` and `history.replaceState`, observes `popstate`, `hashchange`, `DOMContentLoaded`, and `load`, then reads `location.href`, `document.title`, and loading state directly. It sends semantic `location` messages only when the snapshot changes.

The frontend browser store updates from `browser://navigated`. A manual one-shot URL query may remain for recovery and tests, but it must use an asynchronous callback channel and `tokio::time::timeout`. It must not use `std::sync::mpsc::recv_timeout` inside an async command.

### 8.2 Authenticated bridge

When the webview is created, Rust generates a cryptographically secure token with at least 128 bits. Rust stores the token in `BrowserState` and injects it only inside a document-start closure.

The injected closure captures the token and a bound native bridge function. It does not assign the token to `window`, the DOM, or another page-readable global.

Allowed semantic messages are limited to:

1. `location` with URL, title, and loading state read by the injected closure.
2. `escape` generated only from a trusted keyboard event with `event.isTrusted`.
3. `selection` generated only from a trusted pointer event while pick mode is active.

Remove raw `key`, `meta`, `ctrl`, `alt`, and `shift` forwarding. Remove `dispatchBindingFromChild`. Loaded web content must never reach the global keybinding dispatcher.

Rust validates token, message type, URL scheme, payload length, and current browser mode. It rejects unknown fields. URL and title limits are 8,192 and 1,024 UTF-8 bytes respectively. Only `http`, `https`, and explicit internal blank URLs are accepted for history mutation.

### 8.3 Visual-context delivery

Change `sendVisualToCli` into an asynchronous function returning a typed result.

```ts
type VisualSendResult =
  | { status: "sent"; sessionId: string; tabId: string }
  | { status: "no-cli" }
  | { status: "failed"; sessionId: string; error: AppError };
```

Select the last focused running CLI in the active project. Await `ptyApi.write`. Activate the tab and show success only after the write resolves. On failure, keep the browser mode and show the normalized error.

## 9. CLI runtime design

### 9.1 Canonical capability contract

Replace `args` and presentation-only `dangerLevel` with explicit capability fields.

```ts
interface CliTool {
  id: string;
  label: string;
  command: string;
  safeArgs: string[];
  elevatedArgs?: string[];
  elevatedWarningKey?: string;
  needsConfig?: boolean;
  category?: CliCategory;
  enabledByDefault: boolean;
}

type CliAvailability =
  | { status: "checking" }
  | { status: "installed"; resolved: ResolvedCliLaunch }
  | { status: "missing" }
  | { status: "failed"; error: AppError };

interface ResolvedCliLaunch {
  executable: string;
  requiredEnv: Record<string, string>;
  shellKind: "unix-login" | "powershell";
}
```

Safe args for the three currently elevated providers are empty unless the provider requires a non-dangerous normal-mode argument. Existing bypass flags move to `elevatedArgs`.

Launcher, project empty state, Settings, missing panel, and CLI tab consume the same capability selector. Disabled agents remain hidden everywhere except their Settings toggle. `needsConfig` cannot be shown unless there is a functional configuration path.

### 9.2 Discovery

Keep one frontend cache and one in-flight promise per CLI ID. `CliTabComponent` must consume this service instead of invoking detection directly.

Rust discovery must enforce a five-second timeout and kill plus reap any login shell that exceeds it. The result must distinguish missing from failed. The absolute executable path and required startup environment returned by discovery must be used by spawn.

Dynamic executable paths and arguments are passed as structured values. Rust is responsible for shell escaping every dynamic token before constructing a login-shell command. Frontend string concatenation must not build the final shell command.

### 9.3 Elevated launch

The default action always uses safe args. A separate elevated action opens a confirmation dialog that names the provider, exact flags, project path, and consequences. Confirmation applies only to that launch and is not persisted as a global bypass.

## 10. Agent experience design

### 10.1 Bootstrap barrier

Introduce `BootstrapState` with `loading`, `ready`, and `failed`. The shell may render during loading, but commands that create terminals, agents, files, or project-scoped work must remain disabled until ready.

Remove `/` as a fallback cwd. A no-project terminal may use the resolved user home only after home hydration succeeds. A project CLI requires an active registered project.

### 10.2 Attention coordinator

Create a project-aware attention selector outside React components. It combines agent status, tab ownership, active tab, active project, document visibility, and Tauri window focus.

The global next-attention order is oldest unresolved attention first. When chosen, switch project, activate tab, set shell focus to center, focus xterm, and mark the notification navigation complete. Notifications are suppressed only when the exact tab is visible and the application window has focus.

### 10.3 Live provider session identity

Add `providerSessionId` and `providerId` to the canonical terminal session and tab metadata. Capture updates the live registry before persisting history. Resume rows derive `liveTabId` through typed equality, not substring inspection of a launch command.

Clicking a live resume row focuses the existing tab. It never spawns a duplicate process.

### 10.4 Project removal

Move project removal commit responsibility to one backend transaction.

1. Validate the project and build the next registry state.
2. Persist the next registry atomically before mutating the live cache.
3. If persistence fails, return an error and change no resource ownership.
4. Publish the new cache after persistence succeeds.
5. Ask watcher and PTY owners to clean project resources.
6. Return committed success plus any cleanup warnings.

The frontend drops tabs and caches only after committed success. Cleanup warnings go to diagnostics but do not resurrect a registry record that has already committed.

## 11. Scale and metadata design

### 11.1 Idempotent status

`setStatus` compares semantic status, attention profile, and provider session identity before mutating. Repeating `working` with no new semantic data returns the existing Zustand state object and preserves `changedAt`.

Project rows subscribe to a project-scoped rollup selector rather than the full `byTab` map. Replace one interval per tab with a central scheduler that owns only active deadlines.

### 11.2 Watcher and Git scope

Derive the desired watched-project set from active project ID plus project IDs with running sessions. Reconcile additions and removals against that set. On activation after an unwatched period, perform existing full explorer and Git revalidation.

Git refresh uses a per-project in-flight promise, a requested revision, and an applied revision. Overlapping calls coalesce. If another refresh is requested during a call, run one more call after completion. A response applies only when its revision is not older than the latest applied revision.

### 11.3 Metadata batching and ports

Replace `setInterval` with a recursive async loop. The next cycle starts only after the current cycle completes or is canceled.

Collect metadata for all running sessions in one backend command. Cache branch by cwd until cwd changes or a relevant filesystem event invalidates it.

Port ownership uses a `ProcessTreeSampler` abstraction.

1. macOS builds one descendant PID set per PTY process group, then runs one `lsof` batch with intersection semantics and parses process fields explicitly.
2. Windows queries the existing Job Object for owned process IDs, then maps sockets through the platform TCP table.
3. Linux uses exact descendant ownership when available. If permissions or APIs cannot establish ownership, return `unavailable` instead of an empty success or unrelated ports.

The frontend represents port status as `loading`, `available`, or `unavailable`.

### 11.4 Renderer detachment

Do not implement renderer detachment until the stress benchmark proves the current renderer count violates NFR-004.

If required, first build a spike using xterm serialization with these characterization cases: normal shell scrollback, alternate-screen TUI, Unicode, theme switch, resize, hidden output, and remount. The production design may retain a headless terminal buffer or serialize plus replay, but it must prove no transcript corruption before replacing the current keep-mounted behavior.

If the spike cannot preserve behavior, keep renderers mounted and optimize status, watcher, metadata, and output subscriptions instead. Do not ship a lossy terminal restoration system merely to reduce memory.

## 12. Accessibility and localization design

Add a terminal accessibility setting owned by `settings.data`. Apply `screenReaderMode` to new and existing xterm instances. The setting label, help text, error states, elevated launch confirmation, quit failure modal, browser errors, and fallback agent notifications require English and Brazilian Portuguese keys.

Do not hardcode fallback notification strings in OSC handlers. Convert semantic notification types into localized text at the dispatcher boundary.

## 13. Test architecture

### 13.1 Frontend

Keep Vitest. Extend test discovery to `.test.tsx`. Add `jsdom`, React Testing Library, and user-event only for component interaction tests. Keep pure controller and store tests in the Node environment.

Required test seams:

1. Inject PTY API, listener bridge, clock, and diagnostics into the session actor.
2. Use fake timers for startup timeout, attention, discovery timeout, and metadata scheduling.
3. Use deterministic event envelopes with explicit sequence numbers.
4. Test Zustand stores through public state actions, not private implementation fields.
5. Use component tests only for visible state and user actions. Keep lifecycle correctness in controller tests.

### 13.2 Rust

Extract supervisor logic from Tauri handles where possible. Test pure state transitions and event ordering with `tokio::test`, deterministic channels, and injected clocks or deadlines. Do not use sleeping tests for lost-wakeup or sequencing behavior.

Use platform-gated unit tests for command construction and parsing. Add integration tests for the PTY protocol where the platform runner supports a real shell.

### 13.3 Stress harness

Create an opt-in deterministic stress test command or test module that can run 12 controlled child processes. It records output rate, event sequence gaps, input dispatch latency, attention propagation latency, stop duration, remaining sessions, and process cleanup.

The normal CI suite may use a shorter deterministic profile. The full 10,000-iteration lifecycle loop and 12-session benchmark run in a dedicated reliability job or before release.

## 14. CI and release design

Add `.github/workflows/quality.yml` with both `workflow_call` and push or pull-request triggers. Pin pnpm through an exact `packageManager` value in `package.json`. Do not keep a different pnpm major in the release workflow.

Required jobs:

1. Frontend quality on Ubuntu: frozen install, dependency audit, tests, traceability, TypeScript production build, and IPC-event parity.
2. Rust quality on Ubuntu: format check, Clippy with all targets and warnings denied, and Rust tests.
3. Platform checks on macOS, Windows, and Ubuntu for changed platform-specific runtime modules.
4. Reliability tests for PTY lifecycle, quit, browser timeout, and process cleanup.

The release workflow calls the reusable quality workflow and declares every publishing job dependent on its success. A tag cannot bypass the gate.

Update `nanoid` to a patched direct version and refresh only the pnpm lockfile through pnpm. Do not use npm or yarn.

## 15. Compatibility and migration

1. Existing workspace files load with revision zero.
2. Existing resume records load without live identity fields. Live state remains ephemeral and must not be persisted as permanently live.
3. Existing settings load with terminal screen-reader mode disabled unless explicitly enabled.
4. Existing CLI overrides require a normalization adapter from `args` to safe args. Overrides containing known bypass flags must become elevated args and must not silently remain safe defaults.
5. Existing Tauri command and event names remain until the frontend has switched and parity tests prove the new contract.
6. No startup migration may resurrect legacy agent or SSH state.

## 16. Requirement mapping

1. `PtySupervisor`, `PtyEventMultiplexer`, and `SessionActor` satisfy REQ-001 through REQ-010 and NFR-001 through NFR-002.
2. `RuntimeSupervisor`, frontend quit adapter, `ResumeStore`, and `WorkspaceStore` satisfy REQ-011 through REQ-018, NFR-003, and NFR-007.
3. `BrowserBridge` and asynchronous browser commands satisfy REQ-019 through REQ-025, NFR-005, and NFR-006.
4. `CliRuntimeService` satisfies REQ-026 through REQ-030.
5. Bootstrap, attention, live session identity, capability registry, and transactional project removal satisfy REQ-031 through REQ-038.
6. Status, watcher scope, Git coalescing, metadata batching, process-tree ports, and optional renderer detachment satisfy REQ-039 through REQ-045 and NFR-004.
7. Test configuration, traceability, localization, accessibility, dependency audit, quality workflow, and release dependency satisfy REQ-046 through REQ-052 and NFR-009.
8. Every component is constrained by NFR-008 and NFR-010.

## 17. Rejected alternatives

1. Moving listener registration a few lines earlier was rejected because it does not establish atomic attachment or replay.
2. Keeping generation counters and adding another comparison was rejected because revision changes after awaits remain vulnerable to lifecycle races.
3. Increasing the fixed quit delay was rejected because no fixed delay proves completion.
4. Using atomic rename alone was rejected because it does not serialize read-modify-write operations or reject stale snapshots.
5. Keeping browser polling with a longer interval was rejected because overlap and blocking evaluation remain possible.
6. Allowing raw browser key forwarding with an allowlist was rejected because loaded content must have no path to global application commands.
7. Persisting a global always-elevated CLI preference was rejected because it would recreate unsafe defaults under another name.
8. Watching all projects with a larger debounce was rejected because idle projects would still consume filesystem and Git resources.
9. Returning an empty port list on unsupported platforms was rejected because empty means no listeners, not ownership unavailable.
10. Immediately rewriting terminal rendering was rejected because the existing keep-mounted behavior protects xterm state and must be characterized before replacement.
