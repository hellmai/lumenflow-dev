# WU-1061 Plan — Integrate docs:generate into wu:done

## Goal

Move documentation regeneration from pre-commit hook to `wu:done`. Run once after gates pass, with zero overhead when no doc-source files changed.

## Scope

- Detect doc-source changes using cheap `git diff` with pathspecs (~0ms)
- Run `turbo docs:generate` only when source changed (Turbo handles build deps + caching)
- Stage doc outputs before metadata commit (single atomic commit)
- Remove pre-commit `docs-sync.mjs` hook (no longer needed)
- Works in both worktree and branch-only modes

## Detection Pathspecs

Files that affect generated documentation:

```text
tools/generate-cli-docs.ts
packages/@lumenflow/core/src/arg-parser.ts
packages/@lumenflow/core/src/lumenflow-config-schema.ts
packages/@lumenflow/core/src/index.ts
packages/@lumenflow/cli/package.json
packages/@lumenflow/cli/src/
```

## Approach

### 1. Add turbo.json task

```json
"docs:generate": {
  "dependsOn": ["@lumenflow/core#build"],
  "inputs": [
    "tools/generate-cli-docs.ts",
    "packages/@lumenflow/core/src/arg-parser.ts",
    "packages/@lumenflow/core/src/lumenflow-config-schema.ts",
    "packages/@lumenflow/core/src/index.ts",
    "packages/@lumenflow/cli/package.json",
    "packages/@lumenflow/cli/src/**"
  ],
  "outputs": [
    "apps/docs/src/content/docs/reference/cli.mdx",
    "apps/docs/src/content/docs/reference/config.mdx"
  ]
}
```

### 2. Add detection to wu-done-worktree.ts

After gates pass, before `stageAndFormatMetadata()`:

```typescript
const DOC_SOURCE_PATHSPECS = [
  'tools/generate-cli-docs.ts',
  'packages/@lumenflow/core/src/arg-parser.ts',
  'packages/@lumenflow/core/src/lumenflow-config-schema.ts',
  'packages/@lumenflow/core/src/index.ts',
  'packages/@lumenflow/cli/package.json',
  'packages/@lumenflow/cli/src/',
];

async function hasDocSourceChanges(baseBranch: string): Promise<boolean> {
  const gitAdapter = getGitForCwd();
  const diff = await gitAdapter.raw([
    'diff', `${baseBranch}...HEAD`, '--name-only', '--',
    ...DOC_SOURCE_PATHSPECS,
  ]);
  return diff.trim().length > 0;
}
```

### 3. Integration point

```typescript
// In executeWorktreeCompletion(), after gates pass:
const baseBranch = defaultBranchFrom(config, 'docMain') ?? await resolveBranchFallback();

if (await hasDocSourceChanges(baseBranch)) {
  logger.info('Doc-source files changed, regenerating documentation...');
  await execa('pnpm', ['turbo', 'docs:generate'], { cwd: repoRoot });

  // Stage generated doc outputs
  await gitAdapter.add([
    'apps/docs/src/content/docs/reference/cli.mdx',
    'apps/docs/src/content/docs/reference/config.mdx',
  ]);
}

// Then continue with stageAndFormatMetadata()...
```

### 4. Remove pre-commit hook

Delete `.husky/hooks/docs-sync.mjs` - no longer needed since docs regenerate in wu:done.

### 5. Branch-only mode

Same detection logic applies to `wu-done-branch-only.ts`. Both files need:
- `hasDocSourceChanges()` check after gates pass
- `turbo docs:generate` execution when source changed
- Doc output staging before metadata commit

The detection uses `git diff` against base branch, works regardless of mode.

## Tests

- **Unit**: `packages/@lumenflow/core/src/__tests__/wu-done-docs-detection.test.ts`
  - Detection returns true when pathspec files changed
  - Detection returns false when unrelated files changed
  - Detection handles missing base branch gracefully
- **Manual**: Modify only `apps/docs` content and run wu:done - verify ~0ms overhead

## Safety Net

CI `docs:validate` remains as backup to catch any drift.
