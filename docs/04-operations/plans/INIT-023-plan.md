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

Pattern B (Layer Split) in four dependent WUs:

1. WU-1589 (Foundation)
- Add `claimed_branch` schema support.
- Update shared `defaultBranchFrom()` resolver to prefer `claimed_branch`.
- Allow `claimed_mode: branch-pr` in pre-commit lane-branch checks.
- Ensure rollback/release/recover clear both `claimed_mode` and `claimed_branch`.

2. WU-1590 (Critical lifecycle)
- Add `wu:create --cloud` path (branch-local writes, no main ensure).
- Update `wu:claim --cloud` branch handling and conflict policy.
- Fix `wu:prep`/`wu:done` branch-pr branch resolution and `code_paths` target (`HEAD`).
- Fix `wu:cleanup` branch resolution, PR verification target, and non-lane branch deletion rules.

3. WU-1591 (State commands)
- Add branch-pr cloud paths for `wu:edit`, `wu:block`, `wu:unblock`, `wu:release`, `wu:delete`.

4. WU-1592 (Recovery + docs + rollout)
- Add branch-pr paths for `wu:recover` and `wu:repair`.
- Update AGENTS/LUMENFLOW docs.
- Enable cloud auto-detect only after lifecycle stabilization.

## Success Criteria

- End-to-end cloud branch-pr flow succeeds on feature branches with PR completion:
  `wu:create --cloud` -> `wu:claim --cloud` -> `wu:prep` -> `wu:done` -> `wu:cleanup`.
- No required direct main-checkout mutation path for cloud execution modes.
- Existing local worktree lifecycle remains behaviorally unchanged when cloud mode is not active.

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-023
- Created: 2026-02-12
