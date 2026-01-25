# Migration Guide: Hexagonal Architecture in @lumenflow/core

This guide helps external consumers of `@lumenflow/core` migrate to the hexagonal architecture introduced in INIT-002 and leverage dependency injection for custom implementations.

## Overview

The hexagonal architecture introduces:

- **Port interfaces**: Abstractions defining required capabilities
- **Adapter classes**: Concrete implementations of ports
- **Use case classes**: Business logic with constructor injection
- **Factory functions**: Convenient wiring with optional overrides
- **Backwards compatible functions**: Original API preserved

## Quick Start

### Before (v1.x - Monolithic)

```typescript
// Old approach: Direct function calls, no customization
import { computeWuContext, validateCommand, analyzeRecoveryIssues } from '@lumenflow/core';

const context = await computeWuContext({ wuId: 'WU-1095' });
const validation = await validateCommand('wu:done', context);
const recovery = await analyzeRecoveryIssues(context);
```

### After (v2.x - Hexagonal)

```typescript
// New approach: Same convenience functions still work!
import { computeWuContext, validateCommand, analyzeRecoveryIssues } from '@lumenflow/core';

// Unchanged - backwards compatible
const context = await computeWuContext({ wuId: 'WU-1095' });
const validation = await validateCommand('wu:done', context);
const recovery = await analyzeRecoveryIssues(context);
```

**No migration required** if you use the convenience functions. They now use the hexagonal architecture internally.

## Leveraging Dependency Injection

### Level 1: Factory Functions (Recommended)

Use factory functions for simple customization:

```typescript
import {
  createComputeContextUseCase,
  createValidateCommandUseCase,
  createAnalyzeRecoveryUseCase,
} from '@lumenflow/core';

// Use defaults
const computeContext = createComputeContextUseCase();
const validateCommand = createValidateCommandUseCase();
const analyzeRecovery = createAnalyzeRecoveryUseCase();

// Execute
const context = await computeContext.execute({ wuId: 'WU-1095' });
```

### Level 2: Custom Adapters for Testing

Inject mock adapters for deterministic testing:

```typescript
import { createComputeContextUseCase } from '@lumenflow/core';
import type { ILocationResolver } from '@lumenflow/core';

const mockLocationResolver: ILocationResolver = {
  resolveLocation: async () => ({
    type: 'main',
    cwd: '/test/repo',
    gitRoot: '/test/repo',
    mainCheckout: '/test/repo',
    worktreeName: null,
    worktreeWuId: null,
  }),
};

const useCase = createComputeContextUseCase({
  locationResolver: mockLocationResolver,
  // Other adapters use defaults
});

// Tests are now deterministic
const context = await useCase.execute({});
expect(context.location.type).toBe('main');
```

### Level 3: Manual Wiring (Full Control)

Create use cases manually for complete control:

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

// Manual wiring
const computeContext = new ComputeContextUseCase(
  new SimpleGitLocationAdapter(),
  new SimpleGitStateAdapter(),
  new FileSystemWuStateAdapter(),
);

const validateCommand = new ValidateCommandUseCase(new CommandRegistryAdapter());

const analyzeRecovery = new AnalyzeRecoveryUseCase(new RecoveryAnalyzerAdapter());
```

## Custom Adapter Examples

### Custom Location Resolver (CI/CD)

For CI/CD environments where git worktrees may not be available:

```typescript
import type { ILocationResolver, LocationContext } from '@lumenflow/core';

class CILocationResolver implements ILocationResolver {
  constructor(private readonly repoPath: string) {}

  async resolveLocation(cwd?: string): Promise<LocationContext> {
    // CI always runs in main checkout
    return {
      type: 'main',
      cwd: cwd || this.repoPath,
      gitRoot: this.repoPath,
      mainCheckout: this.repoPath,
      worktreeName: null,
      worktreeWuId: null,
    };
  }
}

