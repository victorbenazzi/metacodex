# Requirements: Agent Runtime Reliability Hardening

> This specification is written for implementation by an AI coding agent. Every binding requirement uses EARS notation and must be verified by an automated test unless `tasks.md` explicitly records a justified exception.

## Context

metacodex is a local-first Tauri desktop workspace that runs terminal-native AI coding agents inside PTY sessions. The current implementation has verified races in session lifecycle, event attachment, shutdown, persistence, browser integration, and metadata collection. This hardening project must make agent execution predictable, recoverable, secure, observable, and scalable without restoring removed product areas or redesigning the shell.

## Current behavior baseline

1. `pty_spawn` starts the child, reader, drainer, and waiter before returning the session ID. The frontend subscribes to data and exit after that return.
2. `sessionController.stop` invalidates the current generation before waiting, while `start` increments the generation after waiting. An immediate stop can be invalidated by the start it intends to stop.
3. Reader failure sets `reader_failed` and calls `notify_waiters`, but the waiter persistently checks only `killed`.
4. App close emits `app://before-quit`, waits 300 milliseconds, aborts clones, kills PTYs, and exits without a frontend acknowledgement.
5. Resume and workspace persistence use atomic file replacement, but concurrent read-modify-write operations are not serialized or revision checked.
6. The in-app browser polls its URL every 500 milliseconds. URL evaluation uses a synchronous receive timeout inside an asynchronous command.
7. Browser page integration uses a public magic host and raw key payloads without a per-webview secret.
8. Claude Code, Grok Build, and Kimi Code include approval bypass flags in their default launch arguments.
9. CLI discovery may start one login shell per CLI without a timeout. The discovered executable path is not used for launch.
10. Watchers cover every registered project. Terminal metadata polling and Git refreshes can overlap.
11. All terminal renderers remain mounted across all projects. Repeated `working` status updates still mutate global state.
12. The release workflow can publish without first running frontend tests, TypeScript build, Rust tests, Rust formatting, Clippy, or dependency audit.

## In scope

1. PTY preparation, attachment, startup, data ordering, exit ordering, cancellation, reaping, and frontend lifecycle ownership.
2. Typed terminal startup and failure states with retry and diagnostics.
3. Coordinated shutdown for editors, settings, workspaces, diagnostics, PTYs, clones, and watchers.
4. Serialized resume and workspace persistence with monotonic revisions.
5. Browser navigation events, asynchronous evaluation, authenticated bridge messages, and reliable visual-context delivery.
6. Safe CLI launch policy, elevated launch consent, canonical CLI capability state, and bounded CLI discovery.
7. Cross-project attention, live provider session identity, bootstrap barriers, and project removal recovery.
8. Watcher scope, Git refresh ordering, metadata polling, descendant port attribution, status update cost, and inactive terminal rendering.
9. Accessibility, localization, automated traceability, CI gates, release gates, and the direct vulnerable dependency.

## Out of scope

1. Restoring the removed Agent view, cron, MCP registry, agent entities, or opencode sidecar.
2. Restoring remote SSH projects or trust state.
3. Replacing Tauri, xterm.js, Zustand, Vitest, Cargo, or the current two-process architecture.
4. Redesigning the v3 shell, changing the visual language, or introducing new product navigation.
5. Adding new AI providers or changing provider-specific resume syntax beyond the identity contract required here.
6. Weakening project-root path validation, preview grants, directory grants, or capability permissions.
7. Publishing, pushing, creating a pull request, tagging a release, or deploying artifacts.

## Functional requirements

### PTY lifecycle and delivery

REQ-001 (event-driven): WHEN the frontend accepts a terminal or CLI start request for a tab, THE SESSION CONTROLLER SHALL assign one lifecycle revision and one runtime owner to that request.

REQ-002 (unwanted): IF a stop request arrives while a start request for the same tab is pending, THEN THE SESSION CONTROLLER SHALL resolve the stop only after no PTY and no pending spawn remain for the stopped revision.

