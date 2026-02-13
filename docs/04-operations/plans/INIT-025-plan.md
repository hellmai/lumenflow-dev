# INIT-025 Plan - God File Decomposition Initiative

Created: 2026-02-12

## Goal

Deliver INIT-025 as a state-machine-first hardening initiative: formalize wu:done execution with a typed XState pipeline and staged recovery consolidation, then finish remaining god-file decomposition with stronger verification and governance consistency.

## Scope

In scope: Phase 1 reconciliation + wu:done state-machine foundation (WU-1661..WU-1666), followed by the existing mechanical decomposition WUs and final coverage/cleanup. Out of scope: changing the public wu:done CLI contract or broad workflow semantics outside explicitly planned migration guards.

## Approach

Phase 1 (state-machine foundation): WU-1661 reconcile initiative metadata; WU-1662 define typed XState machine; WU-1663 wire CLI orchestrator; WU-1664 extract lifecycle services; WU-1665 consolidate rollback with staged compatibility guard; WU-1666 add model-based transition coverage using @xstate/graph. Phase 2 executes existing mechanical split WUs. Phase 3 removes temporary legacy paths and hardens coverage/reporting.

## Success Criteria

- INIT-025 metadata, linked plan, and execution WUs are mutually consistent and actionable.
- wu:done pipeline is represented by explicit typed states with validated transition/recovery paths.
- Duplicate gate amplification remains eliminated while preserving required safety checks.
- Existing mechanical decomposition WUs complete without regressions to public contracts.
- Coverage and failure-path confidence increase measurably across state/recovery modules.

## Risks

- Migration regressions in failure paths: mitigate with staged compatibility guard and failure-mode tests before legacy removal.
- Lane/WIP contention across Core State Recovery and CLI command lanes: mitigate with explicit dependency ordering (WU-1662 -> WU-1663/WU-1664 -> WU-1665/WU-1666).
- Tooling drift between initiative metadata and plan text: mitigate with reconciliation WU and linked plan governance checks.

## Open Questions

- Resolved: Use XState v5 for wu:done pipeline orchestration and keep WU lifecycle state-machine hand-rolled/typed unless lifecycle complexity materially grows.
- Resolved: Use @xstate/graph (not deprecated @xstate/test) for model-based transition coverage where feasible.
- Pending: Decide whether waiting-state sign-off flow belongs in a separate initiative after INIT-025 Phase 1 completion.

## References

- Initiative: INIT-025
- Linked Plan URI: lumenflow://plans/INIT-025-plan.md
- Sizing Guide: docs/04-operations/\_frameworks/lumenflow/wu-sizing-guide.md
- Phase 1 WUs: WU-1661, WU-1662, WU-1663, WU-1664, WU-1665, WU-1666
