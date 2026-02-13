# INIT-025 Plan - God File Decomposition Initiative

Created: 2026-02-12

## Goal

Decompose the 10 largest god files (1400-4100 lines each) into focused modules under 800 lines, with architectural restructuring where needed (not just mechanical splits). Priority target: the wu:done pipeline (3090+1568 lines across orchestrator and worktree module), which has accumulated 100+ patch references and 4 emergency fixes, causing ongoing stability churn.

## Scope

**In scope:**

- wu:done pipeline: introduce explicit state machine, consolidate 4 rollback mechanisms to 1, eliminate duplicate gate runs by design
- Top 10 god files by size: mcp/tools.ts (4081), cli/init.ts (3936), cli/wu-done.ts (3090), cli/wu-claim.ts (2288), core/wu-spawn.ts (2135), cli/gates.ts (1896), cli/wu-spawn.ts (1836), core/wu-done-worktree.ts (1568), core/lumenflow-config-schema.ts (1463), cli/wu-edit.ts (1456)
- Test coverage for decomposed modules (target: 80%+ on new modules)

**Out of scope:**

- Behavioral changes to wu:done's public API or workflow semantics
- Changing the worktree-based completion model
- Files already well-covered: lumenflow-config-schema.ts (91%), lane-checker.ts (85%), wu-state-store.ts (107%), gates-config.ts (102%)

## Approach

<!-- How will you achieve the goal? Key phases or milestones? -->

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-025
- Created: 2026-02-12