// Usage
const useCase = createComputeContextUseCase({
  locationResolver: new CILocationResolver('/github/workspace'),
});
```

### In-Memory WU State (Testing)

For tests that need deterministic WU state:

```typescript
import type { IWuStateReader, WuStateResult } from '@lumenflow/core';

class InMemoryWuStateReader implements IWuStateReader {
  private readonly wuStates: Map<string, WuStateResult>;

  constructor(states: Array<WuStateResult> = []) {
    this.wuStates = new Map(states.map((s) => [s.id.toUpperCase(), s]));
  }

  async readWuState(wuId: string, _repoRoot: string): Promise<WuStateResult | null> {
    return this.wuStates.get(wuId.toUpperCase()) || null;
  }

  // Helper for test setup
  setWuState(state: WuStateResult): void {
    this.wuStates.set(state.id.toUpperCase(), state);
  }
}

// Usage in tests
const wuStateReader = new InMemoryWuStateReader([
  {
    id: 'WU-1095',
    status: 'in_progress',
    lane: 'Content: Documentation',
    title: 'Test WU',
    yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1095.yaml',
    isConsistent: true,
    inconsistencyReason: null,
  },
]);

const useCase = createComputeContextUseCase({
  wuStateReader,
});
```

### Mock Git State (Deterministic Tests)

For tests that need predictable git state:

```typescript
import type { IGitStateReader, GitState } from '@lumenflow/core';

class MockGitStateReader implements IGitStateReader {
  constructor(private readonly state: GitState) {}

  async readGitState(_cwd?: string): Promise<GitState> {
    return this.state;
  }
}

// Clean state
const cleanGitState = new MockGitStateReader({
  branch: 'main',
  isDetached: false,
  isDirty: false,
  hasStaged: false,
  ahead: 0,
  behind: 0,
  tracking: 'origin/main',
  modifiedFiles: [],
  hasError: false,
  errorMessage: null,
});

// Dirty state
const dirtyGitState = new MockGitStateReader({
  branch: 'lane/operations/wu-1095',
  isDetached: false,
  isDirty: true,
  hasStaged: true,
  ahead: 3,
  behind: 0,
  tracking: 'origin/lane/operations/wu-1095',
  modifiedFiles: ['src/foo.ts', 'src/bar.ts'],
  hasError: false,
  errorMessage: null,
});
```

### Custom Command Registry

Extend or replace the command registry:

```typescript
import type { ICommandRegistry, CommandDefinition, WuContext } from '@lumenflow/core';
import { CommandRegistryAdapter, COMMAND_REGISTRY } from '@lumenflow/core';

class ExtendedCommandRegistry implements ICommandRegistry {
  private readonly baseRegistry = new CommandRegistryAdapter();
  private readonly customCommands: Map<string, CommandDefinition>;

  constructor(customCommands: Array<CommandDefinition> = []) {
    this.customCommands = new Map(customCommands.map((c) => [c.name, c]));
  }

  getCommandDefinition(command: string): CommandDefinition | null {
    // Check custom commands first
    const custom = this.customCommands.get(command);
    if (custom) return custom;

    // Fall back to base registry
    return this.baseRegistry.getCommandDefinition(command);
  }

  getValidCommandsForContext(context: WuContext): CommandDefinition[] {
    const baseCommands = this.baseRegistry.getValidCommandsForContext(context);
    const customValid = Array.from(this.customCommands.values()).filter((cmd) =>
      this.isValidForContext(cmd, context),
    );
    return [...baseCommands, ...customValid];
  }

  getAllCommands(): CommandDefinition[] {
    return [...this.baseRegistry.getAllCommands(), ...Array.from(this.customCommands.values())];
  }

  private isValidForContext(cmd: CommandDefinition, context: WuContext): boolean {
    // Custom validation logic
    return true;
  }
}
```

## Port Interface Reference

### ILocationResolver

```typescript
interface ILocationResolver {
  resolveLocation(cwd?: string): Promise<LocationContext>;
}

