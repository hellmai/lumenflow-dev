# INIT-026 Plan - Atomic wu:done - eliminate dirty-main bug class

Created: 2026-02-13

## Goal

Eliminate the dirty-main failure class in `wu:done` by replacing live-main merge/push with atomic temp-worktree merge semantics. The completion path must either fully succeed or fail with `main` left untouched, including both worktree mode and branch-only non-PR mode.

## Scope

In scope:

- Introduce `withAtomicMerge()` in core and integrate it into both live-main merge paths.
- Extract shared micro-worktree helper surface for stable reuse.
- Add failure-injection, retry-exhaustion, idempotent rerun, and branch-only non-PR integration coverage.
- Remove obsolete dirty-main rollback/post-merge remediation code after burn-in.

Out of scope:

- Event-merge simplification in `wu-done-concurrent-merge.ts`.
- Changes to `wu:prep`, global gates, or PR-mode behavior.

## Approach

<!-- How will you achieve the goal? Key phases or milestones? -->

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-026
- Created: 2026-02-13
