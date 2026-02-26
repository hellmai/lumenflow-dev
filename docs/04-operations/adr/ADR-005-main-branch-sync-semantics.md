# ADR-005: Main-Branch Sync Semantics and Consolidation Plan

**Status:** Accepted  
**Date:** 2026-02-26  
**Authors:** Tom @ HellmAI  
**WU:** WU-2199

## Context

Main-branch sync checks are currently spread across multiple layers and modules with mixed semantics:

- **Core helper parity check**: `ensureMainUpToDate` in `wu-helpers.ts` (exact hash match).
- **Core wu:done guard**: `validateMainNotBehindOrigin` / `ensureMainNotBehindOrigin` in `wu-done-main-sync.ts` (not-behind).
- **CLI wu:done preflight**: `ensureMainUpToDate` in `wu-done-git-ops.ts` (exact parity plus ahead/behind counts).
- **Core service reuse**: `validateWorktreeState` in `wu-done-worktree-services.ts` also calls `validateMainNotBehindOrigin`.
- **Micro-worktree orchestration**: `withMicroWorktree` in `micro-worktree.ts` already performs its own fetch/sync behavior before branch/worktree creation.

This creates unclear ownership, duplicate adapter types, and inconsistent fail-open/fail-closed behavior.

## Current Architecture (As-Is)

```text
Micro-worktree commands (claim/edit/delete/initiative/...):

CLI command
  -> ensureOnMain (command-specific)
  -> withMicroWorktree(...)
       -> fetch origin/main
       -> if pushOnly: base temp branch from origin/main
       -> else: ff-merge local main with origin/main
       -> execute in temp worktree
       -> push/retry/rebase logic


wu:done worktree mode:

CLI wu:done
  -> ensureOnMain(main)
  -> CLI ensureMainUpToDate() [exact parity]
  -> executeWorktreeCompletion(...)
       -> core ensureMainNotBehindOrigin() [not-behind]
       -> metadata transaction
       -> executeMergePhase(...)
            -> withAtomicMerge(...)
                 -> fetch origin/main
                 -> base temp branch from origin/main
                 -> merge/push via retry path

Core service path (state-machine services):
  validateWorktreeState(...)
    -> validateMainNotBehindOrigin() [not-behind]
```

## Type Duplication Inventory

1. `EnsureMainUpToDateGitAdapter = Pick<IWuGitAdapter, 'fetch' | 'getCommitHash'>`  
   File: `packages/@lumenflow/core/src/wu-helpers.ts`
2. `MainSyncGitAdapter { fetch; getCommitHash; revList }`  
   File: `packages/@lumenflow/core/src/wu-done-main-sync.ts`
3. Inline `gitAdapterForMain` shape `{ getCommitHash; fetch; revList }`  
   File: `packages/@lumenflow/core/src/wu-done-worktree-services.ts`
4. No dedicated sync adapter interface in `wu-done-git-ops.ts`; sync helpers use the full concrete adapter via `ReturnType<typeof getGitForCwd>`  
   File: `packages/@lumenflow/cli/src/wu-done-git-ops.ts`

## DI / IoC Gap Inventory

1. `wu-done-git-ops.ts` sync helpers take no adapter argument and create adapter internally via `getGitForCwd()`.
2. `wu-done-main-sync.ts` creates adapter internally via `createGitForPath(mainCheckoutPath)`.
3. `micro-worktree-shared.ts` `cleanupMicroWorktree()` creates `mainGit` internally via `getGitForCwd()`.

These make sync logic harder to unit test in isolation and encourage concrete-coupled call paths.

## Decision

### 1) wu:done semantics: choose **not-behind**, not strict exact parity

For `wu:done` merge-capable paths, the blocking invariant is:

- **Block when local main is behind `origin/main`**.
- **Do not block solely because local main is ahead/diverged**; treat as diagnostic and continue using `origin/main` as merge base in atomic flow.

Rationale:

- `withAtomicMerge` already anchors merge operations to `origin/main`.
- Blocking on exact parity can reject otherwise safe completion paths.
- The critical safety requirement is preventing stale-base completion (`behind`), not enforcing local mirror parity.

