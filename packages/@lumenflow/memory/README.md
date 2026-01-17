# @lumenflow/memory

Memory layer for LumenFlow workflow framework - session tracking, context recovery, and agent coordination.

## Installation

```bash
npm install @lumenflow/memory
```

## Overview

This package provides a persistent memory layer for AI agents working within the LumenFlow framework. It enables:

- **Session tracking**: Track agent sessions across context window boundaries
- **Context recovery**: Resume work after `/clear` or session handoff
- **Agent coordination**: Signal between parallel agents via inbox/outbox
- **Progress checkpoints**: Save state at milestones for recovery

## Usage

### Memory Store

The memory store uses JSONL format for git-friendly, append-only persistence.

```typescript
import { loadMemory, appendNode, queryReady, queryByWu } from '@lumenflow/memory';

// Load all memory nodes
const memory = await loadMemory('/path/to/project');
const node = memory.byId.get('mem-abc1');
const wuNodes = memory.byWu.get('WU-123') ?? [];

// Append a new node
await appendNode('/path/to/project', {
  id: 'mem-xyz9',
  type: 'checkpoint',
  lifecycle: 'wu',
  content: 'Completed port definitions',
  created_at: new Date().toISOString(),
  wu_id: 'WU-123',
});

// Query nodes ready for processing (priority-ordered)
const ready = await queryReady('/path/to/project', 'WU-123');

// Query all nodes for a WU (file order)
const nodes = await queryByWu('/path/to/project', 'WU-123');
```

### Memory Schema

Validate memory nodes against the schema:

```typescript
import {
  validateMemoryNode,
  MemoryNodeSchema,
  MEMORY_NODE_TYPES,
  MEMORY_LIFECYCLES,
} from '@lumenflow/memory';

// Node types: session, discovery, checkpoint, note, summary
// Lifecycles: ephemeral, session, wu, project

const result = validateMemoryNode(nodeData);
if (!result.success) {
  console.error(result.error.issues);
}
```

### Checkpoints

Create progress checkpoints for context recovery:

```typescript
import { createCheckpoint } from '@lumenflow/memory/checkpoint';

await createCheckpoint('/path/to/project', {
  wuId: 'WU-123',
  content: 'Completed acceptance criteria 1-3',
  metadata: { milestone: 'ports-complete' },
});
```

### Signals

Send and receive coordination signals between agents:

```typescript
import { sendSignal } from '@lumenflow/memory/signal';

// Signal completion to other agents
await sendSignal('/path/to/project', {
  wuId: 'WU-123',
  type: 'completion',
  content: 'WU-123 done, WU-124 unblocked',
});
```

## Subpath Exports

```typescript
// Main entry (all exports)
import { loadMemory, MemoryNodeSchema } from '@lumenflow/memory';

// Specific modules
import { createCheckpoint } from '@lumenflow/memory/checkpoint';
import { initMemory } from '@lumenflow/memory/init';
import { startSession } from '@lumenflow/memory/start';
import { queryReadyNodes } from '@lumenflow/memory/ready';
import { sendSignal } from '@lumenflow/memory/signal';
import { cleanupExpired } from '@lumenflow/memory/cleanup';
import { createMemoryNode } from '@lumenflow/memory/create';
import { summarizeWu } from '@lumenflow/memory/summarize';
import { triageBugs } from '@lumenflow/memory/triage';
import { MemoryNodeSchema } from '@lumenflow/memory/schema';
import { loadMemory, appendNode } from '@lumenflow/memory/store';
```

## API Reference

### Memory Store

| Function | Description |
|----------|-------------|
| `loadMemory(baseDir)` | Load and index all memory nodes from JSONL |
| `appendNode(baseDir, node)` | Append a validated node to the memory file |
| `queryReady(baseDir, wuId)` | Get nodes for WU in priority order |
| `queryByWu(baseDir, wuId)` | Get all nodes for WU in file order |

### Memory Schema

| Export | Description |
|--------|-------------|
| `MemoryNodeSchema` | Zod schema for memory nodes |
| `RelationshipSchema` | Zod schema for node relationships |
| `validateMemoryNode(data)` | Validate data against node schema |
| `validateRelationship(data)` | Validate data against relationship schema |
| `MEMORY_NODE_TYPES` | Valid node types array |
| `MEMORY_LIFECYCLES` | Valid lifecycle values array |
| `RELATIONSHIP_TYPES` | Valid relationship types array |

### Types

```typescript
interface MemoryNode {
  id: string;           // mem-[a-z0-9]{4}
  type: 'session' | 'discovery' | 'checkpoint' | 'note' | 'summary';
  lifecycle: 'ephemeral' | 'session' | 'wu' | 'project';
  content: string;
  created_at: string;   // ISO 8601
  updated_at?: string;
  wu_id?: string;       // WU-XXX
  session_id?: string;  // UUID
  metadata?: Record<string, unknown>;
  tags?: string[];
}

interface IndexedMemory {
  nodes: MemoryNode[];
  byId: Map<string, MemoryNode>;
  byWu: Map<string, MemoryNode[]>;
}
```

## Features

- **Append-only writes**: No full file rewrites, git-merge friendly
- **Indexed lookups**: O(1) access by ID and WU
- **Priority ordering**: Deterministic query results (P0 > P1 > P2 > P3)
- **Schema validation**: Zod-based runtime validation
- **Modern**: Node 22+, ESM-only, TypeScript

## Documentation

For complete documentation, see the [LumenFlow documentation](https://github.com/hellmai/os).

## License

Apache-2.0
