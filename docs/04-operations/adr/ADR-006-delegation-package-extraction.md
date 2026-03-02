# ADR-006: Delegation Package Extraction

**Status:** Accepted  
**Date:** 2026-03-02  
**Authors:** Tom @ HellmAI  
**WU:** WU-2171

## Context

`@lumenflow/core` currently contains the delegation subsystem:

- `delegation-registry-schema.ts`
- `delegation-registry-store.ts`
- `delegation-tree.ts`
- `delegation-monitor.ts`
- `delegation-recovery.ts`
- `delegation-escalation.ts`

WU-2169 introduced grouped entrypoints and Phase 3 raised whether delegation should be extracted into a standalone package.

Current consumption pattern is still tightly integrated with core runtime concerns:

- Lane lock and state paths (`wu-constants`, `lane-lock`)
- Core recovery/escalation workflow logic
- CLI monitoring and completion flows
- State-store and file layout conventions under `.lumenflow/state`

## Decision

Do **not** extract delegation into a new package yet.  
Keep delegation in `@lumenflow/core` and treat extraction as conditional follow-up work.

## Rationale

1. Coupling is still structural, not incidental.
2. Extraction today would mostly move files without reducing conceptual load.
3. Grouped imports (`@lumenflow/core/delegation`) already provide a stable consumption boundary.
4. A premature package split would increase maintenance overhead (versioning, wiring, API compatibility) with low immediate payoff.

## Consequences

### Positive

- No churn in high-traffic orchestration paths.
- Keeps deployment/versioning simple while boundaries are still evolving.
- Existing delegation barrel remains the migration boundary for consumers.

### Trade-offs

- Delegation internals remain in the large core package for now.
- Package-level ownership isolation is deferred.

## Extraction Triggers (Revisit Criteria)

Re-evaluate extraction only when at least two are true:

1. Delegation has independent release cadence needs.
2. Core package build/test time pressure is materially driven by delegation code.
3. Clear port boundary exists for state, lock, and recovery interactions.
4. At least two non-core packages require delegation internals beyond current public barrel.

## Executable Follow-Up Recommendations

1. **Harden dependency boundary first**
   - Create a WU to define explicit delegation ports for file/state access and lock interactions.
   - Scope target: `delegation-monitor.ts`, `delegation-recovery.ts`, `delegation-escalation.ts`.

2. **Move consumers to the delegation barrel consistently**
   - Create a WU to remove remaining root-barrel imports for delegation APIs in CLI/MCP/runtime code.
   - Scope target: `@lumenflow/cli`, `@lumenflow/mcp`.

3. **Run extraction spike only after triggers are met**
   - Create a time-boxed spike WU to scaffold `@lumenflow/delegation` and validate build/test wiring.
   - Success criteria: no behavior change, no circular dependency regressions, clean package export contract.

## References

- `packages/@lumenflow/core/src/delegation-monitor.ts`
- `packages/@lumenflow/core/src/delegation-tree.ts`
- `packages/@lumenflow/core/src/delegation/index.ts`
- `docs/04-operations/tasks/wu/WU-2171.yaml`