REQ-003 (event-driven): WHEN start, stop, and start requests occur for the same tab in that order, THE SESSION CONTROLLER SHALL leave exactly one PTY that belongs to the final start request.

REQ-004 (state-driven): WHILE a prepared PTY session has no confirmed frontend attachment, THE PTY SUPERVISOR SHALL NOT start its child process.

REQ-005 (event-driven): WHEN the PTY supervisor emits data, backpressure, or exit information, THE PTY SUPERVISOR SHALL assign a strictly increasing sequence number within that session.

REQ-006 (event-driven): WHEN a frontend attaches with a last consumed sequence number, THE PTY SUPERVISOR SHALL replay every retained event with a greater sequence number exactly once and in order.

REQ-007 (unwanted): IF a child process exits before the start command returns, THEN THE FRONTEND SHALL still receive the exit event and render the session as exited.

REQ-008 (unwanted): IF the blocking PTY reader fails, THEN THE PTY SUPERVISOR SHALL emit exactly one exit event with reason `reader_error` and evict the session within one second.

REQ-009 (state-driven): WHILE a session is in its terminal exited state, THE PTY SUPERVISOR SHALL NOT emit any later data event for that session.

REQ-010 (unwanted): IF global PTY listener installation, PTY preparation, attachment, or child startup fails, THEN THE FRONTEND SHALL render a typed failed state with the normalized error, the failed phase, a retry action, and access to diagnostics.

### Shutdown and persistence

REQ-011 (event-driven): WHEN the app receives its first close request while running, THE RUNTIME SUPERVISOR SHALL enter one single-flight `quiescing` operation with a unique quit token.

REQ-012 (state-driven): WHILE the runtime is quiescing, THE RUNTIME SUPERVISOR SHALL reject new PTY starts and new Git clone starts with a typed `app_quiescing` error.

REQ-013 (event-driven): WHEN the frontend receives a quit preparation token, THE FRONTEND SHALL flush dirty editors, settings, loaded workspaces, resume state, and diagnostics before acknowledging that token.

REQ-014 (event-driven): WHEN the backend receives a successful acknowledgement for the active quit token, THE RUNTIME SUPERVISOR SHALL abort clones, stop and reap PTYs, stop watchers, and exit only after those resource owners report completion or their documented bounded timeout.

REQ-015 (unwanted): IF quit preparation fails or exceeds five seconds, THEN THE SYSTEM SHALL cancel automatic exit, display the failed operations, and offer explicit retry and force-quit actions.

REQ-016 (event-driven): WHEN two resume mutations occur concurrently, THE RESUME STORE SHALL preserve both unique session records and the newest field values for records with the same identity.

REQ-017 (unwanted): IF a workspace save carries a revision older than the last accepted revision for that project, THEN THE WORKSPACE STORE SHALL reject it without replacing the newer persisted state.

REQ-018 (unwanted): IF any persistence operation fails, THEN THE FRONTEND SHALL keep the affected state marked dirty and add a visible diagnostic entry that names the document, project, or settings area that failed.

### Browser runtime and trust boundary

REQ-019 (event-driven): WHEN browser location or loading state changes, THE BROWSER BRIDGE SHALL publish a semantic navigation event without relying on a fixed-interval URL poll.

REQ-020 (unwanted): IF a browser page does not respond to evaluation, THEN THE BROWSER COMMAND SHALL time out asynchronously without blocking a shared asynchronous runtime worker.

REQ-021 (state-driven): WHILE the child webview is open, THE BROWSER BACKEND SHALL accept bridge messages only when they carry the active per-webview secret and an allowed semantic message type.

REQ-022 (ubiquitous): LOADED WEB CONTENT SHALL NOT be able to invoke global metacodex keyboard commands.

REQ-023 (unwanted): IF a browser bridge payload has an unsupported scheme, an unexpected field, or a field that exceeds its documented size limit, THEN THE BROWSER BACKEND SHALL reject the payload without mutating browser history or application state.

REQ-024 (event-driven): WHEN the user sends visual context to an agent, THE FRONTEND SHALL show success only after the selected running CLI session confirms a successful PTY write.

