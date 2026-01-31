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

### Context Injection (WU-1234)

Generate deterministic context blocks for wu:spawn prompts:

```typescript
import { generateContext } from '@lumenflow/memory/context';

// Generate context for a WU
const result = await generateContext('/path/to/project', {
  wuId: 'WU-123',
  maxSize: 4096, // default: 4KB
});

console.log(result.contextBlock);
// <!-- mem:context for WU-123 -->
//
// ## Project Profile
// - [mem-abc1] (2025-01-15): Project architecture decision...
//
// ## WU Context
// - [mem-def2] (2025-01-20): Checkpoint: completed port definitions...
```

The context block includes:

- **Project Profile**: lifecycle=project memories (architectural knowledge)
- **Summaries**: summary-type nodes for the WU
- **WU Context**: checkpoints and notes linked to the WU
- **Discoveries**: discovered information for the WU

Selection is deterministic (filter by lifecycle, wu_id, recency). Max size is configurable (default 4KB). Returns empty block if no memories match.

### Knowledge Promotion (WU-1237)

Promote session/WU learnings to project-level knowledge:

```typescript
import { promoteNode, promoteFromWu, ALLOWED_PROMOTION_TAGS } from '@lumenflow/memory';

// Promote a single node to project-level
const result = await promoteNode('/path/to/project', {
  nodeId: 'mem-abc1',
  tag: 'pattern', // decision|convention|pattern|pitfall|interface|invariant|faq
});
console.log(`Promoted to ${result.promotedNode.id}`);

// Promote all summaries from a WU
const wuResult = await promoteFromWu('/path/to/project', {
  wuId: 'WU-123',
  tag: 'decision',
});
console.log(`Promoted ${wuResult.promotedNodes.length} summaries`);

// Dry-run mode (preview without writing)
const dryResult = await promoteNode('/path/to/project', {
  nodeId: 'mem-abc1',
  tag: 'pattern',
  dryRun: true,
});
```

Promotion creates:

- A new node with `lifecycle=project`
- A `discovered_from` relationship to the source node
- The specified taxonomy tag on the promoted node

Allowed tags: `decision`, `convention`, `pattern`, `pitfall`, `interface`, `invariant`, `faq`.

### Project Profile (WU-1237)

Generate aggregated project knowledge for context injection:

```typescript
import { generateProfile, DEFAULT_PROFILE_LIMIT } from '@lumenflow/memory';

// Get top 20 project memories (default)
const result = await generateProfile('/path/to/project');
console.log(result.profileBlock);
// ## Project Profile
// - [mem-abc1] (2025-01-15): Architecture decision...
// - [mem-def2] (2025-01-20): Naming convention...

// Filter by tag
const decisions = await generateProfile('/path/to/project', {
  tag: 'decision',
  limit: 10,
});

// Access statistics
console.log(result.stats.totalProjectNodes);
console.log(result.stats.byTag); // { decision: 5, pattern: 3, ... }
```

The profile output is formatted for integration with `mem:context`.

### Project Indexing (WU-1235)

Index project conventions for agent context awareness:

```typescript
import { indexProject, getDefaultSources } from '@lumenflow/memory/index';

// Index project conventions
const result = await indexProject('/path/to/project');
console.log(`Created: ${result.nodesCreated}, Updated: ${result.nodesUpdated}`);

// Dry-run mode (no writes)
const dryResult = await indexProject('/path/to/project', { dryRun: true });
console.log('Would index:', dryResult.sourcesScanned);

// Get default sources that will be scanned
const sources = getDefaultSources();
// ['README.md', 'LUMENFLOW.md', 'package.json', ...]
```

Default sources scanned:

- **README.md**: Project overview (tagged: `index:architecture`)
- **LUMENFLOW.md**: Workflow conventions (tagged: `index:conventions`)
- **package.json**: Monorepo structure (tagged: `index:architecture`)
- **.lumenflow.config.yaml**: Workflow config (tagged: `index:commands`, `index:conventions`)
- **.lumenflow/constraints.md**: Project invariants (tagged: `index:invariants`)

Each node includes provenance metadata: `source_path`, `source_hash`, `indexed_at`.
Idempotent: re-running updates or skips existing nodes based on content hash.

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
import { generateContext } from '@lumenflow/memory/context';
import { indexProject } from '@lumenflow/memory/index';
import { MemoryNodeSchema } from '@lumenflow/memory/schema';
import { loadMemory, appendNode } from '@lumenflow/memory/store';
```

## API Reference

### Memory Store

| Function                    | Description                                |
| --------------------------- | ------------------------------------------ |
| `loadMemory(baseDir)`       | Load and index all memory nodes from JSONL |
| `appendNode(baseDir, node)` | Append a validated node to the memory file |
| `queryReady(baseDir, wuId)` | Get nodes for WU in priority order         |
| `queryByWu(baseDir, wuId)`  | Get all nodes for WU in file order         |

### Context Injection

| Function                         | Description                                   |
| -------------------------------- | --------------------------------------------- |
| `generateContext(baseDir, opts)` | Generate formatted context block for wu:spawn |

### Project Indexing

| Function                      | Description                           |
| ----------------------------- | ------------------------------------- |
| `indexProject(baseDir, opts)` | Scan sources and create summary nodes |
| `getDefaultSources()`         | Get list of default sources to scan   |

### Knowledge Promotion

| Function                       | Description                              |
| ------------------------------ | ---------------------------------------- |
| `promoteNode(baseDir, opts)`   | Promote single node to project lifecycle |
| `promoteFromWu(baseDir, opts)` | Promote all summaries from a WU          |
| `ALLOWED_PROMOTION_TAGS`       | Array of valid taxonomy tags             |

### Project Profile

| Function                         | Description                                   |
| -------------------------------- | --------------------------------------------- |
| `generateProfile(baseDir, opts)` | Generate aggregated project knowledge profile |
| `DEFAULT_PROFILE_LIMIT`          | Default limit for profile generation (20)     |

Options for `indexProject`:

- `dryRun` (optional): If true, show what would be indexed without writing (default: false)
- `additionalSources` (optional): Additional source definitions to scan

Options for `generateContext`:

- `wuId` (required): WU ID to generate context for
- `maxSize` (optional): Maximum context size in bytes (default: 4096)

### Memory Schema

| Export                       | Description                               |
| ---------------------------- | ----------------------------------------- |
| `MemoryNodeSchema`           | Zod schema for memory nodes               |
| `RelationshipSchema`         | Zod schema for node relationships         |
| `validateMemoryNode(data)`   | Validate data against node schema         |
| `validateRelationship(data)` | Validate data against relationship schema |
| `MEMORY_NODE_TYPES`          | Valid node types array                    |
| `MEMORY_LIFECYCLES`          | Valid lifecycle values array              |
| `RELATIONSHIP_TYPES`         | Valid relationship types array            |

### Types

```typescript
interface MemoryNode {
  id: string; // mem-[a-z0-9]{4}
  type: 'session' | 'discovery' | 'checkpoint' | 'note' | 'summary';
  lifecycle: 'ephemeral' | 'session' | 'wu' | 'project';
  content: string;
  created_at: string; // ISO 8601
  updated_at?: string;
  wu_id?: string; // WU-XXX
  session_id?: string; // UUID
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
