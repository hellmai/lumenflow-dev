# @lumenflow/metrics

DORA/SPACE analytics and flow metrics for LumenFlow workflow framework.

## Installation

```bash
pnpm add @lumenflow/metrics
```

## Features

### DORA Metrics

Calculate DevOps Research and Assessment (DORA) metrics based on "Accelerate" research:

- **Deployment Frequency**: How often code is deployed to production
- **Lead Time for Changes**: Time from commit to production
- **Change Failure Rate**: Percentage of deployments causing failures
- **Mean Time to Recovery**: Time to recover from failures

```typescript
import {
  calculateDORAMetrics,
  calculateDeploymentFrequency,
  calculateLeadTime,
  calculateCFR,
  calculateMTTR,
} from '@lumenflow/metrics';

const doraMetrics = calculateDORAMetrics(commits, skipGatesEntries, wuMetrics, weekStart, weekEnd);

// Status tiers: 'elite' | 'high' | 'medium' | 'low'
console.log(doraMetrics.deploymentFrequency.status);
```

### Flow State

Track Work Unit (WU) flow states:

```typescript
import { calculateFlowState } from '@lumenflow/metrics';

const state = calculateFlowState(wuMetrics);
// { ready, inProgress, blocked, waiting, done, totalActive }
```

### Bottleneck Analysis

Identify bottlenecks and critical paths in dependency graphs:

```typescript
import {
  analyzeBottlenecks,
  criticalPath,
  topologicalSort,
  getBottleneckAnalysis,
} from '@lumenflow/metrics';

// Full analysis
const analysis = getBottleneckAnalysis(dependencyGraph, 10);
console.log(analysis.bottlenecks); // Top 10 bottlenecks by impact score
console.log(analysis.criticalPath); // Longest dependency chain
```

### Flow Report Generation

Generate comprehensive flow reports:

```typescript
import { generateFlowReport } from '@lumenflow/metrics';

const report = generateFlowReport({
  gateEvents,
  llmEvents,
  completedWUs,
  dateRange: { start: '2026-01-01', end: '2026-01-08' },
});
```

### Metrics Snapshots

Capture point-in-time metrics snapshots:

```typescript
import { captureMetricsSnapshot } from '@lumenflow/metrics';

const snapshot = captureMetricsSnapshot({
  commits,
  wuMetrics,
  skipGatesEntries,
  weekStart,
  weekEnd,
  type: 'all', // 'dora' | 'lanes' | 'flow' | 'all'
});
```

### Telemetry

Emit structured telemetry events:

```typescript
import { createTelemetryEmitter, TELEMETRY_PATHS } from '@lumenflow/metrics';

// Create emitter with custom emit function
const emitter = createTelemetryEmitter((path, event) => {
  fs.appendFileSync(path, JSON.stringify(event) + '\n');
});

// Emit gate event
emitter.emitGateEvent({
  gateName: 'lint',
  passed: true,
  durationMs: 1500,
  wuId: 'WU-100',
  lane: 'Operations',
});

// Emit LLM classification events
emitter.emitLLMClassificationStart({
  classificationType: 'mode_detection',
  hasContext: true,
});

emitter.emitLLMClassificationComplete({
  classificationType: 'mode_detection',
  durationMs: 200,
  tokensUsed: 150,
  estimatedCostUsd: 0.001,
  confidence: 0.95,
  fallbackUsed: false,
});
```

## DORA Thresholds

Based on "Accelerate" research by Nicole Forsgren, Jez Humble, Gene Kim:

| Metric                | Elite   | High       | Medium      | Low        |
| --------------------- | ------- | ---------- | ----------- | ---------- |
| Deployment Frequency  | >5/week | 1-5/week   | 0.25-1/week | <0.25/week |
| Lead Time for Changes | <24h    | <168h (7d) | <720h (30d) | >720h      |
| Change Failure Rate   | <15%    | 15-30%     | 30-45%      | >45%       |
| Mean Time to Recovery | <1h     | <24h       | <168h (7d)  | >168h      |

## Subpath Exports

```typescript
// DORA metrics only
import { calculateDORAMetrics } from '@lumenflow/metrics/dora';

// Flow metrics only
import { calculateFlowState, analyzeBottlenecks } from '@lumenflow/metrics/flow';

// Telemetry only
import { createTelemetryEmitter } from '@lumenflow/metrics/telemetry';
```

## License

Apache-2.0
