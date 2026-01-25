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

Check if a branch is an agent branch that can bypass worktree requirements. Patterns are fetched from a central registry with 7-day caching, and can be configured via `.lumenflow.config.yaml`.

```typescript
import { isAgentBranch, isAgentBranchWithDetails, resolveAgentPatterns } from '@lumenflow/core';

// Check if branch can bypass worktree requirements (async, uses registry)
if (await isAgentBranch('claude/session-12345')) {
  console.log('Agent branch - bypass allowed');
}

// Get detailed result for observability
const result = await isAgentBranchWithDetails('claude/session-123');
if (result.isMatch) {
  console.log(`Matched via ${result.patternResult.source}`); // 'registry', 'merged', 'override', 'config', 'defaults'
  console.log(`Registry fetched: ${result.patternResult.registryFetched}`);
}

// Resolve patterns with custom options (useful for testing)
const resolved = await resolveAgentPatterns({
  configPatterns: ['my-agent/*'], // Merge with registry
  // overridePatterns: ['only-this/*'], // Replace registry entirely
  // disableAgentPatternRegistry: true, // Airgapped mode
});
console.log(resolved.patterns, resolved.source);

// Synchronous version (uses local config only, no registry fetch)
import { isAgentBranchSync } from '@lumenflow/core';
const syncResult = isAgentBranchSync('agent/task-123');
```

#### Configuration Options

In `.lumenflow.config.yaml`:

```yaml
git:
  # Patterns to MERGE with registry (default: [])
  agentBranchPatterns:
    - 'my-custom-agent/*'
    - 'internal-tool/*'

  # Patterns that REPLACE registry entirely (optional)
  # agentBranchPatternsOverride:
  #   - 'claude/*'
  #   - 'codex/*'

  # Disable registry fetch for airgapped environments (default: false)
  # disableAgentPatternRegistry: true
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

### Context-Aware Validation Ports (WU-1093)

Port interfaces for context-aware validation system. These abstractions allow external users to inject custom implementations.

```typescript
import type {
  ILocationResolver,
  IGitStateReader,
  IWuStateReader,
  ICommandRegistry,
  IRecoveryAnalyzer,
} from '@lumenflow/core';
```

### Adapter Classes (WU-1094)

Concrete adapter implementations that wrap the existing functions:

```typescript
import {
  // Context adapters
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
  // Validation adapters
  CommandRegistryAdapter,
  // Recovery adapters
  RecoveryAnalyzerAdapter,
} from '@lumenflow/core';

// Create adapters implementing port interfaces
const locationResolver = new SimpleGitLocationAdapter();
const gitStateReader = new SimpleGitStateAdapter();
const wuStateReader = new FileSystemWuStateAdapter();
const commandRegistry = new CommandRegistryAdapter();
const recoveryAnalyzer = new RecoveryAnalyzerAdapter();

// Use adapters
const location = await locationResolver.resolveLocation();
const gitState = await gitStateReader.readGitState();
const wuState = await wuStateReader.readWuState('WU-1094', '/repo');
const cmdDef = commandRegistry.getCommandDefinition('wu:done');
const analysis = await recoveryAnalyzer.analyzeRecovery(context);
```

### Use Cases with Dependency Injection (WU-1094)

Use case classes with constructor injection enable testing with mock adapters:

```typescript
import {
  ComputeContextUseCase,
  ValidateCommandUseCase,
  AnalyzeRecoveryUseCase,
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
  CommandRegistryAdapter,
  RecoveryAnalyzerAdapter,
} from '@lumenflow/core';

// Manual wiring with real adapters
const computeContext = new ComputeContextUseCase(
  new SimpleGitLocationAdapter(),
  new SimpleGitStateAdapter(),
  new FileSystemWuStateAdapter(),
);

const validateCommand = new ValidateCommandUseCase(new CommandRegistryAdapter());

const analyzeRecovery = new AnalyzeRecoveryUseCase(new RecoveryAnalyzerAdapter());

// Execute use cases
const context = await computeContext.execute({ wuId: 'WU-1094' });
const validation = await validateCommand.execute('wu:done', context);
const recovery = await analyzeRecovery.execute(context);
```

### DI Factory Functions (WU-1094)

Factory functions create fully wired use cases with default or custom adapters:

```typescript
import {
  createComputeContextUseCase,
  createValidateCommandUseCase,
  createAnalyzeRecoveryUseCase,
} from '@lumenflow/core';

// Use defaults - simplest approach
const useCase = createComputeContextUseCase();
const context = await useCase.execute({ wuId: 'WU-1094' });

// Inject custom adapters for testing
const mockLocationResolver = {
  resolveLocation: async () => ({
    type: 'main' as const,
    cwd: '/test',
    gitRoot: '/test',
    mainCheckout: '/test',
    worktreeName: null,
    worktreeWuId: null,
  }),
};

const testUseCase = createComputeContextUseCase({
  locationResolver: mockLocationResolver,
  // gitStateReader and wuStateReader use defaults
});
```

### Convenience Functions (WU-1094)

For simple use cases, backwards compatible functions are available:

```typescript
import { computeWuContext, validateCommand, analyzeRecoveryIssues } from '@lumenflow/core';

// Compute context (uses default adapters internally)
const context = await computeWuContext({ wuId: 'WU-1094' });

// Validate a command
const validation = await validateCommand('wu:done', context);
if (!validation.valid) {
  console.error(validation.errors[0].message);
}

// Analyze for recovery issues
const recovery = await analyzeRecoveryIssues(context);
if (recovery.hasIssues) {
  for (const action of recovery.actions) {
    console.log(`Fix: ${action.command}`);
  }
}
```

### Domain Schemas (Zod)

Runtime validation schemas for domain types. Types are inferred from Zod schemas using `z.infer<>`.

```typescript
import {
  // Context schemas
  LocationContextSchema,
  GitStateSchema,
  WuStateResultSchema,
  SessionStateSchema,
  WuContextSchema,

  // Validation schemas
  ValidationErrorSchema,
  ValidationWarningSchema,
  ValidationResultSchema,
  CommandPredicateConfigSchema,
  CommandDefinitionConfigSchema,

  // Recovery schemas
  RecoveryIssueSchema,
  RecoveryActionSchema,
  RecoveryAnalysisSchema,

  // Types (inferred from schemas)
  type LocationContext,
  type GitState,
  type WuStateResult,
  type ValidationError,
  type RecoveryAnalysis,
} from '@lumenflow/core';

// Validate runtime data
const result = LocationContextSchema.safeParse(unknownData);
if (result.success) {
  const location: LocationContext = result.data;
  console.log(`Type: ${location.type}, CWD: ${location.cwd}`);
}
```

## Features

- **Type-safe**: Full TypeScript support with detailed type definitions
- **Dependency injection**: Easy to test with mock git instances
- **Hexagonal architecture**: Port interfaces for external injection
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
