# INIT-028 Plan - Spawn-to-Delegation Clean-Slate Rename

Created: 2026-02-14

## Goal

Complete a clean-slate rename from `spawn` terminology to `delegation` terminology across live runtime surfaces.

No compatibility aliases or dual-read bridges will be kept. Legacy state transitions via first-run auto-archive plus rebootstrap.

## Scope

In scope:

- `packages/@lumenflow/{core,cli,initiatives,mcp}/**`
- Active docs and Starlight references
- `.lumenflow.config.yaml`, strict baseline, template manifest and prompt directory paths

Out of scope:

- Historical task artifacts (`docs/04-operations/tasks/**`)
- `.lumenflow/memory/**` and `.lumenflow/stamps/**`

Migration behavior:

- Archive legacy `.lumenflow/state/wu-events.jsonl` and `.lumenflow/state/spawn-registry.jsonl`
- Reconstruct `wu-events.jsonl` with delegation event semantics
- Initialize `delegation-registry.jsonl`

## Approach

WU-A (Phase 1): Implement migration guard + state rebootstrap, then perform atomic mechanical rename of runtime modules, commands, schemas, and template paths.

WU-B (Phase 2): Complete docs/parity/baseline updates so references match runtime behavior and command/tool names.

Execution is ordered: WU-B depends on WU-A.

## Success Criteria

<!-- How will you know when this is complete? Measurable outcomes? -->

## Risks

<!-- What could go wrong? How will you mitigate? -->

## Open Questions

<!-- Unresolved questions or decisions needed -->

## References

- ID: INIT-028
- Created: 2026-02-14
