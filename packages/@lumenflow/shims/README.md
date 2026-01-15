# @lumenflow/shims

Git and pnpm safety shims for LumenFlow worktree discipline.

## Overview

This package provides command shims that:

1. **Git shim** - Blocks destructive git commands on main branch/worktree
2. **Pnpm shim** - Fixes worktree compatibility for dependency commands

## Installation

```bash
pnpm add @lumenflow/shims
```

## Usage

### Git Shim

The git shim prevents destructive commands on protected branches (default: main).

**Blocked commands on main:**
- git reset with hard flag
- git stash (any form)
- git clean with fd flags
- git checkout with force flag
- git push with force flag
- Hook bypass flags

These commands are **allowed** in lane worktrees (safe, isolated context).

```typescript
import { runGitShim, checkBannedPattern, GitShimConfigSchema } from '@lumenflow/shims';

// Run as CLI
runGitShim(process.argv.slice(2));

// Check if a command pattern is banned
const result = checkBannedPattern(['reset', '--hard']);
if (result.banned) {
  console.error(result.reason);
}

// Custom configuration
const config = GitShimConfigSchema.parse({
  protectedBranch: 'develop',
  bannedPatterns: [{ command: 'rebase' }],
});
```

### Pnpm Shim

The pnpm shim fixes ERR_PNPM_UNEXPECTED_VIRTUAL_STORE errors in git worktrees.

```typescript
import { runPnpmShim, isDependencyCommand, PnpmShimConfigSchema } from '@lumenflow/shims';

// Run as CLI
runPnpmShim(process.argv.slice(2));

// Check if command modifies dependencies
isDependencyCommand(['add', 'zod']); // true
isDependencyCommand(['run', 'test']); // false
```

### Worktree Detection

```typescript
import { isInWorktree, isMainWorktree, getMainCheckoutPath, getCurrentBranch } from '@lumenflow/shims';

// Check worktree context
if (isInWorktree()) {
  console.log('Running in a git worktree');
}

if (isMainWorktree()) {
  console.log('Running in main checkout (protected)');
}

// Get main checkout path (useful for computing virtual store)
const mainPath = getMainCheckoutPath();

// Get current branch
const branch = getCurrentBranch();
```

## Configuration

Both shims are configurable via Zod schemas.

### GitShimConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| protectedBranch | string | main | Branch where destructive commands are blocked |
| bannedPatterns | array | See defaults | Command + flags combinations to block |
| bannedFlags | string[] | See defaults | Flags blocked on any command |
| realGitPath | string | /usr/bin/git | Path to real git executable |
| enableLogging | boolean | false | Enable command logging |
| logPath | string | undefined | Path to log file |
| recursionEnvVar | string | auto | Env var for recursion guard |
| agentEnvVars | string[] | See defaults | Env vars indicating agent context |

### PnpmShimConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| dependencyCommands | string[] | add, remove, install, etc | Commands that modify dependencies |
| systemPnpmPaths | string[] | System paths | Paths to search for real pnpm |
| recursionEnvVar | string | auto | Env var for recursion guard |
| enableDebug | boolean | false | Enable debug output |

## CLI Usage

The package exports bin commands that can be used as shims:

```bash
# Add to PATH before system paths
export PATH="./node_modules/.bin:$PATH"

# Now git/pnpm commands are intercepted
git reset --hard  # Blocked on main
pnpm add zod      # Fixed in worktrees
```

## License

Apache-2.0
