# Tool Core Library

**Purpose:** Unified tool abstraction layer providing schema validation, context guards, scope enforcement, and audit logging for all tool operations.

Part of INIT-004: LumenFlow Super Workflow initiative.

## Overview

The core library provides foundational components that integrate to form a complete tool execution pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│                       tool-runner.mjs                           │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────────┐    │
│  │ tool.schemas│  │ worktree-guard │  │  scope-checker    │    │
│  │  (Zod)      │  │  (WU context)  │  │  (code_paths)     │    │
│  └──────┬──────┘  └───────┬────────┘  └─────────┬─────────┘    │
│         │                 │                      │              │
│         └─────────────────┴──────────────────────┘              │
│                           │                                     │
│                    ┌──────▼──────┐                              │
│                    │ Audit Log   │                              │
│                    │ (telemetry) │                              │
│                    └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### tool-runner.mjs

Higher-order function pattern for executing tools with full validation pipeline.

**Exports:**

- `runTool(tool, input, options)` - Execute a tool with validation and guards
- `ToolRunner` - Registry class for managing multiple tools
- `createToolConfig(tool, options)` - Create config with sensible defaults
- `RUNNER_DEFAULTS` - Default configuration values

**Usage:**

```javascript
import { runTool, ToolRunner } from './tool-runner.mjs';

// Direct invocation
const result = await runTool(myTool, { path: 'src/file.ts' });

// Registry-based invocation
const runner = new ToolRunner();
runner.register(myTool);
const result = await runner.run('tool:name', { arg: 'value' });
```

**Execution Pipeline:**

1. **Input Validation** - Zod schema validation with helpful error messages
2. **Worktree Check** - Ensures write ops happen in worktree (not on main)
3. **Scope Check** - Validates file paths against WU code_paths
4. **Execute** - Runs the tool function
5. **Output Validation** - Validates output schema if defined
6. **Audit Log** - Records execution for telemetry

### tool.schemas.ts

Zod schemas for tool definitions and I/O validation.

**Exports:**

- `ToolMetadataSchema` - Tool metadata (name, version, domain, permission)
- `ToolInputSchema` - Base input schema (extensible)
- `ToolOutputSchema` - Output format (success/failure envelope)
- `ToolDefinitionSchema` - Complete tool definition
- `validateToolInput(input, schema)` - Validate against Zod schema
- `createSuccessOutput(data, metadata)` - Create success response
- `createErrorOutput(error, metadata)` - Create error response

### tool.constants.ts

Shared constants and enums.

**Exports:**

- `TOOL_DOMAINS` - Domain categories (wu, git, file, explore, test, etc.)
- `PERMISSION_LEVELS` - Access levels (read, write, admin)
- `TOOL_ERROR_CODES` - Error code enumeration
- `TOOL_STATUS` - Execution status values
- `DEFAULT_TOOL_TIMEOUT_MS` - Default timeout (30s)
- `MAX_TOOL_RETRIES` - Max retry count (3)

### worktree-guard.mjs

WU context detection and main branch protection.

**Exports:**

- `isInWorktree(options)` - Check if in worktree directory
- `getWUContext(options)` - Extract WU ID and lane from path/branch
- `assertWorktreeRequired(options)` - Throw if not in worktree
- `isMainBranch(options)` - Check if on main/master

**Usage:**

```javascript
import { getWUContext, assertWorktreeRequired } from './worktree-guard.mjs';

// Get current WU context
const ctx = await getWUContext();
if (ctx) {
  console.log(`Working on ${ctx.wuId} in ${ctx.lane}`);
}

// Enforce worktree for write operations
await assertWorktreeRequired({ operation: 'file-write' });
```

### scope-checker.mjs

Code path validation against WU scope.

**Exports:**

- `getActiveScope(deps)` - Get current WU scope from YAML
- `isPathInScope(path, scope)` - Check if path matches code_paths
- `assertPathInScope(path, scope, operation)` - Throw if out of scope

**Usage:**

```javascript
import { getActiveScope, isPathInScope } from './scope-checker.mjs';

const scope = await getActiveScope();
if (scope && !isPathInScope('apps/web/src/file.tsx', scope)) {
  throw new Error('Path outside WU scope');
}
```

**Glob Pattern Support:**

- `tools/lib/*.mjs` - Single-level wildcard
- `tools/lib/**/*.mjs` - Recursive wildcard
- `src/**/*.{ts,tsx}` - Brace expansion

## Configuration

### Tool Definition

Tools must conform to `ToolDefinitionSchema`:

