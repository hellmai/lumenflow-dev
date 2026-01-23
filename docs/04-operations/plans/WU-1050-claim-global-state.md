# WU-1050 Plan — wu:claim global state visibility

## Goal

Make `wu:claim` update canonical state on `origin/main` without touching local main, and make claims globally visible immediately via lane branch push.

## Scope

- Add remote branch existence check (`git ls-remote --heads`).
- Push canonical claim state via micro-worktree (push-only).
- Create worktree/branch from `origin/main` after canonical update.
- Push lane branch by default; support `--no-push` for air-gapped local-only claims.
- Update docs to define global state as `origin/main` + remote lane branches.

## Approach

1. **Preflight (read-only)**: validate WU YAML schema + spec completeness, lane format/WIP, and code path overlaps on an up-to-date `origin/main` (no local main mutation).
2. **Canonical update (push-only micro-worktree)**: update WU YAML, status/backlog, and `.lumenflow/state/wu-events.jsonl` on `origin/main`.
3. **Worktree creation**: create lane branch/worktree from `origin/main` and push lane branch (global claim lock).
4. **No-push path**: skip remote checks and pushes; update claim metadata inside the worktree only and warn that the claim is local-only.

## Failure Handling

- If canonical update fails: abort claim without creating worktree.
- If worktree/branch creation fails after canonical update: emit recovery steps (fetch + retry + delete local branch).

## Tests

- Unit: `git-adapter.remoteBranchExists`, `WU_OPTIONS.noPush`.
- Manual: confirm canonical update on origin/main, branch push by default, and `--no-push` local-only warning.
