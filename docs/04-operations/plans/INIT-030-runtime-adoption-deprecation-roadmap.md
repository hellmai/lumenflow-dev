# INIT-030 Runtime Adoption Deprecation Roadmap

## Scope
- Initiative: `INIT-030`
- Surface strategy: keep migration in production packages `@lumenflow/mcp` and `@lumenflow/cli`
- Goal: deprecate legacy `runCliCommand` shell-outs through staged, parity-safe migration

## Baseline (As Of 2026-02-17)
- Baseline source: `tools/baselines/strict-progress-baseline.json`
- Guardrail test: `packages/@lumenflow/mcp/src/__tests__/shellout-budget.test.ts`
- Baseline budget: `100` `runCliCommand` call sites in `packages/@lumenflow/mcp/src/tools/*.ts`

### Shell-Out Domain Inventory
| Domain File | Call Sites |
| --- | ---: |
| `parity-tools.ts` | 27 |
| `wu-tools.ts` | 23 |
| `memory-tools.ts` | 14 |
| `initiative-tools.ts` | 8 |
| `setup-tools.ts` | 8 |
| `validation-tools.ts` | 6 |
| `flow-tools.ts` | 5 |
| `orchestration-tools.ts` | 4 |
| `agent-tools.ts` | 4 |
| `context-tools.ts` | 1 |
| **Total** | **100** |

## Migration Waves
| Wave | Window | Focus | Budget Checkpoint | Exit Criteria |
| --- | --- | --- | ---: | --- |
| Wave 0 | Completed on 2026-02-17 | Establish parity closure metrics and non-increasing budget guardrail (`WU-1793`, `WU-1795`) | 100 | Guardrail merged; regression fails if budget increases |
| Wave 1 | 2026-02-18 to 2026-03-31 | Migrate highest-frequency read/lifecycle shells in MCP/CLI where runtime APIs already exist | <= 90 | Migrated commands no longer call `runCliCommand`; parity checks pass |
| Wave 2 | 2026-04-01 to 2026-04-30 | Migrate initiative/memory/orchestration command groups | <= 70 | Domain wave commands execute via runtime/service APIs; parity checks pass |
| Wave 3 | 2026-05-01 to 2026-06-15 | Migrate setup/validation/flow command groups and remove temporary shell wrappers | <= 55 | Remaining shell-outs are reduced to documented edge cases only |
| Wave 4 | 2026-06-16 to 2026-07-31 | Final deprecation pass and formal exemption handling | <= 30 | All remaining shell-outs have approved exemption records with owner + removal date |

## Checkpoints And Governance Gates
- Budget guardrail must remain non-increasing relative to committed baseline.
- Each wave completion must record:
  - commands migrated in that wave,
  - parity test/gate evidence (`@lumenflow/mcp`, `@lumenflow/cli`),
  - updated call-site count versus checkpoint target.
- No checkpoint is considered complete if parity readiness is red.

## Closure Criteria
Phase 4 is auditable and complete when all are true:
- Wave checkpoints are documented with objective evidence.
- `runCliCommand` call-site count is at or below the final checkpoint.
- Any remaining shell-outs are tracked as explicit exemptions with:
  - rationale,
  - accountable owner,
  - target removal date.

## Audit References
- Initiative spec: `docs/04-operations/tasks/initiatives/INIT-030.yaml`
- WUs:
  - `WU-1793` (parity closure metrics)
  - `WU-1795` (shell-out budget guardrail)
  - `WU-1794` (timeline and closure governance)
