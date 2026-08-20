# Tasks: Agent Runtime Reliability Hardening

> This file is the execution contract for an AI coding agent. Complete exactly one task at a time. A task is complete only when every acceptance item and every named test for that task passes.

## 0. Execution protocol

1. Start each task by reading `AGENTS.md`, `requirements.md`, `design.md`, and the complete active task.
2. Run `git status --short` before editing. Treat every existing change as user-owned.
3. Inspect the current diff for every file named by the task before editing it.
4. Write or enable the named failing test before changing production behavior for every MUST requirement.
5. Make the smallest implementation that satisfies the active task. Do not begin the next task early.
6. Run the task-specific tests first. Run the broader frontend or Rust gate named by the task second.
7. Inspect the final diff for every touched file. Remove debug output, accidental formatting, dead compatibility code, and unrelated changes.
8. Mark acceptance boxes complete only after commands pass. Do not mark a task complete based on inspection alone.
9. If a required file outside the task list must change, stop and amend this plan before editing.
10. If an existing user change conflicts with the task, stop and report the exact file, lines, and conflict. Do not reset or overwrite it.
11. Never weaken tests, path validation, grants, i18n, xterm load order, atomic writes, PTY no-drop behavior, or Tauri capabilities.
12. Never push, publish, create a pull request, merge, tag, or deploy.

## A. Test triage

Every item below records the required test verdict. `MUST` means the task cannot complete without the named automated proof. `SHOULD` means the test is required when the optional implementation gate is entered. There are no SKIP verdicts for behavior that can fail silently.

1. REQ-001: MUST. Cross-async ownership can fail silently and create duplicate sessions.
2. REQ-002: MUST. This is the reproduced immediate-stop race and can leave an orphan process.
3. REQ-003: MUST. Reordered lifecycle intent is a regression-prone state transition.
4. REQ-004: MUST. Attachment before child start is the core lost-output invariant.
5. REQ-005: MUST. Sequence monotonicity protects replay and deduplication correctness.
6. REQ-006: MUST. Replay can silently lose or duplicate terminal state.
7. REQ-007: MUST. Fast exit is a known lost-event edge case.
8. REQ-008: MUST. Reader failure can create a zombie session.
9. REQ-009: MUST. Data after exit violates terminal ordering and can corrupt UI state.
10. REQ-010: MUST. Startup failure currently becomes a blank primary-product surface.
11. REQ-011: MUST. Repeated close events currently can create overlapping cleanup work.
12. REQ-012: MUST. New process creation during shutdown can produce surviving resources.
13. REQ-013: MUST. The flush set spans several independent persistence owners.
14. REQ-014: MUST. Process and watcher cleanup must complete before successful exit.
15. REQ-015: MUST. Timeout behavior guards user data and must not silently exit.
16. REQ-016: MUST. Concurrent resume mutation can lose durable records.
17. REQ-017: MUST. Stale workspace writes can replace newer user state.
18. REQ-018: MUST. Persistence failure must remain visible and retryable.
19. REQ-019: MUST. Navigation events replace a performance-sensitive polling loop.
20. REQ-020: MUST. Blocking browser evaluation can saturate the runtime.
21. REQ-021: MUST. This is a web-content trust boundary.
22. REQ-022: MUST. Loaded content must have no global command authority.
23. REQ-023: MUST. Malformed or oversized untrusted input requires rejection tests.
24. REQ-024: MUST. Success must represent a completed PTY write.
25. REQ-025: MUST. Delivery failure currently reports false success.
26. REQ-026: MUST. Safe launch is a security and data-integrity invariant.
27. REQ-027: MUST. Elevated consent is a user authorization boundary.
28. REQ-028: MUST. Multiple surfaces currently disagree on CLI capability.
29. REQ-029: MUST. Discovery can hang, duplicate workers, and misclassify failure.
30. REQ-030: MUST. Detection and launch currently use different executable contracts.
31. REQ-031: MUST. Early shortcuts can create hidden sessions in the wrong bucket.
32. REQ-032: MUST. Silent `/` fallback is unsafe and user-visible.
33. REQ-033: MUST. Attention depends on cross-store and real-window state.
34. REQ-034: MUST. Cross-project navigation is the recovery action for blocked agents.
35. REQ-035: MUST. Live session identity prevents duplicate provider clients.
36. REQ-036: MUST. Concurrent resume of a live session is a costly edge case.
37. REQ-037: MUST. A registered no-op command is a user-visible contract failure.
38. REQ-038: MUST. Partial project removal destroys live state on backend failure.
39. REQ-039: MUST. Repeated hot-path mutation causes global rerender pressure.
40. REQ-040: SHOULD. Execute only if the benchmark fails NFR-004, then restoration proof becomes mandatory.
41. REQ-041: MUST. Watcher ownership must track live resource scope exactly.
42. REQ-042: MUST. Re-entering an unwatched project must invalidate stale caches.
43. REQ-043: MUST. Out-of-order Git responses can replace newer status.
44. REQ-044: MUST. Overlapping metadata cycles can accumulate blocking work.
45. REQ-045: MUST. Incorrect port ownership can open an unrelated service.
46. REQ-046: MUST. CI is the enforcement mechanism for every other regression test.
47. REQ-047: MUST. Release must not bypass failed quality gates.
48. REQ-048: MUST. The current test glob excludes component tests.
49. REQ-049: MUST. Command and event drift fails silently at runtime.
50. REQ-050: MUST. Locale parity is a repository-wide product contract.
51. REQ-051: MUST. Screen-reader behavior is configuration-dependent and runtime-visible.
52. REQ-052: MUST. High and critical direct advisories require an enforceable gate.
53. NFR-001: MUST. The repeated deterministic stress proof defines PTY reliability.
54. NFR-002: MUST. Stop latency and residual resource ownership are observable.
55. NFR-003: MUST. Failed saves must never be translated into successful quit.
56. NFR-004: MUST. Performance claims require measurements under 12 sessions.
57. NFR-005: MUST. Blocking runtime work requires a mechanical regression test or static boundary test.
58. NFR-006: MUST. Token entropy and rotation are security invariants.
59. NFR-007: MUST. Existing persisted files require backward-compatibility fixtures.
60. NFR-008: MUST. Load-bearing path, xterm, and PTY behavior need characterization or existing regression suites.
61. NFR-009: MUST. Platform-specific behavior requires platform CI jobs.
62. NFR-010: MUST. File-size and ownership boundaries require an automated structure check plus review.