```javascript
const myTool = {
  metadata: {
    name: 'file:read',
    version: '1.0.0',
    description: 'Read file contents',
    domain: TOOL_DOMAINS.FILE,
    permission: PERMISSION_LEVELS.READ,
  },
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  outputSchema: z.object({
    content: z.string(),
  }),
  execute: async (input) => {
    const content = await fs.readFile(input.path, 'utf-8');
    return createSuccessOutput({ content });
  },
};
```

### Runner Options

```javascript
const result = await runTool(tool, input, {
  // Dependency injection (for testing)
  dependencies: {
    getWUContext: mockGetWUContext,
    getActiveScope: mockGetActiveScope,
    isPathInScope: mockIsPathInScope,
    assertWorktreeRequired: mockAssertWorktree,
    logAudit: mockLogAudit,
  },

  // Configuration overrides
  config: {
    requiresWorktree: true, // Default: inferred from permission
    requiresScope: true, // Default: inferred from permission
    enableAuditLog: true, // Default: true
    timeoutMs: 60000, // Default: 30000
  },

  // Execution context
  context: {
    sessionId: 'abc123',
    agentId: 'agent-1',
  },
});
```

## Error Handling

All errors return structured `ToolOutput` with `success: false`:

```javascript
{
  success: false,
  error: {
    code: 'SCHEMA_VALIDATION_FAILED',
    message: 'Input validation failed for file:read',
    details: { issues: [...] },
    tryNext: [
      "Field 'path': Required",
      "Run with --help to see valid arguments for file:read"
    ]
  },
  metadata: {
    startedAt: '2024-01-15T10:30:00.000Z',
    durationMs: 5
  }
}
```

### Error Codes

| Code                       | Meaning                        |
| -------------------------- | ------------------------------ |
| `TOOL_NOT_FOUND`           | Tool not in registry           |
| `SCHEMA_VALIDATION_FAILED` | Input/output schema invalid    |
| `PERMISSION_DENIED`        | Worktree or scope check failed |
| `EXECUTION_FAILED`         | Tool threw during execution    |
| `INVALID_OUTPUT`           | Tool output failed schema      |
| `TIMEOUT`                  | Execution exceeded timeout     |
| `NOT_AVAILABLE`            | Tool not available in context  |

## Testing

```bash
# Run core library tests
pnpm vitest run tools/lib/core/__tests__/

# Run specific test file
pnpm vitest run tools/lib/core/__tests__/tool-runner.test.mjs
```

### Test Patterns

All components support dependency injection for testing:

```javascript
import { runTool } from './tool-runner.mjs';

const mockDeps = {
  getWUContext: async () => ({
    wuId: 'WU-123',
    lane: 'operations',
    worktreePath: 'worktrees/operations-wu-123',
  }),
  assertWorktreeRequired: async () => {}, // No-op for test
  getActiveScope: async () => ({
    wuId: 'WU-123',
    code_paths: ['tools/**/*.mjs'],
  }),
  isPathInScope: () => true,
  logAudit: () => {}, // No-op
};

const result = await runTool(tool, input, { dependencies: mockDeps });
```

## Architecture

### Hexagonal Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                        DOMAIN LAYER                             │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │ tool.schemas.ts │  │ tool.constants  │                       │
│  │ (Zod schemas)   │  │ (enums/consts)  │                       │
│  └─────────────────┘  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   tool-runner.mjs                        │    │
│  │  - runTool() orchestration                               │    │
│  │  - ToolRunner registry class                             │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     INFRASTRUCTURE LAYER                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐   │
│  │ worktree-guard  │  │  scope-checker  │  │  audit-logger  │   │
│  │ (git/fs access) │  │ (YAML parsing)  │  │  (telemetry)   │   │
│  └─────────────────┘  └─────────────────┘  └────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Injection

All external dependencies are injected via `options.dependencies`, enabling:

- Unit testing with mocks
- Integration testing with real implementations
- Future adapter swapping (different git providers, etc.)

## Cross-References

- **INIT-004:** LumenFlow Super Workflow initiative
- **WU-1394:** Tool constants and schemas
- **WU-1395:** Audit logger foundation
- **WU-1396:** Worktree guard module
- **WU-1397:** Scope checker module
- **WU-1398:** Tool runner (this integration)

## Future Enhancements

- **Timeout enforcement** - AbortController-based cancellation
- **Retry logic** - Automatic retries for transient failures
- **Provider adapters** - MCP, OpenAI function calling, etc.
- **Telemetry integration** - Write to `.beacon/telemetry/tools.ndjson`
