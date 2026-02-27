# INIT-046 Plan - Sidekick Pack and Runtime Surface

Created: 2026-02-27

## Goal

Deliver INIT-046 as a complete Sidekick pack and runtime-surface initiative in lumenflow-dev.

Primary objective:

- Ship a validated, enforcement-aligned 16-tool Sidekick contract and supporting runtime surfaces.

Outcome objective:

- Complete WU-2231 through WU-2237 with green quality gates, reproducible smoke flow, and publish-readiness evidence.

## Scope

Initiative scope is organized by the current WU set and phase model.

Phase 1 scope (pack contract and implementation):

1. WU-2231: Sidekick scaffold, manifest contract, schema + registration wiring.
2. WU-2232: StoragePort abstraction and filesystem default adapter.
3. WU-2233: Task and memory tool groups (descriptors + implementations + tests).
4. WU-2234: Channel, routine, and system tool groups (descriptors + implementations + tests).

Phase 2 scope (consumer abstraction and runtime surface):

1. WU-2235: Consumer abstraction contract package.
2. WU-2236: Generic HTTP dispatch endpoint POST /tools/:name with enforcement compatibility.

Phase 3 scope (validation and readiness):

1. WU-2237: End-to-end validation, gate convergence, smoke flow, and publish-readiness outputs.

Required contract shape:

- 16 tool declarations with schema-defined IO, explicit permissions, and explicit scope patterns.
- Write tools include audit scope coverage.
- Storage remains workspace-local and pack-enforced.

## Approach

Execution proceeds in strict phase order with early contract validation and incremental test expansion.

Detailed sequence:

1. Contract-first baseline:

- Establish Sidekick package layout under packages/@lumenflow/packs/sidekick.
- Define manifest and manifest schema/parser wiring before full tool implementation.
- Run pack validation early to catch schema/scope defects before deeper coding.

2. Storage foundation:

- Implement StoragePort abstraction with minimal durable interface.
- Implement filesystem-backed default adapter with lock/atomic write behavior.
- Validate concurrency behavior in unit tests before wiring full write-heavy tools.

3. Tool-group delivery waves:

- Wave A: task + memory groups.
- Wave B: channel + routine + system groups.
- Each wave includes descriptor metadata, implementation behavior, and unit tests in the same WU.

4. Surface + contract integration:

- Add consumer abstraction package interfaces once core pack behavior is stable.
- Add runtime HTTP dispatch endpoint with explicit enforcement compatibility checks.

5. Initiative closure:

- Consolidate test coverage, pack validation, and smoke path.
- Capture publish-readiness evidence and gates output for WU-2237.

Architecture baseline to maintain across waves:

Planned package layout:

- packages/@lumenflow/packs/sidekick/manifest.yaml
- packages/@lumenflow/packs/sidekick/constants.ts
- packages/@lumenflow/packs/sidekick/index.ts
- packages/@lumenflow/packs/sidekick/manifest.ts
- packages/@lumenflow/packs/sidekick/manifest-schema.ts
- packages/@lumenflow/packs/sidekick/pack-registration.ts
- packages/@lumenflow/packs/sidekick/tools/\*
- packages/@lumenflow/packs/sidekick/tool-impl/\*
- packages/@lumenflow/packs/sidekick/**tests**/\*

Target tool groups and count:

- Task: 4 tools.
- Memory: 3 tools.
- Channel: 3 tools.
- Routine: 3 tools.
- System: 3 tools.
- Total: 16 tools.

Workspace-local data model baseline:

- .sidekick/tasks/tasks.json
- .sidekick/memory/memory.json
- .sidekick/channels/channels.json
- .sidekick/channels/outbox.json
- .sidekick/routines/routines.json
- .sidekick/audit/events.jsonl

Implementation discipline:

- TDD-first for each WU.
- Keep descriptor metadata, manifest declarations, and implementation behavior synchronized.
- Run plan/initiative updates through LumenFlow CLI lifecycle commands.
- Use worktree lifecycle commands for code WUs and keep main clean.

Validation cadence:

- After WU-2231: manifest-focused unit tests + pack:validate.
- After WU-2232: storage tests (including contention scenarios).
- After WU-2233/2234: tool-group tests + manifest resolution tests.
- After WU-2235/2236: contract and runtime integration tests.
- Before WU-2237 completion: full gates + smoke flow evidence.

Smoke flow sequence target:

1. sidekick:init
2. task:create
3. task:list
4. memory:store
5. memory:recall
6. channel:configure
7. channel:send
8. routine:create
9. routine:run
10. sidekick:status
11. sidekick:export

## Success Criteria

INIT-046 is complete when all of the following are true:

1. Contract completeness:

- Sidekick manifest contains exactly 16 declared tools.
- Every tool has schema, permission, and scope declarations.
- Pack validation for Sidekick is green.

2. Storage architecture completeness:

- StoragePort abstraction is implemented and exercised by tests.
- Filesystem adapter is default and validated for consistency under concurrent writes.

3. Tooling completeness:

- All five tool groups are implemented and test-covered.
- Descriptor wiring, manifest mapping, and registration are consistent.

4. Runtime surface completeness:

- POST /tools/:name endpoint exists and preserves enforcement constraints.
- Consumer abstraction contract package is present and validated.

5. Initiative readiness:

- WU-2231..WU-2237 lifecycle status is complete.
- pnpm pack:validate --id sidekick passes.
- pnpm gates passes.
- Smoke flow executes successfully and readiness artifacts are recorded.

## Risks

1. Contract drift across files.
   Mitigation: compare manifest declarations against descriptor exports and implementation registry in every wave.

2. Storage race conditions.
   Mitigation: enforce lock semantics in adapter and maintain dedicated concurrency tests in WU-2232.

3. Scope/policy mismatches.
   Mitigation: verify read/write scopes at descriptor + manifest level and re-run pack validation after scope edits.

4. Runtime integration regressions.
   Mitigation: endpoint tests added with enforcement checks in WU-2236 before final readiness wave.

5. Late-stage gate failures.
   Mitigation: run incremental validation during each WU and keep WU-2237 focused on convergence rather than first-time integration.

## Open Questions

1. Confirm whether any additional schema constraints are required for tool inputs beyond current manifest shape.
2. Confirm preferred artifact format for WU-2237 publish-readiness evidence bundle.
3. Confirm whether runtime dispatch metrics should be included in WU-2236 acceptance outputs.

## References

- docs/04-operations/tasks/initiatives/INIT-046.yaml
- docs/04-operations/tasks/wu/WU-2231.yaml
- docs/04-operations/tasks/wu/WU-2232.yaml
- docs/04-operations/tasks/wu/WU-2233.yaml
- docs/04-operations/tasks/wu/WU-2234.yaml
- docs/04-operations/tasks/wu/WU-2235.yaml
- docs/04-operations/tasks/wu/WU-2236.yaml
- docs/04-operations/tasks/wu/WU-2237.yaml
- docs/04-operations/\_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md
- /home/USER/.lumenflow/strategy/lumenflow-dev/strategy/handovers/INIT-046-sidekick-pack-runtime-handover-2026-02-27.md