## B. Traceability map

1. REQ-001: `sessionController.test.ts > assigns one owner and revision to one start intent`.
2. REQ-002: `sessionController.test.ts > immediate stop leaves no prepared or running session`.
3. REQ-003: `sessionController.test.ts > final start wins after start stop start`.
4. REQ-004: `pty_protocol.rs > child does not start before attach`.
5. REQ-005: `pty_event_journal.rs > assigns strictly increasing sequence numbers`.
6. REQ-006: `ptyEventMultiplexer.test.ts > merges replay and live events once in sequence`.
7. REQ-007: `pty_protocol.rs > delivers exit when child exits before start returns`.
8. REQ-008: `pty_supervisor.rs > reader error persists until waiter observes it`.
9. REQ-009: `pty_supervisor.rs > emits no data after final exit envelope`.
10. REQ-010: `TerminalTab.test.tsx > renders phase error and retries startup` and `sessionController.test.ts > reports listener and spawn failures`.
11. REQ-011: `quit_coordinator.rs > repeated close requests create one quit token`.
12. REQ-012: `runtime_supervisor.rs > rejects PTY and clone starts while quiescing`.
13. REQ-013: `quitCoordinator.test.ts > flushes every durable owner before acknowledgement`.
14. REQ-014: `quit_coordinator.rs > successful acknowledgement waits for all resource owners`.
15. REQ-015: `QuitBlockedDialog.test.tsx > timeout keeps app open and offers retry and force quit`.
16. REQ-016: `resume_store.rs > concurrent unique saves preserve both records` and `resume_store.rs > same identity keeps newest fields`.
17. REQ-017: `workspace_store.rs > stale revision cannot replace newer state`.
18. REQ-018: `useWorkspacePersistence.test.ts > failed save stays dirty and records diagnostics`.
19. REQ-019: `browserBridge.test.ts > history and load publish semantic navigation without polling`.
20. REQ-020: `browser.rs > unresponsive evaluation times out without blocking executor progress`.
21. REQ-021: `browser.rs > rejects missing stale and incorrect bridge tokens`.
22. REQ-022: `KeyboardShortcuts.test.tsx > browser content cannot dispatch a global command`.
23. REQ-023: `browser.rs > rejects invalid scheme unknown fields and oversized payloads`.
24. REQ-024: `sendToAgent.test.ts > reports sent only after PTY write resolves`.
25. REQ-025: `BrowserPanel.test.tsx > write failure shows error and preserves browser mode`.
26. REQ-026: `cli-registry.test.ts > default launch strings contain no bypass flags`.
27. REQ-027: `ElevatedLaunchDialog.test.tsx > requires explicit confirmation for exact elevated flags`.
28. REQ-028: `cliCapabilities.test.ts > every CLI surface derives the same availability`.
29. REQ-029: `cli-detection.test.ts > shares one request and distinguishes timeout failure from missing`.
30. REQ-030: `cli.rs > resolved executable and environment are used by launch`.
31. REQ-031: `bootstrapCommands.test.ts > blocks terminal and agent commands until ready`.
32. REQ-032: `App.test.tsx > hydration failure renders retry and never uses root cwd`.
33. REQ-033: `attentionCoordinator.test.ts > combines project tab visibility and real window focus`.
34. REQ-034: `attentionCoordinator.test.ts > next attention switches project activates tab and focuses center`.
35. REQ-035: `useSessionCapture.test.ts > attaches provider identity to the live tab`.
36. REQ-036: `resumeLaunch.test.ts > live resume focuses existing tab without spawning`.
37. REQ-037: `keybindings.test.ts > every registered command has a functional dispatcher`.
38. REQ-038: `project.store.test.ts > backend removal failure preserves frontend resources` and `projects.rs > persistence failure changes no resource ownership`.
39. REQ-039: `agent-status.store.test.ts > duplicate semantic status preserves object and changedAt`.
40. REQ-040: `terminalRendererLifecycle.test.tsx > detached renderer restores shell and alternate-screen transcript` when the optional gate is entered.
41. REQ-041: `useFilesystemSync.test.ts > watches active project plus projects with running sessions`.
42. REQ-042: `useFilesystemSync.test.ts > activation after unwatch performs full revalidation`.
43. REQ-043: `git.store.test.ts > coalesces overlap and ignores stale result`.
44. REQ-044: `useTabMetadataPolling.test.ts > never overlaps cycles and schedules after completion`.
45. REQ-045: `process_tree_ports.rs > attributes only descendant listeners` and platform-specific variants.
46. REQ-046: `qualityWorkflow.test.ts > required push and pull-request gates are present`.
47. REQ-047: `qualityWorkflow.test.ts > every release publish job depends on quality`.
48. REQ-048: `vitestConfig.test.ts > discovers TypeScript and TSX tests with explicit environments`.
49. REQ-049: `ipcParity.test.ts > Rust and TypeScript command and event sets are equal`.
50. REQ-050: `i18nParity.test.ts > English and Brazilian Portuguese keys are equal`.
51. REQ-051: `useXterm.test.ts > screen-reader setting updates existing and future terminals`.
52. REQ-052: `qualityWorkflow.test.ts > production audit fails on high or critical advisory`.
53. NFR-001: `ptyReliabilityStress.test.ts > completes 10000 lifecycle iterations without loss duplicate or residual session`.
54. NFR-002: `pty_supervisor.rs > stop completes inside bound or reports owner timeout`.
55. NFR-003: `quitCoordinator.test.ts > failed flush never acknowledges successful quit`.
56. NFR-004: `agentPerformance.test.ts > 12 sessions stay within input and attention latency budgets`.
57. NFR-005: `browser.rs > slow evaluation does not prevent an independent async task from completing` plus review of async commands.
58. NFR-006: `browser.rs > bridge token has required entropy and rotates on recreation`.
59. NFR-007: `workspace_store.rs > loads revisionless fixture` and `resume_store.rs > loads legacy fixture`.
60. NFR-008: existing `util::paths` tests, new xterm lifecycle characterization, and PTY no-drop stress tests.
61. NFR-009: `qualityWorkflow.test.ts > platform matrix covers macOS Windows and Linux`.
62. NFR-010: `structureLimits.test.ts > no source file exceeds 1000 lines and forbidden ownership imports remain absent`.

