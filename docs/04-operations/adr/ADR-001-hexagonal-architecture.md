# ADR-001: Hexagonal Architecture for @lumenflow/core

**Status:** Accepted
**Date:** 2026-01-25
**Authors:** Tom @ HellmAI
**Initiative:** INIT-002 (Hexagonal Architecture Migration)

## Context

The `@lumenflow/core` package provides the WU lifecycle tooling for LumenFlow. As the package matured, several challenges emerged:

1. **Tight coupling**: Business logic was directly coupled to infrastructure (git operations, file system access, YAML parsing).

2. **Testing difficulty**: Testing use cases required mocking implementation details rather than interfaces. Tests were brittle and broke when internal implementations changed.

3. **Limited extensibility**: External consumers could not easily inject custom implementations for their environments (different git providers, alternative state stores, custom validation rules).

4. **Monolithic functions**: Large functions handled context computation, validation, and recovery analysis without clear boundaries.

## Decision

We adopt **Hexagonal Architecture** (also known as Ports & Adapters) for the context-aware validation system in `@lumenflow/core`.

### Architecture Layers

```
+---------------------------+
|        Use Cases          |  Application layer (orchestration)
|  ComputeContextUseCase    |
|  ValidateCommandUseCase   |
|  AnalyzeRecoveryUseCase   |
+------------+--------------+
             |
             | depends on
             v
+---------------------------+
|      Port Interfaces      |  Abstractions (contracts)
|    ILocationResolver      |
|    IGitStateReader        |
|    IWuStateReader         |
|    ICommandRegistry       |
|    IRecoveryAnalyzer      |
+------------+--------------+
             ^
             | implements
             |
+---------------------------+
|     Adapter Classes       |  Infrastructure layer
|  SimpleGitLocationAdapter |
|  SimpleGitStateAdapter    |
|  FileSystemWuStateAdapter |
|  CommandRegistryAdapter   |
|  RecoveryAnalyzerAdapter  |
+---------------------------+
```

### Key Principles

1. **Ports define contracts**: Port interfaces in `src/ports/` define what capabilities the application needs, not how they are implemented.

2. **Adapters implement ports**: Concrete adapters in `src/adapters/` implement port interfaces using specific technologies (simple-git, fs, YAML parser).

3. **Use cases orchestrate**: Use case classes in `src/usecases/` receive dependencies via constructor injection and coordinate business logic.

4. **Dependency Injection**: Factory functions in `context-di.ts` (the composition root) wire adapters to use cases.

5. **Inversion of Control**: Use cases depend on abstractions (ports), not concrete implementations (adapters). This inverts the traditional dependency flow.

### Golden Rule

> **Application layer (use cases) NEVER imports infrastructure layer (adapters) directly.**
>
> Dependencies flow inward: adapters implement ports, use cases depend on ports.

## Consequences

### Benefits

1. **Testability**: Use cases can be tested with mock adapters that implement port interfaces. No need to mock file system, git operations, or network calls.

2. **Extensibility**: External consumers can inject custom adapters:
   - CI/CD systems can use in-memory state stores
   - Test suites can use deterministic mock adapters
   - Alternative git providers (GitHub, GitLab, Bitbucket APIs) can be supported

3. **Maintainability**: Clear separation of concerns. Changes to git implementation don't affect validation logic.

4. **Backwards Compatibility**: Convenience functions (`computeWuContext`, `validateCommand`, `analyzeRecoveryIssues`) maintain the original API while using the new architecture internally.

### Trade-offs

1. **More files**: The architecture introduces additional files (ports, adapters, factory functions). This adds some navigation overhead.

2. **Indirection**: Following the flow requires understanding port -> adapter -> use case relationships.

3. **Learning curve**: Developers need to understand hexagonal architecture concepts.

### Migration Path

The migration was implemented incrementally across INIT-002 phases:

- **Phase 1 (WU-1093)**: Define port interfaces and domain schemas
- **Phase 2 (WU-1094)**: Implement adapter classes and use cases with DI
- **Phase 3 (WU-1095)**: Document architecture decision and migration guide

## Alternatives Considered

### 1. Keep Monolithic Functions

**Rejected**: Leads to untestable code and tight coupling. Every new feature increases complexity.

### 2. Simple Factory Functions

**Rejected**: Factory functions without interfaces don't enable proper dependency injection. Tests would still couple to implementation details.

### 3. Full DI Container (tsyringe, inversify)

**Rejected**: Adds heavyweight runtime dependency. TypeScript interfaces with manual factory functions provide sufficient DI for our needs without decorator metadata or container configuration.

## Examples

### Creating Use Cases with Default Adapters

```typescript
import {
  createComputeContextUseCase,
  createValidateCommandUseCase,
  createAnalyzeRecoveryUseCase,
} from '@lumenflow/core';

// Factory functions create fully wired instances
const computeContext = createComputeContextUseCase();
const validateCommand = createValidateCommandUseCase();
const analyzeRecovery = createAnalyzeRecoveryUseCase();

// Execute
const context = await computeContext.execute({ wuId: 'WU-1095' });
const validation = await validateCommand.execute('wu:done', context);
const recovery = await analyzeRecovery.execute(context);
```

### Injecting Custom Adapters for Testing

```typescript
import { ComputeContextUseCase } from '@lumenflow/core';
import type { ILocationResolver, IGitStateReader, IWuStateReader } from '@lumenflow/core';

// Mock adapters for testing
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

const mockGitState: IGitStateReader = {
  readGitState: async () => ({
    branch: 'lane/operations/wu-1095',
    isDetached: false,
    isDirty: false,
    hasStaged: false,
    ahead: 1,
    behind: 0,
    tracking: 'origin/lane/operations/wu-1095',
    modifiedFiles: [],
    hasError: false,
    errorMessage: null,
  }),
};

const mockWuState: IWuStateReader = {
  readWuState: async () => ({
    id: 'WU-1095',
    status: 'in_progress',
    lane: 'Content: Documentation',
    title: 'ADR for hex architecture',
    yamlPath: '/test/docs/04-operations/tasks/wu/WU-1095.yaml',
    isConsistent: true,
    inconsistencyReason: null,
  }),
};

// Create use case with mocks
const useCase = new ComputeContextUseCase(mockLocation, mockGitState, mockWuState);
const context = await useCase.execute({ wuId: 'WU-1095' });

// Assertions are deterministic - no real I/O
expect(context.location.type).toBe('worktree');
expect(context.wu?.status).toBe('in_progress');
```

### Using Factory Functions with Partial Overrides

```typescript
import { createComputeContextUseCase } from '@lumenflow/core';

// Override only the location resolver, use defaults for git and WU state
const useCase = createComputeContextUseCase({
  locationResolver: customLocationResolver,
  // gitStateReader and wuStateReader use defaults
});
```

## References

- [Hexagonal Architecture (Alistair Cockburn)](https://alistair.cockburn.us/hexagonal-architecture/)
- [Ports and Adapters Pattern](<https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)>)
- [@lumenflow/core README](../../packages/@lumenflow/core/README.md)
- [Port Interfaces Reference](../../apps/docs/src/content/docs/reference/ports.mdx)
- INIT-002 Work Units: WU-1093, WU-1094, WU-1095
