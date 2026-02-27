# INIT-046 Plan - Sidekick Pack and Runtime Surface

Created: 2026-02-27

## Goal

Deliver Sidekick pack and runtime-surface capabilities in lumenflow-dev with a stable, validated 16-tool contract.
Complete INIT-046 across phases 1-3 with working storage abstraction, runtime dispatch surface, and publish-readiness verification.

## Scope

In scope for this plan:

1. Pack scaffold, manifest contract, schema wiring, and registration under packages/@lumenflow/packs/sidekick.
2. StoragePort abstraction with filesystem default adapter and concurrency-safe write behavior.
3. Five tool groups totaling 16 tools with descriptor + implementation coverage.
4. Consumer abstraction contract package and runtime dispatch endpoint coverage.
5. Validation, gates, and smoke-flow readiness for release quality.

Primary work units:

- WU-2231 through WU-2237 in INIT-046 execution order.

## Approach

Execution approach:

1. Phase 1 foundation first: WU-2231, WU-2232, WU-2233, WU-2234.
2. Phase 2 surfaces next: WU-2235 and WU-2236 (parallel when capacity allows).
3. Phase 3 validation last: WU-2237.

Implementation method:

- TDD per WU with manifest/storage/tool tests authored before final implementation.
- Keep manifest, descriptor metadata, and tool implementations aligned at each step.
- Run pack and gate validation frequently to catch scope/schema drift early.
- Use worktree lifecycle for code WUs and tooling lifecycle commands for plan/initiative metadata updates.

## Success Criteria

INIT-046 is complete when:

1. Sidekick manifest contract defines 16 tools with schemas, permissions, and scopes, and validates cleanly.
2. Storage abstraction supports pluggable ports with filesystem default and tested locking semantics.
3. Runtime dispatch endpoint POST /tools/:name is available with enforcement preserved.
4. Sidekick validation, smoke flow, and publish-readiness checks pass.
5. WU-2231 through WU-2237 are completed in initiative state and delivery artifacts are present.

## Risks

1. Contract drift between manifest declarations and tool implementation behavior.
   Mitigation: manifest tests + pack validation in each phase.

2. Concurrent write hazards in filesystem-backed storage.
   Mitigation: explicit lock path and concurrent write tests in storage suite.

3. Scope mismatch causing runtime deny behavior.
   Mitigation: verify permissions/scopes per tool descriptor and validate through pack:validate.

4. Late integration surprises for runtime dispatch.
   Mitigation: land endpoint tests and enforcement checks before final validation phase.

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-046
- Created: 2026-02-27