## C. Ordered implementation tasks

### Task 0: Freeze the baseline and create an evidence log

Dependencies: none.

Files: `specs/agent-runtime-reliability/baseline.md` only.

Steps:

1. Record branch, HEAD, upstream, `git status --short`, tracked diff summary, and untracked files.
2. Record versions for Node, pnpm, Rust, Cargo, and the active target.
3. Run the current gates without editing production files.
4. Record exact pass or fail output for `pnpm test`, `pnpm build`, `cargo test`, `cargo check --all-targets`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `git diff --check`, and `pnpm audit --prod`.
5. Record the existing browser Clippy failure and existing format failures as baseline. Do not repair them in this task.

Acceptance:

1. [x] The baseline file distinguishes existing failures from failures introduced later.
2. [x] No source or configuration file changed.
3. [x] The implementation agent can name all pre-existing dirty paths before Task 1.

Tests: documentation inspection only. No production behavior changes.

Stop condition: if branch, HEAD, or dirty state differs materially from the audited state and overlaps planned files, stop for human review.

### Task 1: Build the test and quality harness

Dependencies: Task 0.

Files: `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `src/test/setup.ts`, `src/test/jsdomHarness.test.tsx`, `src/test/vitestConfig.test.ts`, `src/test/ipcParity.test.ts`, `src/test/i18nParity.test.ts`, `src/test/structureLimits.test.ts`, `src/test/qualityWorkflow.test.ts`, `scripts/check-spec-traceability.mjs`.

Steps:

1. Add exact `packageManager` metadata matching the chosen pnpm version.
2. Add `jsdom`, React Testing Library, and user-event as development dependencies through pnpm.
3. Configure separate Node and jsdom test projects or file-level environments so pure tests remain fast and `.test.tsx` runs correctly.
4. Add automated Rust and TypeScript IPC-event parity extraction.
5. Add locale key parity validation.
6. Add source file-size and forbidden frontend OS-access checks.
7. Add workflow-shape tests that can inspect CI and release dependencies after those workflows exist.
8. Add a traceability script that reports every MUST or SHOULD requirement missing from Section B.

Acceptance:

1. [x] `.test.ts` and `.test.tsx` files are both discovered.
2. [x] Existing 39 frontend tests still pass.
3. [x] IPC-event parity reports the current 77 commands and 11 events as matched.
4. [x] Locale parity passes before new strings are added.
5. [x] The traceability script reports no missing MUST or SHOULD requirement.
6. [x] No production behavior changed.

Tests: `pnpm test`; `node scripts/check-spec-traceability.mjs specs/agent-runtime-reliability`.

Stop condition: do not continue if the harness requires deleting or renaming existing tests.

### Task 2: Add PTY and xterm characterization seams

Dependencies: Task 1.

Files: `src/features/terminal/sessionController.ts`, `src/features/terminal/sessionController.test.ts`, `src/features/terminal/ptyEvents.ts`, `src/features/terminal/ptyEvents.test.ts`, `src/components/terminal/useXterm.ts`, `src/components/terminal/useXterm.test.ts`, `src-tauri/src/pty/mod.rs` test modules only.

Steps:

1. Expose dependency injection for PTY API, event listener installation, clock, and diagnostics without changing production defaults.
2. Pin normal start, normal stop, current no-drop channel behavior, normal exit, xterm addon order, explicit initial dimensions, first-frame CanvasAddon deferral, hidden fit guard, and theme reapplication.
3. Add desired regression tests for immediate stop, fast exit, listener failure, and reader failure. Confirm these tests fail for the intended reason before production fixes.

Acceptance:

1. [x] Existing normal lifecycle behavior is characterized.
2. [x] Load-bearing xterm behavior is characterized.
3. [x] Known-bug tests fail with clear assertions rather than timeouts.
4. [x] Production output and UI remain unchanged.

Tests: `pnpm test -- sessionController ptyEvents useXterm`; `cargo test pty` from `src-tauri`.

Stop condition: if xterm behavior cannot be tested without a broad component rewrite, keep the seam minimal and defer renderer-specific proof to Task 18.

### Task 3: Replace the frontend generation race with a session actor

Dependencies: Task 2.

Files: `src/features/terminal/sessionController.ts`, `src/features/terminal/sessionController.test.ts`, `src/components/terminal/TerminalTab.tsx` only if the controller API requires adaptation.

Covers: REQ-001, REQ-002, REQ-003, NFR-001 frontend portion.

Steps:

1. Add synchronous desired state and revision capture at every public start and stop call.
2. Remove revision increments that occur after awaiting prior work.
3. Check captured revision and desired state after every await.
4. Guarantee cleanup for obsolete prepared or spawned sessions.
5. Add deterministic tests for start then stop, start then stop then start, StrictMode-like mount cleanup, and spawn failure.

Acceptance:

1. [x] Immediate stop leaves no session ID and calls kill for any late spawn.
2. [x] Final start leaves exactly one session.
3. [x] Repeated stop is idempotent.
4. [x] No test relies on real time or sleep.

Tests: `pnpm test -- sessionController`; `pnpm build`.

Stop condition: do not add another boolean workaround around the existing generation logic. The state ownership model must match `design.md`.

### Task 4: Add the global sequenced PTY event multiplexer

Dependencies: Task 3.

Files: `src/features/terminal/ptyEventMultiplexer.ts`, `src/features/terminal/ptyEventMultiplexer.test.ts`, `src/features/terminal/ptyEvents.ts`, `src/features/terminal/sessionController.ts`, `src/lib/events.ts`.

Covers: REQ-005, REQ-006, REQ-010 frontend listener portion.

Steps:

1. Install each global listener once through an `ensureReady` promise.
2. Route envelopes by session ID.
3. Track last consumed sequence.
4. Merge replay and live buffers in order.
5. Deduplicate old sequence numbers.
6. Detect gaps and request replay through an injected adapter.
7. Make listener installation failure a rejected startup phase.

Acceptance:

1. [x] Live events that arrive during replay are delivered once in sequence.
2. [x] Duplicate envelopes do not reach xterm or stores.
3. [x] A listener installation failure reaches the session actor.
4. [x] Per-tab cleanup does not remove global listeners.

Tests: `pnpm test -- ptyEventMultiplexer sessionController`; `pnpm build`.

Stop condition: do not retain unbounded event history in the frontend.

### Task 5: Extract the Rust PTY supervisor and persistent stop reason

Dependencies: Task 4 types may be stubbed, but production switching waits for Task 6.

Files: `src-tauri/src/pty/mod.rs`, `src-tauri/src/pty/session.rs`, `src-tauri/src/pty/supervisor.rs`, `src-tauri/src/pty/event_journal.rs`, `src-tauri/src/events.rs`, `src-tauri/src/commands/terminal.rs`, Rust tests in those modules.

Covers: REQ-005, REQ-008, REQ-009, NFR-002.

Steps:

1. Move lifecycle state, stop reason, event sequencing, journal, and final exit ownership into dedicated modules.
2. Replace transient reader-error notification with persistent state through a watch channel or equivalent.
3. Coordinate reader stop, drainer completion, exit emission, map eviction, and waiter-handle eviction in the required order.
4. Keep the bounded 4,096-chunk transport and no-drop behavior.
5. Make timeout results explicit. Never log that resources were reaped after a timeout unless they actually completed.

Acceptance:

1. [x] Reader failure before waiter polling still emits one `reader_error` exit.
2. [x] Reader failure between waiter polls still emits one `reader_error` exit.
3. [x] Kill emits one exit and leaves no session or waiter entry.
4. [x] No data sequence follows the exit sequence.
5. [x] Existing Rust PTY tests remain green.

Tests: `cargo test pty`; `cargo check --all-targets`; targeted Rust format check for changed files.

Stop condition: do not change shell launch behavior, environment policy, or process groups in this task.

### Task 6: Implement prepare, attach, start, replay, and migration

Dependencies: Tasks 4 and 5.

Files: `src-tauri/src/pty/mod.rs`, `src-tauri/src/pty/protocol.rs`, `src-tauri/src/pty/supervisor.rs`, `src-tauri/src/pty/event_journal.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/features/terminal/terminal.types.ts`, `src/features/terminal/terminal.service.ts`, `src/features/terminal/ptyEventMultiplexer.ts`, `src/features/terminal/sessionController.ts`, related tests.

Covers: REQ-004, REQ-006, REQ-007, NFR-001.

Steps:

1. Register `pty_prepare`, `pty_attach`, and `pty_start` in Rust and TypeScript.
2. Prepare and validate without starting the child.
3. Require confirmed attach before start.
4. Return retained envelopes after the supplied sequence.
5. Start only after the frontend multiplexer and session consumer are ready.
6. Switch all production terminal, CLI, and resume startup paths.
7. Verify no production caller uses direct `pty_spawn`.
8. Remove the old command only after parity tests and full startup tests pass.

Acceptance:

1. [x] A child cannot emit before attach because it does not exist before attach.
2. [x] Fast output and fast exit are delivered when they occur before `pty_start` returns.
3. [x] Replay reconnects from the last consumed sequence without duplicate output.
4. [x] A canceled prepared session creates no child.
5. [x] Command parity is green after removing compatibility code.

Tests: targeted frontend PTY tests; targeted Rust PTY protocol tests; `pnpm build`; `cargo test`; IPC-event parity.

Stop condition: do not preserve the old direct spawn as a second production path.

### Task 7: Add typed terminal failure and retry UI

Dependencies: Task 6.

Files: `src/features/terminal/sessionController.ts`, `src/features/terminal/terminal.types.ts`, `src/components/terminal/TerminalTab.tsx`, `src/components/terminal/TerminalTab.test.tsx`, `src/components/terminal/CliTabComponent.tsx`, `src/components/terminal/CliTabComponent.test.tsx`, `src/features/diagnostics/diagnostics.store.ts`, `src/components/diagnostics/DiagnosticLogPanel.tsx`, both locale JSON files.

Covers: REQ-010, REQ-018 terminal portion.

Steps:

1. Expose `starting`, `running`, `failed`, and `exited` states from the session actor.
2. Normalize listener, prepare, attach, start, write, resize, and kill failures.
3. Record structured diagnostics.
4. Render phase, error detail, Retry, Copy diagnostics, and Close tab.
5. Retry in the same tab through a new lifecycle revision.

Acceptance:

1. [x] Spawn failure never leaves a blank terminal area.
2. [x] Retry creates at most one new session.
3. [x] Missing CLI and failed detection remain distinct states.
4. [x] English and Brazilian Portuguese copy is complete.

Tests: `pnpm test -- TerminalTab sessionController i18nParity`; `pnpm build`.

Stop condition: console output cannot be the only failure response.

### Task 8: Implement coordinated quiescing and safe quit

Dependencies: Tasks 5 through 7.

Files: `src-tauri/src/runtime_supervisor.rs`, `src-tauri/src/commands/app_lifecycle.rs`, `src-tauri/src/error.rs`, `src-tauri/src/commands/git.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/watcher.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/events.rs`, `src/lib/ipc.ts`, `src/lib/events.ts`, `src/app/AppShell.tsx`, `src/app/hooks/useQuitCoordinator.ts`, `src/app/hooks/useWorkspacePersistence.ts`, `src/features/settings/settings.data.store.ts`, `src/features/resume/resume.store.ts`, `src/features/diagnostics/diagnostics.store.ts`, `src/components/quit/QuitBlockedDialog.tsx`, related tests, both locale files.

Covers: REQ-011 through REQ-015, NFR-003.

Steps:

1. Add single-flight runtime state and quit token.
2. Gate PTY preparation and clone start while quiescing.
3. Emit prepare event with deadline.
4. Gather all frontend flush results and acknowledge once.
5. On success, abort clones, stop PTYs, stop watchers, wait for owners, then exit.
6. On failure or timeout, keep the app open and render Retry plus Force Quit.
7. Make repeated close requests idempotent.

Acceptance:

1. [x] Two close requests produce one active token.
2. [x] A delayed save over five seconds blocks automatic exit.
3. [x] A failed save is visible by area.
4. [x] New PTY and clone requests return `app_quiescing`.
5. [x] Successful quit leaves no tracked child or watcher.

Tests: targeted Rust quit tests; targeted frontend quit tests; `pnpm build`; `cargo test`.

Stop condition: do not replace 300 milliseconds with another fixed sleep.

### Task 9: Serialize resume and workspace persistence

Dependencies: Task 8.

Files: `src-tauri/src/commands/resume.rs`, `src-tauri/src/commands/workspace.rs`, `src-tauri/src/config_paths.rs`, `src-tauri/src/lib.rs`, new persistence store modules, `src/features/projects/workspace.service.ts`, `src/app/hooks/useWorkspacePersistence.ts`, related tests and legacy JSON fixtures.

Covers: REQ-016 through REQ-018, NFR-007.

Steps:

1. Hydrate one managed resume store at startup.
2. Serialize resume mutation and disk persistence.
3. Merge same-identity records by newest mutation revision.
4. Add per-project workspace revisions with legacy revision zero.
5. Reject stale saves without disk mutation.
6. Make quit flush await the latest in-flight save, then save the latest dirty revision.
7. Preserve dirty state and diagnostics on failure.

Acceptance:

1. [x] Concurrent unique resume saves preserve both records.
2. [x] Same-identity saves keep newest metadata.
3. [x] An older workspace response cannot replace newer state.
4. [x] Revisionless existing fixtures load successfully.
5. [x] Atomic replacement remains in use.

Tests: targeted Rust persistence tests; `pnpm test -- useWorkspacePersistence`; `cargo test`; `pnpm build`.

Stop condition: do not add a frontend-only mutex around backend read-modify-write.

### Task 10: Replace browser polling and blocking evaluation

Dependencies: Task 1. May run only after PTY and quit tasks are stable.

Files: `src-tauri/src/commands/browser.rs`, `src-tauri/src/commands/browser_init.js`, `src-tauri/src/events.rs`, `src/lib/events.ts`, `src/components/browser/BrowserPanel.tsx`, browser store and service files, related tests.

Covers: REQ-019, REQ-020, NFR-005.

Steps:

1. Add semantic location snapshots for history, popstate, hashchange, DOM ready, and load.
2. Remove the frontend 500 millisecond polling interval.
3. Replace synchronous receive timeout with async oneshot plus `tokio::time::timeout`.
4. Preserve a one-shot query only for explicit recovery.
5. Confirm browser timeout does not delay an independent async command test.

Acceptance:

1. [x] SPA navigation updates the address bar without polling.
2. [x] Back, forward, hash, and normal load update exactly once per changed snapshot.
3. [x] Unresponsive evaluation times out without blocking executor progress.
4. [x] No fixed URL interval remains.

Tests: browser Rust tests; browser bridge frontend tests; `pnpm build`; `cargo test`.

Stop condition: do not hide polling behind a renamed timer.

### Task 11: Authenticate and narrow the browser bridge

Dependencies: Task 10.

Files: `src-tauri/src/commands/browser.rs`, `src-tauri/src/commands/browser_init.js`, `src/app/KeyboardShortcuts.tsx`, browser feature files, related tests.

Covers: REQ-021 through REQ-023, NFR-006.

Steps:

1. Generate and rotate a cryptographically secure per-webview secret.
2. Keep the token inside an injected closure and Rust state.
3. Replace raw key messages with semantic `escape` from trusted events.
4. Remove child-to-global shortcut dispatch.
5. Validate token, type, mode, URL scheme, known fields, and size bounds.
6. Read URL and title from the bridge closure rather than accepting arbitrary caller claims where possible.

Acceptance:

1. [x] Missing, wrong, and stale tokens are rejected.
2. [x] Script-generated untrusted keyboard events are rejected.
3. [x] Loaded content cannot invoke any global command.
4. [x] Oversized and invalid URL payloads mutate no state.
5. [x] Token rotates when the webview is recreated.

Tests: targeted Rust bridge tests; KeyboardShortcuts and browser bridge component tests; `pnpm build`; `cargo test`.

Stop condition: do not store the bridge token on `window`, DOM attributes, localStorage, or browser history.

### Task 12: Make visual-context delivery truthful

Dependencies: Tasks 6 and 10.

Files: `src/features/browser/sendToAgent.ts`, `src/features/browser/sendToAgent.test.ts`, `src/components/browser/BrowserPanel.tsx`, `src/components/browser/BrowserPanel.test.tsx`, both locale files.

Covers: REQ-024, REQ-025.

Steps:

1. Return a typed asynchronous result.
2. Select the last focused running CLI in the active project.
3. Await the PTY write.
4. Show success and switch mode only after successful write.
5. On failure, retain browser mode and show the exact normalized error.

Acceptance:

1. [x] A rejected PTY write never produces a success toast.
2. [x] A successful write activates the correct tab after confirmation.
3. [x] No running CLI produces a localized no-agent error.

Tests: `pnpm test -- sendToAgent BrowserPanel i18nParity`; `pnpm build`.

Stop condition: do not keep a fire-and-forget write behind an async wrapper.

### Task 13: Implement safe CLI policy and canonical discovery

Dependencies: Tasks 6 and 7.

Files: `src/features/terminal/cli-registry.ts`, `src/features/terminal/cli-detection.ts`, `src/features/terminal/cli.service.ts`, `src/components/terminal/CliTabComponent.tsx`, launcher and Settings CLI surfaces, `src-tauri/src/commands/cli.rs`, PTY shell launch adapters, settings types, related tests, both locale files.

Covers: REQ-026 through REQ-030.

Steps:

1. Split safe and elevated arguments.
2. Move the three current bypass flags into elevated arguments.
3. Add per-launch confirmation that shows exact flags and project.
4. Normalize legacy overrides so known bypass flags become elevated.
5. Make all UI surfaces use one capability selector.
6. Deduplicate discovery by CLI ID.
7. Add five-second timeout, kill, reap, and distinct failed state.
8. Return resolved executable path and required environment.
9. Pass structured executable and args to Rust launch construction.
10. Shell-escape every dynamic token in Rust.

Acceptance:

1. [x] Default Claude, Grok, and Kimi launches contain no bypass flag.
2. [x] Elevated launch requires confirmation every time.
3. [x] Disabled agents remain hidden from all launch surfaces.
4. [x] One CLI produces at most one in-flight discovery.
5. [x] Timeout reports failed, not missing.
6. [x] The launch uses the discovered absolute path.
7. [x] Windows and Unix launch construction tests pass.

Tests: targeted CLI frontend tests; `cargo test cli`; `pnpm build`; `cargo check --all-targets`.

Stop condition: do not persist an always-elevated global preference.

### Task 14: Fix bootstrap, attention, resume identity, and command capability

Dependencies: Tasks 7 and 13.

Files: bootstrap store or hook files, `src/App.tsx`, `src/app/AppShell.tsx`, app command dispatch files, `src/features/terminal/notificationDispatch.ts`, new attention coordinator files, resume capture and launch files, terminal metadata types, keybinding registry, `ProjectEmptyState.tsx`, `RepoRow.tsx`, related tests, both locale files.

Covers: REQ-031 through REQ-037.

Steps:

1. Add explicit loading, ready, and failed bootstrap states.
2. Disable project-dependent commands before ready.
3. Remove root cwd fallback.
4. Track real Tauri window focus in attention state.
5. Implement global oldest-attention navigation across projects.
6. Attach provider session identity to the live tab and session.
7. Focus the live tab instead of resuming a duplicate session.
8. Remove F2 registration or implement functional rename. Prefer removal unless rename is explicitly in scope.
9. Make project empty state consume enabled agents and canonical capability.

Acceptance:

1. [x] Early terminal and agent shortcuts are blocked until ready.
2. [x] Hydration failure has visible retry and no root cwd.
3. [x] Background-window attention notifies correctly.
4. [x] Next attention switches projects and focuses the correct xterm.
5. [x] Live resume rows focus existing tabs without spawning.
6. [x] Every registered command has a functional handler.

Tests: targeted bootstrap, attention, resume, keybinding, and component tests; `pnpm build`.

Stop condition: do not add more cross-store reads inside presentation components. Derive in coordinators or app hooks.

### Task 15: Make project removal transactional

Dependencies: Tasks 5, 8, and 9.

Files: `src-tauri/src/projects.rs`, project command files, watcher and PTY manager project cleanup methods, `src/features/projects/project.store.ts`, related Rust and frontend tests.

Covers: REQ-038.

Steps:

1. Persist the next project registry before publishing live removal.
2. Return failure before changing resources when persistence fails.
3. After committed removal, clean backend watcher and PTY resources by project ID.
4. Return cleanup warnings separately from commit failure.
5. Drop frontend tabs and caches only after committed success.

Acceptance:

1. [x] Backend persistence failure preserves project registry and frontend resources.
2. [x] Committed success removes the project and schedules all owned resource cleanup.
3. [x] Cleanup warnings appear in diagnostics.
4. [x] Active project selection changes only after committed success.

Tests: `cargo test projects`; `pnpm test -- project.store`; `pnpm build`.

Stop condition: do not implement rollback by reconstructing killed PTYs.

### Task 16: Remove status, watcher, and Git hot-path waste

Dependencies: Task 14.

Files: `src/features/terminal/agent-status.store.ts`, `src/features/terminal/agentHeuristic.ts`, `src/features/terminal/projectStatus.ts`, `src/app/hooks/useFilesystemSync.ts`, watcher service adapters, `src/features/git/git.store.ts`, related tests.

Covers: REQ-039, REQ-041 through REQ-043.

Steps:

1. Make repeated semantic status updates idempotent.
2. Preserve `changedAt` unless semantic state changes.
3. Replace one timer per tab with one deadline scheduler.
4. Scope project rollup subscriptions.
5. Derive watcher set from active project plus projects with running sessions.
6. Revalidate explorer and Git after reactivation.
7. Add per-project Git coalescing and response revisions.

Acceptance:

1. [x] Repeated output in `working` produces no store mutation.
2. [x] Unrelated project rows do not rerender in the selector test.
3. [x] Idle background projects are unwatched.
4. [x] Running background projects remain watched.
5. [x] Older Git results cannot replace newer results.

Tests: targeted status, filesystem sync, and Git store tests; `pnpm build`.

Stop condition: do not disable filesystem refresh for projects with live sessions.

### Task 17: Batch metadata and implement exact process-tree ports

Dependencies: Tasks 5 and 16.

Files: `src/features/terminal/useTabMetadataPolling.ts`, terminal metadata store and service files, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/util/process_tree.rs`, Windows process or Job Object helpers, related tests.

