# INIT-025 Plan - God File Decomposition Initiative

Created: 2026-02-12

## Goal

Deliver INIT-025 as a state-machine-first hardening initiative: formalize wu:done execution with a typed XState pipeline and staged recovery consolidation, then finish remaining god-file decomposition with stronger verification and governance consistency.

## Scope

In scope: Phase 1 reconciliation + wu:done state-machine foundation (WU-1661..WU-1666), followed by the existing mechanical decomposition WUs and final coverage/cleanup. Out of scope: changing the public wu:done CLI contract or broad workflow semantics outside explicitly planned migration guards.

## Approach

Phase 1 (state-machine foundation): WU-1661 reconcile initiative metadata; WU-1662 define typed XState machine; WU-1663 wire CLI orchestrator; WU-1664 extract lifecycle services; WU-1665 consolidate rollback with staged compatibility guard; WU-1666 add model-based transition coverage using @xstate/graph. Phase 2 executes existing mechanical split WUs. Phase 3 removes temporary legacy paths and hardens coverage/reporting.

## Success Criteria

- INIT-025 metadata, linked plan, and execution WUs are mutually consistent and actionable.\n- wu:done pipeline is represented by explicit typed states with validated transition/recovery paths.\n- Duplicate gate amplification remains eliminated while preserving required safety checks.\n- Existing mechanical decomposition WUs complete without regressions to public contracts.\n- Coverage and failure-path confidence increase measurably across state/recovery modules.

## Risks

- Migration regressions in failure paths: mitigate with staged compatibility guard and failure-mode tests before legacy removal.\n- Lane/WIP contention across Core State Recovery and CLI command lanes: mitigate with explicit dependency ordering (WU-1662 -> WU-1663/WU-1664 -> WU-1665/WU-1666).\n- Tooling drift between initiative metadata and plan text: mitigate with reconciliation WU and linked plan governance checks.

## Open Questions

1. **State machine library vs hand-rolled?** XState/TypeState would give formal guarantees but add a dependency. A simple discriminated union with switch/case may suffice for 7 states. Leaning toward hand-rolled for zero dependencies.

2. **Should WU-1659 (gate dedup) merge before or after Phase 1?** If 1659 lands first as a tactical patch, Phase 1 WU C supersedes it with a cleaner design. If 1659 is skipped, Phase 1 WU C handles it architecturally. Either way works.

3. **mcp/tools.ts (4081 lines) -- is this really a god file or just large by nature?** MCP tool registration may be inherently verbose. Need to assess whether splitting by tool category (wu-tools, mem-tools, etc.) actually improves maintainability or just adds indirection.

## References

- ID: INIT-025
- Created: 2026-02-12
