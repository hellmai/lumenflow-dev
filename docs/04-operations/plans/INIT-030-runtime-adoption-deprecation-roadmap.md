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

| Domain File              | Call Sites |
| ------------------------ | ---------: |
| `parity-tools.ts`        |         27 |
| `wu-tools.ts`            |         23 |
| `memory-tools.ts`        |         14 |
| `initiative-tools.ts`    |          8 |
| `setup-tools.ts`         |          8 |
| `validation-tools.ts`    |          6 |
| `flow-tools.ts`          |          5 |
| `orchestration-tools.ts` |          4 |
| `agent-tools.ts`         |          4 |
| `context-tools.ts`       |          1 |
| **Total**                |    **100** |

## Post-Migration Recertification (As Of 2026-02-18)

- Recomputed budget scope: `packages/@lumenflow/mcp/src/tools/*.ts`
- Measurement method: TypeScript AST call-site scan of direct `runCliCommand(...)` invocations
- Current total call sites: `0` (baseline `100`, delta `-100`)

### Recomputed Shell-Out Inventory

| Domain File                   | Call Sites |
| ----------------------------- | ---------: |
| `agent-tools.ts`              |          0 |
| `context-tools.ts`            |          0 |
| `flow-tools.ts`               |          0 |
| `initiative-tools.ts`         |          0 |
| `memory-tools.ts`             |          0 |
| `orchestration-tools.ts`      |          0 |
| `parity-tools.ts`             |          0 |
| `runtime-task-constants.ts`   |          0 |
| `runtime-task-tools.ts`       |          0 |
| `setup-tools.ts`              |          0 |
| `validation-tools.ts`         |          0 |
| `wu-tools.ts`                 |          0 |
| **Total**                     |      **0** |
| **Delta vs baseline (100)**   |   **-100** |
| **Wave 4 checkpoint (<= 30)** |   **pass** |

### Wave Evidence (Post-Phase-3 Actuals)

| Wave       | Delivery Evidence                                                                                                      | Budget Evidence | Parity/Gate Evidence                                                                                                                                                                                                                                                                                                                                                                                                                            | Outcome   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | --------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0          | `WU-1793`, `WU-1794`, `WU-1795`                                                                                        |             100 | Guardrail (`shellout-budget.test.ts`) established and enforced                                                                                                                                                                                                                                                                                                                                                                                  | Complete  |
| 1-3        | `WU-1796` through `WU-1814`, plus phase-hardening WUs `WU-1848`, `WU-1849`, `WU-1850`, `WU-1851`, `WU-1855`, `WU-1856` |               0 | Runtime migration and parity closure validated in phase completion evidence (`WU-1814`)                                                                                                                                                                                                                                                                                                                                                         | Complete  |
| 4 (recert) | `WU-1815`                                                                                                              |               0 | `pnpm vitest run src/__tests__/wu-tools.test.ts src/__tests__/cli-integration.test.ts src/__tests__/runtime-tool-resolver.test.ts src/__tests__/shellout-budget.test.ts` -> `152/152` pass; `pnpm --filter @lumenflow/mcp typecheck` pass; `pnpm --filter @lumenflow/mcp lint` pass; full `pnpm gates` fails only on pre-existing `@lumenflow/web` typecheck at `packages/@lumenflow/surfaces/http/ag-ui-adapter.ts:199` (reproduced on `main`) | Re-closed |

### Remaining Shell-Out Register (Post-Recertification)

| Scope                                      | Call Sites | Owner                     | Rationale                                                                                           | Target Removal Date  |
| ------------------------------------------ | ---------: | ------------------------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| `packages/@lumenflow/mcp/src/tools/*.ts`   |          0 | Framework: Core Lifecycle | No remaining direct tool-layer shell-outs after phase migration                                     | Closed on 2026-02-18 |
| `packages/@lumenflow/mcp/src/resources.ts` |          1 | Framework: Core Lifecycle | Resource endpoint still shells out for `wu:status` parity path pending runtime-resource replacement | 2026-07-31           |

## Migration Waves

| Wave   | Window                   | Focus                                                                                       | Budget Checkpoint | Exit Criteria                                                                      |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------- | ----------------: | ---------------------------------------------------------------------------------- |
| Wave 0 | Completed on 2026-02-17  | Establish parity closure metrics and non-increasing budget guardrail (`WU-1793`, `WU-1795`) |               100 | Guardrail merged; regression fails if budget increases                             |
| Wave 1 | 2026-02-18 to 2026-03-31 | Migrate highest-frequency read/lifecycle shells in MCP/CLI where runtime APIs already exist |             <= 90 | Migrated commands no longer call `runCliCommand`; parity checks pass               |
| Wave 2 | 2026-04-01 to 2026-04-30 | Migrate initiative/memory/orchestration command groups                                      |             <= 70 | Domain wave commands execute via runtime/service APIs; parity checks pass          |
| Wave 3 | 2026-05-01 to 2026-06-15 | Migrate setup/validation/flow command groups and remove temporary shell wrappers            |             <= 55 | Remaining shell-outs are reduced to documented edge cases only                     |
| Wave 4 | 2026-06-16 to 2026-07-31 | Final deprecation pass and formal exemption handling                                        |             <= 30 | All remaining shell-outs have approved exemption records with owner + removal date |

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
  - `WU-1815` (post-Phase-3 recertification and metric closure)