Covers: REQ-044, REQ-045.

Steps:

1. Replace interval polling with a cancelable recursive async loop.
2. Collect all running session metadata in one backend batch.
3. Cache branch by cwd and invalidate deliberately.
4. Add process-tree ownership abstraction.
5. Add `-a` and explicit PID parsing to the macOS batch.
6. Include descendants, not only the immediate shell PID.
7. Use Windows Job Object membership for owned PIDs.
8. Return unavailable when Linux cannot prove ownership.

Acceptance:

1. [x] Metadata cycles never overlap.
2. [x] Twelve sessions require one backend metadata request per cycle.
3. [x] A shell without listeners receives no unrelated macOS ports.
4. [x] A descendant server is attributed to its owning session.
5. [x] Unsupported exact ownership renders unavailable, not empty success.

Tests: targeted frontend metadata tests; platform-gated Rust parser and ownership tests; `cargo check --all-targets`; `pnpm build`.

Stop condition: do not claim Linux support by returning an empty list without proof.

### Task 18: Measure 12-agent performance and decide renderer strategy

Dependencies: Tasks 6, 14, 16, and 17.

Files: new reliability stress harness, performance test files, optional renderer lifecycle files only if the measured gate fails, optional xterm serialization dependency and lockfile only if approved by the spike.

