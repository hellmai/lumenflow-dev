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

Execution strategy (no feature flag, direct replacement):

1. WU-1626 (Phase 1A): Extract `micro-worktree-shared.ts` and re-export helpers from `micro-worktree.ts` with no behavior change.
2. WU-1627 (Phase 1B core): Implement `withAtomicMerge()` in `packages/@lumenflow/core/src/atomic-merge.ts` with bounded merge/push retry and deterministic cleanup.
3. WU-1628 (Phase 1B worktree): Replace worktree-mode merge/push block in `wu-done-worktree.ts` with `withAtomicMerge({ id, laneBranch })`.
4. WU-1629 (Phase 3 branch-only): Replace non-PR branch-only live-main flow in `wu-done-branch-only.ts` with `withAtomicMerge(..., afterMerge)` and add idempotent rerun coverage.
5. Burn-in period: complete real WUs through new path and monitor failure signatures.
6. WU-1630 (Phase 4 cleanup): Remove obsolete rollback/post-merge dirty-main code in core + CLI once burn-in proves stable.

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-026
- Created: 2026-02-13
