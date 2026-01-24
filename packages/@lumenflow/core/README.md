# @lumenflow/core

Core WU lifecycle tools for the LumenFlow workflow framework.

## Installation

```bash
pnpm add @lumenflow/core
```

## Usage

### Git Operations

```typescript
import { createGitAdapter } from '@lumenflow/core';
// Or: import { createGitAdapter } from '@lumenflow/core/git';

const git = createGitAdapter({ baseDir: '/path/to/repo' });

// Check status
const status = await git.getStatus();
if (!status.isClean) {
  console.log('Modified:', status.modified);
  console.log('Untracked:', status.untracked);
}

// Commit changes
await git.add('.');
await git.commit('feat: add new feature');
await git.push();

// Fast-forward merge
await git.mergeFastForward('feature-branch');

// Branch operations
await git.createBranch('feature/new-feature', 'main');
const exists = await git.branchExists('feature/new-feature');
await git.checkout('main');
await git.deleteBranch('feature/new-feature');
```

### Worktree Management

```typescript
import { createWorktreeManager } from '@lumenflow/core';
// Or: import { createWorktreeManager } from '@lumenflow/core/git';

const worktrees = createWorktreeManager({ baseDir: '/path/to/repo' });

// Create worktree for a WU
const result = await worktrees.create({
  path: 'worktrees/operations-wu-123',
  branch: 'lane/operations/wu-123',
  startPoint: 'origin/main',
});

// List worktrees
const list = await worktrees.list();
for (const wt of list) {
  console.log(`${wt.path} -> ${wt.branch}`);
}

// Check if worktree exists
const exists = await worktrees.exists('/path/to/worktree');

// Remove worktree (handles orphan cleanup)
await worktrees.remove('worktrees/operations-wu-123');
```

### Agent Branch Patterns

Check if a branch is an agent branch that can bypass worktree requirements. Patterns are fetched from a central registry with 7-day caching.

```typescript
import { isAgentBranch, getAgentPatterns } from '@lumenflow/core';

// Check if branch can bypass worktree requirements (async, uses registry)
if (await isAgentBranch('claude/session-12345')) {
  console.log('Agent branch - bypass allowed');
}

// Get the current list of agent patterns
const patterns = await getAgentPatterns();
// ['agent/*', 'claude/*', 'codex/*', 'copilot/*', 'cursor/*', ...]

// Synchronous version (uses local config only, no registry fetch)
import { isAgentBranchSync } from '@lumenflow/core';
const result = isAgentBranchSync('agent/task-123');
```

Protected branches (main, master, lane/\*) are **never** bypassed, regardless of patterns.

## API Reference

### GitAdapter

| Method                              | Description                           |
| ----------------------------------- | ------------------------------------- |
| `getStatus()`                       | Get normalized git status information |
| `isClean()`                         | Check if working tree has no changes  |
| `add(files)`                        | Add files to staging area             |
| `commit(message)`                   | Commit staged changes                 |
| `push(options?)`                    | Push to remote repository             |
| `mergeFastForward(branch)`          | Fast-forward only merge               |
| `getCurrentBranch()`                | Get current branch name               |
| `branchExists(branch)`              | Check if branch exists                |
| `fetch(options?)`                   | Fetch from remote                     |
| `getCommitHash(ref?)`               | Get commit hash for ref               |
| `createBranch(branch, startPoint?)` | Create and checkout new branch        |
| `checkout(branch)`                  | Checkout existing branch              |
| `deleteBranch(branch, options?)`    | Delete a branch                       |
| `raw(args)`                         | Execute raw git command               |

### WorktreeManager

| Method                   | Description                     |
| ------------------------ | ------------------------------- |
| `create(options)`        | Create worktree with new branch |
| `remove(path, options?)` | Remove worktree safely          |
| `list()`                 | List all worktrees              |
| `exists(path)`           | Check if worktree exists        |

## Features

- **Type-safe**: Full TypeScript support with detailed type definitions
- **Dependency injection**: Easy to test with mock git instances
- **Safe worktree cleanup**: Handles orphan directories and corrupted metadata
- **Modern**: Node 22+, ESM-only, strict TypeScript

## Status

This package is under active development. Current features:

- Git operations (GitAdapter)
- Worktree management (WorktreeManager)
- Modern tooling (Node 22, ESLint 9, TypeScript 5.7, Vitest 4)
- Security and code quality linting

## License

Apache-2.0
