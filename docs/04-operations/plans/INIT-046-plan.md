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

1. Confirm canonical schema ownership for each tool group file as Phase 1 progresses.
2. Confirm any additional smoke cases needed beyond task/memory/channel/routine/system happy path.
3. Confirm expected report format for WU-2237 publish-readiness output artifacts.

## References

- Initiative: docs/04-operations/tasks/initiatives/INIT-046.yaml
- Work units: docs/04-operations/tasks/wu/WU-2231.yaml through docs/04-operations/tasks/wu/WU-2237.yaml
- Commands reference: docs/04-operations/\_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md
- Existing handover: /home/USER/.lumenflow/strategy/lumenflow-dev/strategy/handovers/INIT-046-sidekick-pack-runtime-handover-2026-02-27.md