interface LocationContext {
  type: 'main' | 'worktree' | 'detached' | 'unknown';
  cwd: string;
  gitRoot: string;
  mainCheckout: string;
  worktreeName: string | null;
  worktreeWuId: string | null;
}
```

### IGitStateReader

```typescript
interface IGitStateReader {
  readGitState(cwd?: string): Promise<GitState>;
}

interface GitState {
  branch: string | null;
  isDetached: boolean;
  isDirty: boolean;
  hasStaged: boolean;
  ahead: number;
  behind: number;
  tracking: string | null;
  modifiedFiles: string[];
  hasError: boolean;
  errorMessage: string | null;
}
```

### IWuStateReader

```typescript
interface IWuStateReader {
  readWuState(wuId: string, repoRoot: string): Promise<WuStateResult | null>;
}

interface WuStateResult {
  id: string;
  status: string;
  lane: string;
  title: string;
  yamlPath: string;
  isConsistent: boolean;
  inconsistencyReason: string | null;
}
```

### ICommandRegistry

```typescript
interface ICommandRegistry {
  getCommandDefinition(command: string): CommandDefinition | null;
  getValidCommandsForContext(context: WuContext): CommandDefinition[];
  getAllCommands(): CommandDefinition[];
}
```

### IRecoveryAnalyzer

```typescript
interface IRecoveryAnalyzer {
  analyzeRecovery(context: WuContext): Promise<RecoveryAnalysis>;
}

interface RecoveryAnalysis {
  hasIssues: boolean;
  issues: RecoveryIssue[];
  actions: RecoveryAction[];
  wuId: string | null;
}
```

## Testing Best Practices

### 1. Use Factory Functions with Mocks

```typescript
describe('ComputeContextUseCase', () => {
  it('should detect worktree context', async () => {
    const mockLocation: ILocationResolver = {
      resolveLocation: async () => ({
        type: 'worktree',
        cwd: '/test/worktrees/ops-wu-1095',
        gitRoot: '/test/worktrees/ops-wu-1095',
        mainCheckout: '/test',
        worktreeName: 'ops-wu-1095',
        worktreeWuId: 'WU-1095',
      }),
    };

    const useCase = createComputeContextUseCase({
      locationResolver: mockLocation,
    });

    const context = await useCase.execute({ wuId: 'WU-1095' });

    expect(context.location.type).toBe('worktree');
    expect(context.location.worktreeWuId).toBe('WU-1095');
  });
});
```

### 2. Avoid Mocking Implementation Details

```typescript
// Bad: Mocking internal git command execution
vi.mock('simple-git', () => ({
  simpleGit: () => ({
    status: vi.fn().mockResolvedValue({ ... }),
  }),
}));

// Good: Inject mock adapter at port level
const mockGitState: IGitStateReader = {
  readGitState: async () => ({ ... }),
};
```

### 3. Use Type-Safe Mocks

```typescript
import type { ILocationResolver } from '@lumenflow/core';

// TypeScript ensures mock matches interface
const mockResolver: ILocationResolver = {
  resolveLocation: vi.fn().mockResolvedValue({
    type: 'main',
    cwd: '/test',
    gitRoot: '/test',
    mainCheckout: '/test',
    worktreeName: null,
    worktreeWuId: null,
  }),
};
```

## Troubleshooting

### "Cannot find module '@lumenflow/core'"

Ensure you have the latest version:

```bash
pnpm add @lumenflow/core@latest
```

### "Property 'xxx' does not exist on type 'ILocationResolver'"

Your mock doesn't implement all required methods. Check the interface definition.

### "Type 'xxx' is not assignable to type 'ILocationResolver'"

Your mock returns incorrect types. Ensure all properties match the expected types.

## Further Reading

- [ADR-001: Hexagonal Architecture Decision](./ADR-001-hexagonal-architecture.md)
- [@lumenflow/core README](../../packages/@lumenflow/core/README.md)
- [Hexagonal Architecture (Alistair Cockburn)](https://alistair.cockburn.us/hexagonal-architecture/)
