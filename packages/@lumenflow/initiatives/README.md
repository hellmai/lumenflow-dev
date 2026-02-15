# @lumenflow/initiatives

Initiative tracking for LumenFlow workflow framework - multi-phase project coordination.

## Installation

```bash
npm install @lumenflow/initiatives
```

## Overview

This package provides initiative management for coordinating multi-phase projects within LumenFlow. It enables:

- **Initiative tracking**: Define and track multi-WU projects
- **Dependency orchestration**: Build execution plans based on WU dependencies
- **Wave-based execution**: Group independent WUs for parallel execution
- **Progress monitoring**: Track completion status across phases

## Usage

### Loading Initiatives

```typescript
import { findInitiative, getInitiativeWUs, loadInitiativeWUs } from '@lumenflow/initiatives';

// Find an initiative by ID or slug
const init = findInitiative('INIT-007');
console.log(init?.doc.title, init?.doc.status);

// Get all WUs linked to an initiative
const wus = getInitiativeWUs('INIT-007');
for (const wu of wus) {
  console.log(`${wu.id}: ${wu.doc.status}`);
}

// Load initiative with its WUs
const { initiative, wus: linkedWUs } = loadInitiativeWUs('INIT-007');
```

### Building Execution Plans

```typescript
import { buildExecutionPlan, formatExecutionPlan } from '@lumenflow/initiatives';

// Build dependency-ordered waves
const plan = buildExecutionPlan(wus);

console.log(`${plan.waves.length} waves`);
console.log(`Skipped (done): ${plan.skipped.join(', ')}`);
console.log(`Deferred: ${plan.deferred.map((d) => d.id).join(', ')}`);

// Format for display
const output = formatExecutionPlan(initiative, plan);
console.log(output);
```

### Wave Orchestration

```typescript
import {
  buildCheckpointWave,
  formatCheckpointOutput,
  calculateProgress,
  formatProgress,
} from '@lumenflow/initiatives';

// Build next wave for checkpoint-per-wave execution
const wave = buildCheckpointWave('INIT-007');
if (wave) {
  console.log(`Wave ${wave.wave}: ${wave.wus.length} WUs`);
  console.log(formatCheckpointOutput(wave));
}

// Calculate progress statistics
const progress = calculateProgress(wus);
console.log(formatProgress(progress));
// Progress: [████████░░░░░░░░░░░░] 40%
//   Done: 4/10
//   Active: 2
//   Pending: 3
//   Blocked: 1
```

### Schema Validation

```typescript
import { validateInitiative, InitiativeSchema } from '@lumenflow/initiatives';

const result = validateInitiative(yamlData);
if (!result.success) {
  for (const issue of result.error.issues) {
    console.error(`${issue.path.join('.')}: ${issue.message}`);
  }
}
```

## Subpath Exports

```typescript
// Main entry (all exports)
import { findInitiative, buildExecutionPlan } from '@lumenflow/initiatives';

// Specific modules
import {
  loadInitiativeWUs,
  buildExecutionPlan,
  buildCheckpointWave,
  calculateProgress,
} from '@lumenflow/initiatives/orchestrator';
import { validateInitiativeDependencies } from '@lumenflow/initiatives/validator';
import { findInitiative, getInitiativeWUs } from '@lumenflow/initiatives/yaml';
import { InitiativeSchema, validateInitiative } from '@lumenflow/initiatives/schema';
import { INIT_STATUSES, PHASE_STATUSES, PRIORITIES } from '@lumenflow/initiatives/constants';
import { getInitiativePath, getInitiativesDir } from '@lumenflow/initiatives/paths';
```

## API Reference

### Orchestrator

| Function                        | Description                              |
| ------------------------------- | ---------------------------------------- |
| `loadInitiativeWUs(initRef)`    | Load initiative and its linked WUs       |
| `loadMultipleInitiatives(refs)` | Combine WUs from multiple initiatives    |
| `buildExecutionPlan(wus)`       | Build dependency-ordered execution waves |
| `buildCheckpointWave(initRef)`  | Build next wave for checkpoint execution |
| `calculateProgress(wus)`        | Calculate completion statistics          |
| `getBottleneckWUs(wus, limit?)` | Identify bottleneck WUs                  |
| `filterByDependencyStamps(wus)` | Filter WUs by dependency completion      |

### YAML Operations

| Function                | Description                     |
| ----------------------- | ------------------------------- |
| `findInitiative(ref)`   | Find initiative by ID or slug   |
| `getInitiativeWUs(ref)` | Get WUs linked to an initiative |
| `listInitiatives()`     | List all initiative files       |

### Validation

| Function                               | Description                  |
| -------------------------------------- | ---------------------------- |
| `validateInitiative(data)`             | Validate data against schema |
| `validateInitiativeDependencies(init)` | Validate WU dependencies     |

### Types

```typescript
interface Initiative {
  id: string; // INIT-NNN or INIT-NAME
  slug: string; // kebab-case identifier
  title: string;
  description?: string;
  status: 'proposed' | 'active' | 'paused' | 'completed' | 'cancelled';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  owner?: string;
  created: string; // YYYY-MM-DD
  target_date?: string;
  phases?: InitiativePhase[];
  success_metrics?: string[];
  labels?: string[];
  wus?: string[];
}

interface ExecutionPlan {
  waves: WUEntry[][];
  skipped: string[];
  skippedWithReasons: { id: string; reason: string }[];
  deferred: { id: string; blockedBy: string[]; reason: string }[];
}

interface ProgressStats {
  total: number;
  done: number;
  active: number;
  pending: number;
  blocked: number;
  percentage: number;
}
```

## Features

- **Dependency resolution**: Topological sort with cycle detection
- **Lane WIP constraint**: Max one WU per lane per wave
- **Checkpoint mode**: Wave manifests for idempotent resumption
- **Bottleneck analysis**: Identify WUs blocking the most downstream work
- **Schema validation**: Zod-based runtime validation
- **Modern**: Node 22+, ESM-only, TypeScript

## Documentation

For complete documentation, see the [LumenFlow documentation](https://github.com/hellmai/lumenflow).

## License

Apache-2.0
