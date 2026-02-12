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

Generate deterministic context blocks for `wu:brief` prompts:

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

#### Decay-Based Ranking (WU-1238)

Enable decay-based ranking to prioritize memories by relevance rather than recency:

```typescript
const result = await generateContext('/path/to/project', {
  wuId: 'WU-123',
  sortByDecay: true, // Sort by decay score instead of recency
  trackAccess: true, // Track access for included nodes
});

console.log(result.stats.accessTracked); // Number of nodes with access tracked
```

Decay scoring considers:

- **Recency**: Exponential decay based on age (half-life: 30 days default)
- **Access frequency**: Boost for frequently accessed nodes
- **Priority**: P0=2x, P1=1.5x, P2=1x, P3=0.5x multiplier

### Access Tracking and Decay Scoring (WU-1238)

Track memory access patterns and compute decay scores for relevance management:

```typescript
import {
  recordAccess,
  recordAccessBatch,
  getAccessStats,
  computeDecayScore,
  DEFAULT_HALF_LIFE_MS,
  IMPORTANCE_BY_PRIORITY,
} from '@lumenflow/memory';

// Record access for a single node
const updated = await recordAccess('/path/to/project', 'mem-abc1');
console.log(updated.metadata.access.count); // Incremented
console.log(updated.metadata.access.last_accessed_at); // ISO timestamp

// Record access for multiple nodes (efficient batch operation)
const updatedNodes = await recordAccessBatch('/path/to/project', ['mem-abc1', 'mem-def2']);

// Get access statistics
const stats = await getAccessStats('/path/to/project', 'mem-abc1');
console.log(stats?.count, stats?.last_accessed_at);

// Compute decay score for a node
const score = computeDecayScore(node, {
  now: Date.now(),
  halfLifeMs: DEFAULT_HALF_LIFE_MS, // 30 days
});
```

Decay scoring formula:

```
decayScore = recencyScore * (1 + accessScore) * importanceScore

Where:
- recencyScore = exp(-age / halfLife)
- accessScore = log1p(access_count) / 10
- importanceScore = { P0: 2, P1: 1.5, P2: 1, P3: 0.5 }
```

### Archival by Decay (WU-1238)

Archive stale nodes with low decay scores:

```typescript
import { archiveByDecay, isArchived, DEFAULT_DECAY_THRESHOLD } from '@lumenflow/memory';

// Archive nodes below threshold (default: 0.1)
const result = await archiveByDecay('/path/to/project', {
  threshold: 0.1,
  dryRun: true, // Preview without modifying
});

console.log(result.archivedIds); // Nodes that would be archived
console.log(result.retainedIds); // Nodes above threshold
console.log(result.skippedIds); // Already archived or protected nodes

// Execute archival
await archiveByDecay('/path/to/project', { threshold: 0.1 });

// Check if a node is archived
if (isArchived(node)) {
  console.log('Node has metadata.status = archived');
}
```

Archival rules:

- Nodes below threshold get `metadata.status = 'archived'`
- Project lifecycle nodes are never archived (protected)
- Already archived nodes are skipped
- Nothing is deleted (append-only pattern)

### Memory Cleanup with Decay (WU-1238)

The `cleanupMemory` function now supports decay-based archival:

```typescript
import { cleanupMemory } from '@lumenflow/memory';

// Run cleanup with decay archival
const result = await cleanupMemory('/path/to/project', {
  decay: true,
  decayThreshold: 0.1, // Archive nodes below this score
  halfLifeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  dryRun: true, // Preview first
});

console.log(result.breakdown.decayArchived); // Number of nodes archived by decay
console.log(result.decayResult); // Detailed archival result
```

### Including Archived Nodes (WU-1238)

By default, queries exclude archived nodes. Use `includeArchived` to include them:

```typescript
import { loadMemory, queryReady, queryByWu } from '@lumenflow/memory';

// Load including archived nodes
const allMemory = await loadMemory('/path/to/project', { includeArchived: true });

// Query including archived nodes
const allNodes = await queryReady('/path/to/project', 'WU-123', { includeArchived: true });
const allWuNodes = await queryByWu('/path/to/project', 'WU-123', { includeArchived: true });
```

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

| Function                         | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `generateContext(baseDir, opts)` | Generate formatted context block for `wu:brief` |

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
- `sortByDecay` (optional): Sort by decay score instead of recency (default: false)
- `trackAccess` (optional): Track access for included nodes (default: false)
- `halfLifeMs` (optional): Half-life for decay calculation (default: 30 days)
- `now` (optional): Current timestamp for decay calculation (default: Date.now())

### Access Tracking (WU-1238)

| Function                              | Description                                  |
| ------------------------------------- | -------------------------------------------- |
| `recordAccess(baseDir, nodeId)`       | Record access for a single node              |
| `recordAccessBatch(baseDir, nodeIds)` | Record access for multiple nodes (efficient) |
| `getAccessStats(baseDir, nodeId)`     | Get access statistics for a node             |

### Decay Scoring (WU-1238)

| Function                         | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `computeDecayScore(node, opts)`  | Compute overall decay score for a node           |
| `computeRecencyScore(node, ...)` | Compute recency component (exponential decay)    |
| `computeAccessScore(node)`       | Compute access component (logarithmic boost)     |
| `computeImportanceScore(node)`   | Compute importance component (priority-based)    |
| `DEFAULT_HALF_LIFE_MS`           | Default half-life: 30 days in milliseconds       |
| `IMPORTANCE_BY_PRIORITY`         | Priority multipliers: P0=2, P1=1.5, P2=1, P3=0.5 |

### Archival (WU-1238)

| Function                        | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `archiveByDecay(baseDir, opts)` | Archive nodes below decay threshold            |
| `isArchived(node)`              | Check if node has metadata.status = 'archived' |
| `DEFAULT_DECAY_THRESHOLD`       | Default threshold: 0.1                         |

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
- **Decay scoring** (WU-1238): Relevance management based on recency, access frequency, and priority
- **Access tracking** (WU-1238): Track node access patterns for decay scoring
- **Archival** (WU-1238): Archive stale nodes without deletion (append-only pattern)

## Documentation

For complete documentation, see the [LumenFlow documentation](https://github.com/hellmai/os).

## License

Apache-2.0
