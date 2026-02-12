# INIT-023 Plan - LumenFlow Cloud Branch-PR Lifecycle Completion

Created: 2026-02-12

## Goal

Enable complete cloud/branch-pr lifecycle support in LumenFlow so cloud agents can execute:
- `wu:create --cloud`
- `wu:claim --cloud`
- `wu:prep`
- `wu:done`
- `wu:cleanup`

All from feature branches with PR-based completion, while preserving existing local worktree behavior.

## Scope

In scope:
- Cloud-compatible lifecycle for `wu:create`, `wu:claim`, `wu:prep`, `wu:done`, and `wu:cleanup`.
- Branch-pr metadata and branch resolution hardening (`claimed_branch` and resolver precedence).
- Branch-pr support for state commands (`wu:edit`, `wu:block`, `wu:unblock`, `wu:release`, `wu:delete`).
- Cloud-aware recovery/admin paths (`wu:recover`, `wu:repair`).
- Documentation and controlled auto-detect rollout.

Out of scope:
- Product/UI features unrelated to LumenFlow workflow runtime.
- Broad redesign of local worktree lifecycle semantics.

## Approach

<!-- How will you achieve the goal? Key phases or milestones? -->

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-023
- Created: 2026-02-12