Covers: REQ-040, NFR-004.

Steps:

1. Build deterministic 12-session output and input simulation.
2. Measure input dispatch p95, attention propagation p95, status mutations, rendered terminal count, CPU proxy metrics, and retained memory where feasible.
3. Run after hot-path fixes with current keep-mounted rendering.
4. If NFR-004 passes, record the result and do not change renderer lifecycle.
5. If NFR-004 fails, build the isolated serialization and restoration spike.
6. Test shell scrollback, alternate screen, Unicode, resize, theme switch, hidden output, and remount.
7. Ship renderer detachment only if every restoration test passes and performance improves materially.

Acceptance:

1. [x] The benchmark produces deterministic measurements and thresholds.
2. [x] The keep-mounted model has a recorded pass or fail result.
3. [x] Optional renderer code exists only when the benchmark failed and restoration tests passed.
4. [x] No transcript corruption is accepted as a performance tradeoff.

Tests: `pnpm test -- agentPerformance`; optional renderer lifecycle tests; production build.

Stop condition: if the spike corrupts any alternate-screen or Unicode case, remove only the spike changes with a targeted patch and retain mounted renderers.

### Task 19: Add accessibility, localization, and dependency hygiene

Dependencies: Tasks 7, 8, 11, 13, and 14.

Files: settings types and terminal pane, `src/components/terminal/useXterm.ts`, OSC notification localization boundary, both locale JSON files, `package.json`, `pnpm-lock.yaml`, related tests.

