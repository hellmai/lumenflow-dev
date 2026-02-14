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

- No live command/tool/module surface requires spawn-prefixed interface names
- First run with legacy spawn state auto-archives and rebootstrap completes without manual migration
- `delegation:list` and MCP `delegation_list` succeed while `spawn:list`/`spawn_list` are removed from active manifests/docs
- Full `pnpm gates` passes after rename and docs alignment

## Risks

- Mechanical rename breadth can introduce cross-package import regressions
- Migration/rebootstrap logic can corrupt state if archive and rebuild ordering is wrong
- Docs and runtime command/tool surfaces can drift if parity updates lag

Mitigations:

- Execute in two ordered WUs with explicit dependency (WU-B blocked by WU-A)
- Keep migration guard and rebootstrap covered by targeted tests before broad renames
- Run docs parity and full gates before completion

## Open Questions

- Confirm whether we need a custom merge driver for append-only `.jsonl` state files as follow-on hardening, or if current conflict handling remains sufficient for this initiative.

## References

- Linked initiative: `INIT-028`
- External source plan: `~/.lumenflow/plans/PLAN-spawn-to-delegation-rename.md`
- Related completed foundation work: `INIT-024`, `INIT-025`
