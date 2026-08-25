# 12-session performance decision

## Reference machine

1. CPU: Apple M1, arm64.
2. macOS: 26.5.1.
3. Node.js: 26.7.0.
4. pnpm: 11.17.0.

## Profile

The deterministic Vitest profile starts 12 sessions through the production session controller, delivers 1,200 controlled output events through the production decode and terminal-write path, dispatches 1,200 input events through the production input callback, applies 1,200 duplicate working updates, and propagates 1,200 attention transitions across the same sessions. The PTY adapter and xterm terminal objects are bounded in-process harnesses so the measurement is stable in CI.

## Budgets

1. Input dispatch p95 must remain below 50 ms.
2. Attention propagation p95 must remain below 250 ms.
3. Duplicate working output must produce exactly 12 initial status mutations, one per session.
4. The current model keeps 12 terminal renderers mounted.

## Recorded result

Run on 2026-08-20 with `pnpm exec vitest run src/features/terminal/agentPerformance.test.ts --reporter=verbose`:

1. Running sessions: 12.
2. Controlled output events: 1,200.
3. Input events: 1,200.
4. Input dispatch p95: 0.004417 ms.
5. Attention propagation p95: 0.001500 ms.
6. Duplicate working mutations: 12 initial mutations, with no mutation for the 1,200 semantic duplicates.

## Decision

The keep-mounted renderer model passes the deterministic latency and mutation budgets on the reference development machine. Renderer detachment is not enabled. This avoids transcript restoration risk for alternate-screen applications, Unicode output, scrollback, resize, and theme changes.

The benchmark is a stable hot-path regression gate. It does not measure OS scheduling, process startup, GPU paint, or a real child process. Those boundaries are covered separately by the isolated desktop smoke profile and the Rust PTY protocol tests in Task 21.