Covers: REQ-050 through REQ-052.

Steps:

1. Add the screen-reader mode setting with default false and legacy merge support.
2. Apply the setting to existing and future terminals.
3. Route OSC fallback text through i18n.
4. Run locale parity and repair only missing keys introduced or exposed by this project.
5. Upgrade direct `nanoid` to a patched version through pnpm.
6. Run production dependency audit.

Acceptance:

1. [x] Screen-reader mode updates live terminals.
2. [x] English and Brazilian Portuguese key sets match.
3. [x] No changed user-facing fallback is hardcoded.
4. [x] Production audit has no high or critical direct advisory.
5. [x] Lockfile changes contain only expected dependency resolution updates.

Tests: targeted xterm setting tests; i18n parity; `pnpm audit --prod`; `pnpm test`; `pnpm build`.

Stop condition: do not update unrelated dependency families to obtain a clean audit.

### Task 20: Add CI and make release depend on it

Dependencies: All behavior tasks through Task 19.

Files: `.github/workflows/quality.yml`, `.github/workflows/release.yml`, `package.json`, quality workflow tests, traceability script if adjustments are required.

Covers: REQ-046 through REQ-049, NFR-009, NFR-010.

Steps:

1. Add reusable quality workflow triggers for push, pull request, and `workflow_call`.
2. Add frozen frontend install, audit, tests, traceability, build, parity, and structure checks.
3. Add Rust format, Clippy, check, and test gates.
4. Add macOS, Windows, and Linux platform jobs for platform-specific modules.
5. Add a bounded reliability job for PTY, quit, browser, and process cleanup.
6. Make every release publish job depend on reusable quality success.
7. Remove the hardcoded pnpm major from release or align it exactly with `packageManager`.
8. Repair current Clippy and format failures only in intentionally touched files. If unrelated existing failures remain, stop and report them before declaring the gate complete.

