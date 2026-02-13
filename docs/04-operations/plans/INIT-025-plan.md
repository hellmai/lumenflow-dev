# INIT-025 Plan - God File Decomposition Initiative

Created: 2026-02-12

## Goal

Deliver INIT-025 as a state-machine-first hardening initiative: formalize wu:done execution with a typed XState pipeline and staged recovery consolidation, then finish remaining god-file decomposition with stronger verification and governance consistency.

## Scope

In scope: Phase 1 reconciliation + wu:done state-machine foundation (WU-1661..WU-1666), followed by the existing mechanical decomposition WUs and final coverage/cleanup. Out of scope: changing the public wu:done CLI contract or broad workflow semantics outside explicitly planned migration guards.

## Execution Ordering

INIT-025 follows a **state-machine-first** execution sequence. The original mechanical-only decomposition was resequenced so that wu:done pipeline formalization happens before mechanical file splits. This ensures the state-machine foundation provides typed contracts and validated transition paths that mechanical extractions can build on safely.

### Phase 1: State-Machine Foundation (in_progress)

| Order | WU      | Description                                             | Depends On       |
| ----- | ------- | ------------------------------------------------------- | ---------------- |
| 1     | WU-1661 | Reconcile initiative metadata and phase mapping         | --               |
| 2     | WU-1662 | Define typed XState wu:done pipeline machine in core    | WU-1661          |
| 3     | WU-1663 | Wire CLI orchestrator to XState machine                 | WU-1662          |
| 4     | WU-1664 | Extract lifecycle services from wu-done.ts              | WU-1662          |
| 5     | WU-1665 | Consolidate rollback with staged compatibility guard    | WU-1663, WU-1664 |
| 6     | WU-1666 | Add model-based transition coverage using @xstate/graph | WU-1662, WU-1663 |

### Phase 2: Mechanical Decomposition (pending)

Executes the existing mechanical split WUs (including WU-1642..WU-1645 and others). WU-1646 is conditionally included -- see Supersession Guidance below.

### Phase 3: Coverage Hardening + Cleanup (pending)

Removes temporary legacy paths, hardens coverage/reporting, and validates backward-compatible exports across all decomposed modules.

## Approach

Phase 1 delivers the state-machine foundation: WU-1661 reconciles initiative metadata; WU-1662 defines the typed XState machine; WU-1663 wires the CLI orchestrator; WU-1664 extracts lifecycle services; WU-1665 consolidates rollback with staged compatibility; WU-1666 adds model-based coverage. Phase 2 executes existing mechanical split WUs. Phase 3 removes temporary legacy paths and hardens coverage/reporting.

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

## Gate Dedup Baseline (WU-1659)

WU-1659 (completed 2026-02-13) established the gate dedup baseline: wu:done no longer runs full gates redundantly after a successful wu:prep pass. This is a prerequisite for the Phase 1 state-machine work because it defines the single-source-of-truth gate execution model that WU-1662..WU-1666 will formalize into typed XState states. The state-machine pipeline must preserve this non-duplicative gate behavior while adding explicit state/transition contracts.

## @xstate/test Deprecation Decision

**Decision:** Use `@xstate/graph` (XState v5 compatible) instead of the deprecated `@xstate/test` package for model-based transition coverage.

**Rationale:** `@xstate/test` is deprecated in XState v5 and will not receive updates. `@xstate/graph` provides the graph traversal and path generation capabilities needed for model-based testing without depending on a deprecated API surface. WU-1666 implements this decision. If `@xstate/graph` surfaces limitations in practice, the documented fallback is explicit transition matrix tests (see WU-1666 acceptance criteria).

## WU-1646 Supersession Guidance

WU-1646 ("Extract wu-done.ts into thin orchestrator and helper modules") was the original Phase 2 mechanical extraction approach. The state-machine-first resequencing means that WU-1662 through WU-1665 deliver a typed, state-machine-based decomposition of wu-done.ts that supersedes the mechanical extraction approach.

**Execution rule:** WU-1646 remains in Phase 2 with `blocked_by: [WU-1662, WU-1663, WU-1664, WU-1665]`. After Phase 1 completes:

- If WU-1662..WU-1665 deliver successfully: close WU-1646 as superseded (the state-machine decomposition achieves the same structural goals with stronger contracts).
- If any Phase 1 WU fails or is descoped: evaluate whether WU-1646 mechanical extraction is needed as a fallback for the undelivered portions.

## Open Questions

- Resolved: Use XState v5 for wu:done pipeline orchestration and keep WU lifecycle state-machine hand-rolled/typed unless lifecycle complexity materially grows.
- Resolved: Use @xstate/graph (not deprecated @xstate/test) for model-based transition coverage where feasible.
- Resolved: WU-1646 mechanical extraction is superseded by state-machine WUs; retained as conditional fallback only.
- Pending: Decide whether waiting-state sign-off flow belongs in a separate initiative after INIT-025 Phase 1 completion.

## References

- Initiative: INIT-025
- Linked Plan URI: lumenflow://plans/INIT-025-plan.md
- Sizing Guide: docs/04-operations/\_frameworks/lumenflow/wu-sizing-guide.md
- Phase 1 WUs: WU-1661, WU-1662, WU-1663, WU-1664, WU-1665, WU-1666
