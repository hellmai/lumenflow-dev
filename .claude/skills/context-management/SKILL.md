---
name: context-management
description: Session checkpoint patterns, output bypass for large results, when to spawn fresh sub-agents. Use for long-running sessions, context exhaustion, or agent coordination.
version: 1.1.0
source: docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-invocation-guide.md
source_sections: Context Tiers, Session Management, Wave Orchestration
last_updated: 2026-01-22
allowed-tools: Read, Write, Bash
---

# Context Management Skill

**Source**: `docs/04-operations/_frameworks/lumenflow/agent/onboarding/agent-invocation-guide.md`

Patterns for managing context in long-running AI coding sessions.

## Session Checkpoints

Use memory commands to preserve state across context boundaries:

```bash
# Start session tracking
pnpm mem:start --wu WU-123

# Save checkpoint before context-heavy operation
pnpm mem:checkpoint --wu WU-123 --note "Completed step 2, starting API integration"

# Resume after /clear
pnpm mem:ready --wu WU-123  # Shows pending work
pnpm mem:inbox --wu WU-123  # Check signals from other agents
```

## Output Bypass Pattern

For large results that would exhaust context:

```typescript
// ❌ BAD: Returns 10MB of data into context
const allLogs = await fetchAllLogs();
return allLogs;

// ✅ GOOD: Store to filesystem, return reference
const allLogs = await fetchAllLogs();
await writeFile('/tmp/analysis-results.json', JSON.stringify(allLogs));
console.log('Results saved to /tmp/analysis-results.json');
return { resultPath: '/tmp/analysis-results.json', summary: summarize(allLogs) };
```

## When to Spawn Sub-Agents

Spawn fresh agent when:

- Current context >80% exhausted
- Task is independent and parallelizable
- Need specialized agent (security-auditor, code-reviewer)
- Switching to different WU scope

Keep in current context when:

- Tasks share significant state
- Sequential dependencies exist
- Context usage still low

## Wave Orchestration Pattern

When orchestrating multi-wave initiatives, use the checkpoint-per-wave pattern to prevent context exhaustion:

```bash
# Spawn next wave then exit (no polling)
pnpm orchestrate:initiative -i INIT-009 -c

# Check progress via stamps
pnpm orchestrate:initiative -i INIT-009 -p

# Repeat for next wave when complete
pnpm orchestrate:initiative -i INIT-009 -c
```

**Key principles:**

1. **Exit immediately after spawning** — No polling loops in the orchestrator
2. **Wave manifests for idempotency** — `.beacon/artifacts/waves/INIT-XXX-wave-N.json`
3. **Stamp-based completion** — Check `.beacon/stamps/WU-*.done` for progress
4. **Compact output** — Keep orchestrator output under 20 lines

See [orchestration skill](../orchestration/SKILL.md) for complete documentation.

## Context Loading Order

Always load context in this order for best comprehension:

1. `LUMENFLOW.md` — Workflow fundamentals
2. `README.md` — Project structure
3. `lumenflow-complete.md` §§1-7 — Constraints
4. WU YAML — Current task spec
5. Task instructions — What to do
6. Constraints block — Critical rules (at END per "Lost in Middle" research)

## Integration with Other Skills

- **multi-agent-coordination**: For parallel sub-agent work
- **wu-lifecycle**: Session ties to WU lifecycle
- **orchestration**: Agent selection guidance, wave orchestration pattern
- **execution-memory**: Memory layer commands for checkpoints and signals

## Version History

- **v1.1.0** (2025-12-18): Added wave orchestration pattern cross-reference
- **v1.0.0** (2025-12-11): Initial skill created