Acceptance:

1. [x] Push and pull request events run every mandatory gate.
2. [x] Release cannot publish when quality fails.
3. [x] The workflow test verifies required commands and dependencies.
4. [x] Platform matrix covers macOS, Windows, and Linux.
5. [x] Local equivalents of all mandatory gates are green.

Tests: `pnpm test -- qualityWorkflow ipcParity structureLimits`; traceability script; all local frontend and Rust gates.

Stop condition: do not mark CI complete if local Clippy, format, tests, build, audit, or traceability remains red.

### Task 21: Final reliability qualification

Dependencies: Tasks 0 through 20.

Files: `specs/agent-runtime-reliability/baseline.md`, `specs/agent-runtime-reliability/qualification.md`, README or architecture documentation only where behavior changed and documentation is now stale.

Steps:

1. Run the full frontend suite, production build, Rust format check, Clippy, Rust tests, dependency audit, traceability, parity, structure limits, and diff check.
2. Run the 10,000-iteration PTY lifecycle test.
3. Run the 12-session performance profile.
4. Run a real isolated-state desktop smoke test with `METACODEX_HOME` set to a temporary directory.
5. Verify safe and elevated launch UI without starting a real elevated agent.
6. Verify normal terminal start, fast child exit, retry after forced spawn failure, cross-project attention, browser navigation, failed visual send, successful quit, blocked quit, and restoration.
7. Compare final results to baseline and list any intentionally changed behavior.
8. Confirm no process, watcher, temporary clone, or test app remains running.
9. Confirm no removed Agent view or SSH code was restored.
10. Confirm no push, publication, release, or deployment occurred.