REQ-025 (unwanted): IF visual-context capture or PTY delivery fails, THEN THE FRONTEND SHALL show a localized error, keep the current browser mode, and avoid reporting success.

### CLI launch and discovery

REQ-026 (ubiquitous): THE DEFAULT CLI LAUNCH POLICY SHALL omit permission bypass and unconditional approval flags.

REQ-027 (event-driven): WHEN the user requests an elevated CLI launch, THE FRONTEND SHALL display the exact elevated flags and require explicit confirmation for that launch.

REQ-028 (ubiquitous): THE LAUNCHER, PROJECT EMPTY STATE, SETTINGS, AND MISSING-CLI SURFACES SHALL derive visibility and capability state from one canonical CLI registry contract.

REQ-029 (event-driven): WHEN multiple consumers request discovery for the same CLI, THE CLI DISCOVERY SERVICE SHALL share one in-flight result and complete with `installed`, `missing`, or `failed` within five seconds.

REQ-030 (event-driven): WHEN an installed CLI is launched, THE PTY SPAWN PATH SHALL use the executable path and required environment resolved by the successful discovery result.

### Agent experience and recovery

REQ-031 (state-driven): WHILE project and home-directory hydration is incomplete, THE FRONTEND SHALL disable commands that require an active project or operational working directory.

REQ-032 (unwanted): IF bootstrap hydration fails, THEN THE FRONTEND SHALL render a recoverable bootstrap error and SHALL NOT use `/` as a silent operational working directory.

REQ-033 (event-driven): WHEN agent attention state changes, THE ATTENTION COORDINATOR SHALL record the tab ID, project key, agent status, active tab state, document visibility, and real application-window focus.

REQ-034 (event-driven): WHEN the user invokes the next-attention command, THE FRONTEND SHALL select the next waiting agent globally, switch to its project, activate its tab, and focus the center terminal.

REQ-035 (event-driven): WHEN a running CLI exposes a provider session ID, THE LIVE SESSION REGISTRY SHALL attach that identity to the owning tab and mark the matching resume record as currently live.

REQ-036 (unwanted): IF a resume record is already live in any tab, THEN THE FRONTEND SHALL prevent a second resume launch and focus the existing tab instead.

REQ-037 (ubiquitous): THE KEYBINDING REGISTRY SHALL expose only commands with functional handlers and SHALL NOT keep a no-op rename command.

REQ-038 (unwanted): IF backend project removal fails, THEN THE FRONTEND SHALL preserve or restore the project's tabs, session ownership, caches, watcher intent, and active-project selection.

### Scale, metadata, and rendering

REQ-039 (event-driven): WHEN an agent status update repeats the existing status without new semantic information, THE AGENT STATUS STORE SHALL preserve its existing state object and timestamp.

REQ-040 (optional): WHERE the keep-mounted renderer model fails NFR-004, THE FRONTEND SHALL allow an invisible terminal renderer to detach without stopping the PTY or losing the retained terminal transcript required for restoration.

REQ-041 (event-driven): WHEN the set of active projects or running sessions changes, THE FILESYSTEM SYNC LAYER SHALL watch exactly the active project plus projects that own running sessions.

REQ-042 (event-driven): WHEN a previously unwatched project becomes active, THE FILESYSTEM SYNC LAYER SHALL perform a complete explorer and Git revalidation before treating cached state as current.

REQ-043 (event-driven): WHEN multiple Git refresh requests target the same project, THE GIT STORE SHALL coalesce overlapping work and SHALL NOT allow an older response to replace a newer result.

REQ-044 (state-driven): WHILE terminal metadata collection is running, THE METADATA POLLER SHALL keep at most one polling cycle in flight and schedule the next cycle only after the current cycle completes.

REQ-045 (event-driven): WHEN listening ports are collected for a PTY session, THE METADATA SERVICE SHALL attribute only ports owned by the session process tree and SHALL return an explicit unavailable status on unsupported platforms.

### Verification, release, localization, and accessibility

