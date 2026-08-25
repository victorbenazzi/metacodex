# Qualification: Agent Runtime Reliability Hardening

Qualified locally on 2026-08-20 in `/Users/victor/Documents/metacodex`.

## Verdict

The macOS local qualification passes every mapped MUST requirement and every entered SHOULD requirement. No P1 from the original audit remains reproducible through the new regression tests. Release publication remains subject to the first successful macOS, Windows, and Linux quality workflow run. No push, pull request, tag, release, or deployment was performed.

## Reference environment

1. Branch: `wip/v3-shell`.
2. HEAD: `78219d54ea9b42679acc95279fa63f7ae4617f07`.
3. Host: Apple M1, arm64.
4. macOS: 26.5.1.
5. Node.js: 26.7.0.
6. pnpm: 11.17.0.
7. Rust and Cargo: 1.97.1.
8. Rust host target: `aarch64-apple-darwin`.

## Final automated gates

| Command | Result |
|---|---|
| `pnpm test` | PASS, 45 files and 116 tests |
| `pnpm build` | PASS, TypeScript and Vite production build |
| `pnpm run check:traceability` | PASS, 62 requirements, 62 verdicts, 62 mapped tests |
| `pnpm audit --prod --audit-level high` | PASS, no known vulnerability |
| `cargo test --all-targets` | PASS, 53 library tests and 0 binary tests |
| `cargo check --all-targets` | PASS |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `cargo fmt --all -- --check` | PASS |
| `git diff --check` | PASS |

The frontend suite includes the workflow shape, IPC and event parity, locale parity, source structure limits, bootstrap, attention, browser trust boundary, quit, persistence, project removal, CLI discovery and consent, PTY lifecycle, metadata, watcher, Git ordering, accessibility, performance, and stress tests.

## Reliability profiles

### PTY lifecycle

`pnpm exec vitest run src/features/terminal/ptyReliabilityStress.test.ts` completed 10,000 deterministic lifecycle iterations. The profile cycles normal startup, immediate stop during preparation, fast exit before start returns, and initial output delivery. It verified 10,000 unique preparations, 10,000 unique kills, 7,500 attached initial outputs, 2,500 fast exits, no remaining listeners, no terminal-store residue, and no owned session after completion.

The frontend stress profile is complemented by Rust tests for attach before child start, monotonically sequenced events, replay retention, persistent reader failure, one final exit, no data after exit, bounded stop reporting, and complete ownership eviction.

### Twelve concurrent agents

`pnpm exec vitest run src/features/terminal/agentPerformance.test.ts --reporter=verbose` started 12 sessions through the production session controller, delivered 1,200 controlled output events, and dispatched 1,200 input events.

1. Input dispatch p95: 0.004417 ms, budget below 50 ms.
2. Attention propagation p95: 0.001500 ms, budget below 250 ms.
3. Duplicate status mutations: 12 initial mutations and zero additional mutations for 1,200 semantic duplicates.
4. Final owned sessions after cleanup: zero.

The keep-mounted terminal model remains enabled because this deterministic hot-path profile passed. Renderer detachment was not introduced.

## Isolated desktop smoke

The native app was started with an isolated temporary state root at `/tmp/metacodex-reliability-smoke.4guP2s` through `METACODEX_HOME`. Vite became ready, the Rust application compiled, `target/debug/metacodex` launched, and the process stayed stable for the observation period without an application error. All exact smoke processes were then terminated, the isolated state directory was deleted, port 1420 was released, and no `metacodex` application process remained.

Normal terminal startup, fast exit, typed startup failure with retry, cross-project attention, browser navigation, failed and successful visual delivery, successful quit, blocked quit, persistence retry, and restoration are exercised by automated component, controller, and Rust tests. The elevated launch verification opens the confirmation UI, checks the exact flags and project path, cancels without launch, and confirms that only an explicitly elevated tab receives elevated arguments. No real elevated agent was started.

## Original P1 findings

1. Immediate start and stop race: replaced by a revisioned single-owner session actor and 10,000-iteration stress coverage.
2. PTY attach race and fast exit loss: replaced by prepare, attach, start, replay, and global sequenced event delivery.
3. Reader-error lost wakeup: replaced by persistent supervisor state and a single exit owner.
4. Fixed 300 ms quit delay: replaced by tokenized flush acknowledgement, bounded cleanup, blocked UI, retry, and explicit force quit.
5. Browser URL polling and blocking evaluation: replaced by semantic navigation events and bounded asynchronous evaluation.
6. CLI discovery hangs and duplication: replaced by shared bounded discovery and launch using the resolved executable contract.
7. Watchers and Git work scaling without ownership: scoped to active and live-session projects, with coalesced Git revisions.
8. Missing CI and release gates: reusable quality workflow added, release publication depends on it.

## Resource and scope checks

1. No app process listens on port 1420 after qualification.
2. No isolated smoke directory remains under `/tmp`.
3. No test clone or temporary project owned by this qualification remains.
4. No removed Agent view, cron, MCP registry, agent entity, opencode sidecar, remote SSH project, or SSH trust flow was restored.
5. Project-root validation, grants, atomic writes, PTY no-drop transport, xterm addon order, hidden fit guard, and i18n parity remain covered.
6. No Git publication action occurred.

## Worktree ownership

The baseline already contained 90 tracked dirty files and a large untracked v3 shell and browser implementation. Those changes remain user-owned. The qualification did not reset or discard them. Because the reliability work intentionally overlaps several of those files, an isolated local commit cannot be created safely from the current mixed worktree without first separating the pre-existing redesign. No commit was created.

## Remaining limitations

1. The twelve-session performance gate uses the production controller and state paths with bounded in-process PTY and terminal adapters. It does not measure GPU paint, operating-system scheduler contention, or twelve real AI child processes.
2. Native smoke was performed on macOS. Windows and Linux are enforced by the new CI matrix but were not executable locally. A macOS-hosted Windows cross-check was attempted and stopped in the `ring` C build because the host has no Windows SDK header `assert.h`; it produced no Rust code diagnostic.
3. Vite still reports a large main chunk warning. The build succeeds, and bundle splitting was outside this reliability scope.
4. The first remote quality workflow run is still required before any release can be considered cross-platform qualified.
