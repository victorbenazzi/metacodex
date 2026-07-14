# Animation improvement plans

Baseline commit: `3cda0a8`.

| Plan | Title | Severity | Status | Depends on |
|---|---|---|---|---|
| 001 | Make keyboard surfaces instant | HIGH | TODO | None |
| 002 | Move drag tracking to the compositor | HIGH | TODO | 006 |
| 003 | Stop animating workspace layout | HIGH | TODO | 006 |
| 004 | Remove operational row entrances | HIGH | TODO | None |
| 005 | Share tooltip timing | MEDIUM | TODO | None |
| 006 | Unify motion tokens and progress | MEDIUM | TODO | None |
| 007 | Make control feedback minimal and bounded | MEDIUM | TODO | 006 |
| 008 | Preserve information under reduced motion | MEDIUM | TODO | 003, 006, 007 |
| 009 | Add interruptible toast motion | MEDIUM | TODO | 006, 008 |
| 010 | Run the final motion review | HIGH | TODO | 001 through 009 |

## Recommended execution order

1. Plan 006 establishes the shared curves.
2. Plans 001, 003, 004, and 005 remove high-frequency or layout-bound motion.
3. Plan 002 repairs the shared drag path and adds reorder continuity.
4. Plan 007 normalizes control feedback.
5. Plan 008 completes accessibility and recent-state behavior.
6. Plan 009 adds the missing toast motion.
7. Plan 010 reviews and validates the complete diff.

## Scope rule

These plans change motion only. They do not authorize visual redesign, new dependencies, unrelated refactors, publishing, or push.