Acceptance:

1. [x] Every MUST requirement has a passing mapped test.
2. [x] Every entered SHOULD requirement has a passing mapped test.
3. [x] Every local quality gate is green.
4. [x] No P1 finding from the original audit remains reproducible.
5. [x] Qualification records exact commands, results, platform, and remaining limitations.
6. [x] Worktree review shows only intentional implementation and specification changes.

Tests: all commands named by this task. Inspection alone is not sufficient.

Stop condition: if any P1 remains, the project is not qualified for release and the report must say so plainly.

## D. Definition of done

The full hardening project is done only when all of the following are true.

1. Every Task 0 through Task 21 acceptance item is checked with evidence.
2. Every MUST requirement has a passing automated test in the traceability map.
3. The PTY stress test reports no lost event, duplicate event, zombie session, or orphan process.
4. Failed persistence prevents automatic quit and remains recoverable.
5. Loaded browser content cannot invoke a global app command.
6. Default CLI launches contain no approval bypass flag.
7. Twelve controlled sessions meet the documented performance budgets.
8. macOS, Windows, and Linux platform gates pass for affected modules.
9. Frontend tests, build, Rust format, Clippy, Rust tests, dependency audit, parity, traceability, structure limits, and diff check are green.
10. The release workflow depends on the reusable quality workflow.
11. No unrelated user work was overwritten.
12. No code or artifact was pushed or published.
