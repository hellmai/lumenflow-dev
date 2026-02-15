# @lumenflow/agent

Agent session management and verification for LumenFlow workflow framework.

## Installation

```bash
npm install @lumenflow/agent
```

## Overview

This package provides agent session management for AI agents working within the LumenFlow framework. It enables:

- **Session management**: Track agent sessions with WU context
- **Incident logging**: Record incidents with severity levels
- **WU verification**: Verify WU completion status
- **Feedback promotion**: Promote agent feedback to project guidelines

## Usage

### Session Management

```typescript
import { startSession, getCurrentSession, endSession, logIncident } from '@lumenflow/agent';

// Start a session (auto-detects lane from git branch)
const sessionId = await startSession('WU-123', 2, 'claude-code');

// Get current session
const session = await getCurrentSession();
console.log(session?.wu_id, session?.lane);

// Log an incident during the session
await logIncident({
  category: 'validation',
  severity: 'minor',
  title: 'Schema validation warning',
  description: 'Optional field missing from response',
});

// End session and get summary
const summary = await endSession();
console.log(`Completed ${summary.wu_id} with ${summary.incidents_logged} incidents`);
```

### WU Verification

```typescript
import { verifyWUComplete, debugSummary } from '@lumenflow/agent';

// Verify a WU has been properly completed
const result = verifyWUComplete('WU-123');

if (result.complete) {
  console.log('WU-123 is complete');
} else {
  console.log(debugSummary(result));
  // Verification failed:
  // - Missing stamp .lumenflow/stamps/WU-123.done
  // - No commit on main touching WU YAML
}
```

### Incident Tracking

```typescript
import { appendIncident, readIncidents } from '@lumenflow/agent/incidents';

// Append an incident to the log
appendIncident({
  timestamp: new Date().toISOString(),
  session_id: 'uuid-here',
  wu_id: 'WU-123',
  lane: 'Operations',
  category: 'gate_failure',
  severity: 'major',
  title: 'Typecheck failed',
  description: 'Missing type export in index.ts',
});

// Read all incidents
const incidents = readIncidents();
```

### Feedback Promotion

```typescript
import { promoteFeedback } from '@lumenflow/agent/feedback-promote';
import { reviewFeedback } from '@lumenflow/agent/feedback-review';

// Review pending feedback items
const pending = await reviewFeedback();
for (const item of pending) {
  console.log(`${item.id}: ${item.title}`);
}

// Promote feedback to project guidelines
await promoteFeedback('feedback-001', {
  target: 'CLAUDE.md',
  section: 'Constraints',
});
```

## Subpath Exports

```typescript
// Main entry (all exports)
import { startSession, verifyWUComplete } from '@lumenflow/agent';

// Specific modules
import { startSession, getCurrentSession, endSession, logIncident } from '@lumenflow/agent/session';
import { appendIncident, readIncidents } from '@lumenflow/agent/incidents';
import { verifyWUComplete, debugSummary } from '@lumenflow/agent/verification';
import { initAutoSession, getAutoSession } from '@lumenflow/agent/auto-session';
import { promoteFeedback } from '@lumenflow/agent/feedback-promote';
import { reviewFeedback } from '@lumenflow/agent/feedback-review';
```

## API Reference

### Session Management

| Function                               | Description                            |
| -------------------------------------- | -------------------------------------- |
| `startSession(wuId, tier, agentType?)` | Start a new agent session              |
| `getCurrentSession()`                  | Get the current active session         |
| `endSession()`                         | End session and return summary         |
| `logIncident(data)`                    | Log an incident to the current session |

### Verification

| Function                 | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `verifyWUComplete(wuId)` | Verify WU completion (stamp, commit, clean tree) |
| `debugSummary(result)`   | Format verification result for display           |

### Incidents

| Function                   | Description                   |
| -------------------------- | ----------------------------- |
| `appendIncident(incident)` | Append incident to NDJSON log |
| `readIncidents()`          | Read all incidents from log   |

### Types

```typescript
interface SessionData {
  session_id: string;
  wu_id: string;
  lane: string;
  started: string;
  completed?: string;
  agent_type: string;
  context_tier: number;
  incidents_logged: number;
  incidents_major: number;
}

interface VerificationResult {
  complete: boolean;
  failures: string[];
}

interface IncidentData {
  timestamp: string;
  session_id: string;
  wu_id: string;
  lane: string;
  category: string;
  severity: 'minor' | 'major' | 'blocker';
  title: string;
  description: string;
  context?: Record<string, unknown>;
}
```

## Features

- **Session isolation**: One session per agent, prevents conflicts
- **Auto lane detection**: Parses lane from git branch name
- **Incident severity**: Track minor/major/blocker incidents
- **Completion verification**: Multi-check WU completion validation
- **Modern**: Node 22+, ESM-only, TypeScript

## Documentation

For complete documentation, see the [LumenFlow documentation](https://github.com/hellmai/lumenflow).

## License

Apache-2.0
