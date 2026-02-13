# INIT-026 Plan - Atomic wu:done - eliminate dirty-main bug class

Created: 2026-02-13

## Goal

Eliminate the dirty-main failure class in `wu:done` by replacing live-main merge/push with atomic temp-worktree merge semantics. The completion path must either fully succeed or fail with `main` left untouched, including both worktree mode and branch-only non-PR mode.

## Scope

<!-- What is in scope and out of scope? -->

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
