# Validator Boundaries and Ownership

**WU-2176** | Last updated: 2026-03-02

## Purpose

This document defines where validation logic belongs in LumenFlow and which lane owns each area.
Use it to avoid duplicate validators, mixed responsibilities, and cross-package drift.

## Ownership Rules

1. Put reusable domain and schema validation in `@lumenflow/core`.
2. Put CLI command argument and workflow orchestration validation in `@lumenflow/cli`.
3. Put package-specific runtime/process validation in the owning runtime package, using core helpers when shared.
4. Keep docs that describe validation architecture in `Content: Framework Docs`.

## Validator Ownership Matrix

| Concern                                    | Primary modules                                                                                                                                                          | Owned by lane                | Notes                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------- |
| WU schema structure + normalization        | `packages/@lumenflow/core/src/wu-schema.ts`, `packages/@lumenflow/core/src/wu-schema-normalization.ts`                                                                   | `Framework: Core Validation` | Source of truth for WU YAML field-level constraints   |
| WU lifecycle semantic validation           | `packages/@lumenflow/core/src/wu-done-validation.ts`, `packages/@lumenflow/core/src/wu-preflight-validators.ts`, `packages/@lumenflow/core/src/manual-test-validator.ts` | `Framework: Core Validation` | Enforces completion and test-path rules               |
| Path and dependency checks                 | `packages/@lumenflow/core/src/code-path-validator.ts`, `packages/@lumenflow/core/src/docs-path-validator.ts`, `packages/@lumenflow/core/src/dependency-validator.ts`     | `Framework: Core Validation` | Filesystem and declaration consistency checks         |
| Sync and git-state validation              | `packages/@lumenflow/core/src/sync-validator.ts`, `packages/@lumenflow/core/src/ports/sync-validator.ports.ts`                                                           | `Framework: Core Validation` | Main sync checks and adapter contracts                |
| Command-level claim/create/edit validation | `packages/@lumenflow/cli/src/wu-claim-validation.ts`, `packages/@lumenflow/cli/src/wu-create-validation.ts`, `packages/@lumenflow/cli/src/wu-edit-validators.ts`         | `Framework: CLI Enforcement` | Command-specific orchestration and user-facing errors |
| CLI validator composition/registry         | `packages/@lumenflow/cli/src/shared-validators.ts`, `packages/@lumenflow/cli/src/validator-registry.ts`                                                                  | `Framework: CLI Enforcement` | Shared command validation wiring                      |
| Startup environment schema checks          | `packages/@lumenflow/core/src/startup-env-validation.ts`                                                                                                                 | `Framework: Core Validation` | Shared startup policy (`warn`/`error`)                |
| Runtime daemon payload validation          | `packages/@lumenflow/runtime/src/daemon/runtime-daemon.ts`                                                                                                               | `Operations: Runtime`        | Runtime-owned input schemas and daemon behavior       |

## Placement Guide for New Validation

Use this order before adding any new validator:

1. If the rule is reusable across packages or commands, add it in `@lumenflow/core`.
2. If it is only about one CLI command workflow, keep it in `@lumenflow/cli`.
3. If it is specific to runtime daemon/process behavior, keep it in `@lumenflow/runtime`.
4. If a package-specific validator needs shared primitives, extract primitives to `@lumenflow/core` and keep package wiring local.

## Boundary Anti-Patterns

- Do not duplicate the same semantic rule in both core and cli.
- Do not place CLI UX formatting concerns (prompt copy, command option handling) in core.
- Do not place reusable schema/domain checks directly in runtime or cli packages.
- Do not add new validation docs without linking them from maintainer-facing docs.

## Related References

- WU schema reference: `apps/docs/src/content/docs/reference/wu-schema.mdx`
- Workflow overview: `LUMENFLOW.md`