### 2) Fail-open / fail-closed policy by command/mode

| Command / Mode                                                                                           | Sync policy                                                                 |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `wu:done` worktree mode                                                                                  | **Fail-closed** when remote checks are required and cannot be validated     |
| `wu:done` branch-only mode                                                                               | **Fail-closed** for remote sync validation before merge/push                |
| `wu:done` branch-pr mode                                                                                 | No main-merge sync check (does not merge to main directly)                  |
| Micro-worktree mutation commands (`wu:claim`, `wu:edit`, `wu:delete`, initiative/plan/lane/config edits) | **Fail-open** on prefetch/sync check; push/retry path remains authoritative |
| Any mode with `git.requireRemote=false`                                                                  | Skip remote sync validation and run local-only semantics                    |

### 3) Ownership boundaries

- `withMicroWorktree` owns sync behavior for micro-worktree command family.
- `wu:done` owns sync behavior for completion/merge family.
- Commands that already delegate to `withMicroWorktree` must not add redundant preflight parity checks.

### 4) Canonical adapter interface

Create `packages/@lumenflow/core/src/ports/sync-validator.ports.ts`:

```ts
export interface ISyncValidatorGitAdapter {
  fetch(remote: string, branch: string): Promise<void>;
  getCommitHash(ref: string): Promise<string>;
  revList(args: string[]): Promise<string>;
}
```

Narrow types (e.g., `Pick<>`) may be defined from this canonical interface, but no new ad-hoc sync adapter shapes should be introduced.

## Consequences

### Positive

- Explicit semantics per command/mode.
- Single canonical sync adapter contract.
- Reduced duplication and cleaner dependency injection boundaries.
- Easier test coverage for sync edge cases.

### Trade-offs

- Behavior change risk during migration from exact-parity checks.
- Temporary dual-path compatibility while old exports remain.

### Guardrails

- Keep backward-compatible re-exports during migration.
- Add regression tests for behind/ahead/diverged/network-failure scenarios.

## Phased WU Breakdown (Implementation Plan)

### Phase 1: Type consolidation

- Add `ports/sync-validator.ports.ts` with `ISyncValidatorGitAdapter`.
- Replace duplicated sync adapter declarations with `Pick<ISyncValidatorGitAdapter, ...>`.

### Phase 2: New `sync-validator` module

- Create `sync-validator.ts` owning:
  - `ensureMainUpToDate` (if still needed for non-`wu:done` parity checks),
  - `validateMainNotBehindOrigin`,
  - `ensureMainNotBehindOrigin`,
  - shared helpers for sync diagnostics.
- Preserve compatibility via re-exports from existing modules during transition.

### Phase 3: withMicroWorktree extraction boundary

- Extract internal sync preamble (`fetch`, mode-specific local-main update, base-ref derivation) into explicit helper(s) while preserving current behavior.
- Keep `withMicroWorktree` as sole owner of micro-worktree sync policy.

### Phase 4: DI hardening

- Add optional injected adapter parameters to:
  - `wu-done-git-ops` sync helpers,
  - `wu-done-main-sync` preflight helpers,
  - `micro-worktree-shared` cleanup helpers.
- Default to existing factories for backward compatibility.

### Phase 5: wu:done simplification

- Remove redundant/overlapping sync checks and keep one canonical pre-merge invariant for merge-capable `wu:done` paths.
- Align CLI/core/service call sites to the same semantics table defined in this ADR.

## References

- `packages/@lumenflow/core/src/wu-helpers.ts`
- `packages/@lumenflow/core/src/wu-done-main-sync.ts`
- `packages/@lumenflow/core/src/wu-done-worktree-services.ts`
- `packages/@lumenflow/cli/src/wu-done-git-ops.ts`
- `packages/@lumenflow/core/src/micro-worktree.ts`
- `packages/@lumenflow/core/src/micro-worktree-shared.ts`
- `docs/04-operations/tasks/wu/WU-2199.yaml`