REQ-046 (event-driven): WHEN code is pushed or a pull request is opened, CI SHALL run the frozen dependency install, frontend tests, TypeScript production build, Rust format check, Clippy with warnings denied, Rust tests, dependency audit, and IPC-event parity check.

REQ-047 (state-driven): WHILE any required CI gate is failing, THE RELEASE WORKFLOW SHALL NOT publish an artifact or GitHub release.

REQ-048 (ubiquitous): THE FRONTEND TEST CONFIGURATION SHALL execute both `.test.ts` and `.test.tsx` files with the environment required by each test group.

REQ-049 (ubiquitous): THE IPC AND EVENT CONTRACT CHECK SHALL fail when a Rust command or event has no matching TypeScript constant, or when a TypeScript constant has no Rust implementation.

REQ-050 (ubiquitous): EVERY NEW OR CHANGED USER-FACING STRING SHALL exist in both English and Brazilian Portuguese locale files.

REQ-051 (optional): WHERE the user enables terminal screen-reader support, THE TERMINAL SHALL enable xterm screen-reader mode for existing and future terminal instances.

REQ-052 (unwanted): IF a direct production dependency has an unresolved high or critical advisory, THEN CI SHALL fail with the package name, installed version, advisory identifier, and patched version.

## Non-functional requirements

NFR-001 (ubiquitous): THE PTY EVENT PROTOCOL SHALL complete 10,000 deterministic start, immediate-stop, fast-exit, and initial-output iterations in tests without a lost event, duplicate event, or remaining session.

NFR-002 (ubiquitous): THE PTY SUPERVISOR SHALL complete a normal local stop within three seconds and SHALL report the resource that exceeded the bound when it cannot.

NFR-003 (ubiquitous): THE QUIT COORDINATOR SHALL never convert a failed or timed-out save into an automatic successful exit.

NFR-004 (ubiquitous): WITH 12 concurrent agent sessions producing controlled output, THE FRONTEND SHALL keep terminal keystroke-to-write dispatch below 50 milliseconds at p95 and attention-state propagation below 250 milliseconds at p95 on the documented reference machine.

NFR-005 (ubiquitous): NO TAURI ASYNC COMMAND SHALL perform a blocking wait longer than 100 milliseconds on an asynchronous runtime worker.

NFR-006 (ubiquitous): THE BROWSER BRIDGE SECRET SHALL contain at least 128 bits of cryptographically secure randomness and SHALL be replaced whenever the child webview is recreated.

NFR-007 (ubiquitous): PERSISTED WORKSPACE AND RESUME SCHEMA CHANGES SHALL read existing files that do not contain revision or live-session fields.

NFR-008 (ubiquitous): THIS HARDENING WORK SHALL preserve the existing project-root path sandbox, grant boundaries, atomic file replacement, PTY chunk no-drop policy, xterm addon order, hidden-terminal fit guard, and frontend i18n rules.

NFR-009 (ubiquitous): CI SHALL verify supported behavior on macOS, Windows, and Linux for every platform-specific module changed by this project.

NFR-010 (ubiquitous): THE IMPLEMENTATION SHALL introduce no file larger than 1,000 lines and SHALL separate lifecycle supervision from UI rendering and persistence mutation.

## Analyze notes

1. No binding requirement contradicts another requirement.
2. REQ-004 and REQ-006 intentionally require both pre-start attachment and replay. Pre-start attachment prevents the normal startup race. Replay protects reconnection and any event that was retained before attachment acknowledgement.
3. REQ-015 intentionally favors data safety over unconditional fast exit. Force quit remains available only through an explicit user action after the failure is visible.
4. REQ-040 does not permit PTY shutdown for hidden tabs. It separates the long-lived session and transcript from the expensive DOM and canvas renderer.
5. REQ-045 does not require fake port support on a platform where exact ownership cannot be established. It requires an explicit unavailable result instead of incorrect data.
6. The five-second discovery and quit bounds, the three-second PTY stop bound, and the performance thresholds are concrete acceptance bounds. An implementation agent must not silently weaken them.
7. All known failure paths have an observable response. No requirement depends only on console output.
