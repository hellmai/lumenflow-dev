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

### Phase 1: wu:done State Machine (Priority)

**WU A: Define state machine and extract phases**
Extract an explicit state machine from wu-done.ts with named states: `validating -> preparing -> gating -> committing -> merging -> pushing -> cleanup`. Each state has: entry conditions, the work it does, exit conditions, and a single rollback path. Replace the implicit Step 0/0a/0b/0.6/0.75 numbering with typed state transitions. Target: orchestrator under 500 lines delegating to phase modules.

**WU B: Consolidate rollback to single transaction manager**
Replace the 4 current rollback mechanisms (transaction abort, file snapshot, branch rollback, zombie recovery) with one TransactionManager that tracks what was modified and can undo it. Zombie states become impossible because the state machine prevents partial completion.

**WU C: Single-pass gates by design**
Gates run exactly once, in the `gating` state. wu:prep records a gates-passed stamp with commit SHA. wu:done validates the stamp matches HEAD and skips re-running gates. No more duplicate full-suite execution.

### Phase 2: Mechanical Splits (Remaining God Files)

Split the remaining god files (mcp/tools.ts, cli/init.ts, cli/wu-claim.ts, core/wu-spawn.ts, cli/gates.ts, cli/wu-edit.ts) into focused modules using barrel re-exports for backward compatibility. These are mechanical splits -- no architectural changes, just file size reduction. One WU per file, thin barrel preserves existing imports.

### Phase 3: Test Coverage + Cleanup

Bring test coverage to 80%+ on all new modules. Remove P0 EMERGENCY FIX comments. Remove dead zombie recovery code that the state machine makes unnecessary. Update INIT-025 plan with final metrics.

## Success Criteria

- No file in the wu:done pipeline exceeds 500 lines (orchestrator) or 800 lines (phase modules)
- wu:done has an explicit, typed state machine with documented state transitions
- Single rollback mechanism (TransactionManager) replaces the current 4
- Gates execute exactly once per wu:done invocation (by design, not by dedup hack)
- Zero P0 EMERGENCY FIX comments remain in production code
- 80%+ test coverage on all new/decomposed modules
- All 10 target god files are under 800 lines (or have documented exceptions)
- No behavioral regressions: wu:done public API and workflow semantics unchanged

## Risks

**Risk 1: Regression during state machine extraction**
Mitigation: Write integration tests for all wu:done failure modes FIRST (WU-1658 is already doing this). Only then extract the state machine. Tests must pass before and after.

**Risk 2: Merge conflicts from parallel work**
Mitigation: Phase 1 (wu:done) touches concentrated files. Claim all 3 Phase 1 WUs sequentially, not in parallel. Phase 2 mechanical splits are independent and can parallelize.

**Risk 3: Barrel re-exports break downstream imports**
Mitigation: Barrel files maintain exact same export surface. Downstream code (MCP, CLI commands) should not need changes. Validate with full gates after each split.

**Risk 4: Scope creep into behavioral changes**
Mitigation: Strict rule -- no behavioral changes in this initiative. State machine must produce identical outputs for identical inputs. Any behavioral fix gets a separate WU outside INIT-025.

## Open Questions

1. **State machine library vs hand-rolled?** XState/TypeState would give formal guarantees but add a dependency. A simple discriminated union with switch/case may suffice for 7 states. Leaning toward hand-rolled for zero dependencies.

2. **Should WU-1659 (gate dedup) merge before or after Phase 1?** If 1659 lands first as a tactical patch, Phase 1 WU C supersedes it with a cleaner design. If 1659 is skipped, Phase 1 WU C handles it architecturally. Either way works.

3. **mcp/tools.ts (4081 lines) -- is this really a god file or just large by nature?** MCP tool registration may be inherently verbose. Need to assess whether splitting by tool category (wu-tools, mem-tools, etc.) actually improves maintainability or just adds indirection.

## References

- ID: INIT-025
- Created: 2026-02-12
