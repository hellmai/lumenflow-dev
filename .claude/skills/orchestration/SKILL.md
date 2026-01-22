---
name: orchestration
description: Agent orchestration dashboard and initiative execution. Use when running initiatives, monitoring spawned agents, or debugging stuck spawns.
version: 2.4.0
source: packages/@lumenflow/cli/src/orchestrate.ts
last_updated: 2026-01-22
allowed-tools: Read, Bash, Grep
---

# Agent Orchestration Skill

## When to Use

Activate this skill when:

- Running multi-WU initiatives (`pnpm orchestrate:initiative`)
- Monitoring spawned agents for stuck/crashed states
- Debugging spawn failures or zombie lane locks

**Use skill first**: Run `pnpm orchestrate:status` and `pnpm orchestrate:suggest --wu <your-wu-id>`.

## ⛔ MANDATORY: Never Spawn Task Agents Directly

**CRITICAL PROHIBITION:** When delegating WUs to sub-agents, you MUST use the proper tooling:

```bash
# ✅ CORRECT: Use orchestrate:initiative for initiatives
pnpm orchestrate:initiative --initiative INIT-XXX

# ✅ CORRECT: Use wu:spawn for individual WUs
pnpm wu:spawn --id WU-XXX
```

**❌ NEVER do this:**

- Directly invoke Task tool for WU execution without using wu:spawn output
- Manually craft spawn prompts (they miss context loading, TDD directives, constraints)
- Skip wu:spawn when delegating entire WUs to sub-agents

**Why this matters:**

1. `wu:spawn` generates prompts with context loading preamble, TDD directives, and constraints block
2. Sub-agents need `wu:claim` (inside spawn prompts) to create proper lane locks and event tracking
3. Direct Task spawns bypass all safety mechanisms, coordination signals, and spawn registry tracking

**If you see agents running without proper worktree claims, STOP and investigate.**

---

## Commands

```bash
# Dashboard status
pnpm orchestrate:status

# Suggestions for a WU
pnpm orchestrate:suggest --wu WU-XXX

# Initiative execution
pnpm orchestrate:initiative --initiative INIT-001 --dry-run   # Show plan
pnpm orchestrate:initiative --initiative INIT-001             # Execute
pnpm orchestrate:initiative --initiative INIT-001 --progress  # Progress only
```

## Monitoring Commands

```bash
# Monitor spawn registry for stuck agents (default: 30 min threshold)
pnpm orchestrate:monitor

# Custom threshold
pnpm orchestrate:monitor --threshold 60

# Filter to initiative
pnpm orchestrate:monitor --initiative INIT-001

# JSON output for scripting
pnpm orchestrate:monitor --json
```

## Spawn Tree Visualisation

```bash
# View spawn tree for a WU
pnpm spawn:list --wu WU-XXX

# View all spawns for an initiative
pnpm spawn:list --initiative INIT-001

# JSON output
pnpm spawn:list --wu WU-XXX --json
```

**Spawn states:** `pending`, `completed`, `timeout`, `crashed`, `escalated`

## Self-Healing Signal Flow

When spawns fail, the system uses agent-in-loop recovery:

```
orchestrate:monitor
      │
      ▼
detectStuckSpawns() ──► recoverStuckSpawn()
                              │
                              ▼
                  [auto-recovery failed?]
                              │
                              ▼
                  signalOrchestratorFailure()
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     mem:signal broadcast           spawn status = ESCALATED
              │
              ▼
     ORCHESTRATOR INBOX
     (agent-in-loop)
              │
              ▼
     [orchestrator decides]
```

**Escalation Levels:**

| Attempt | Severity | Action         | Outcome                                 |
| ------- | -------- | -------------- | --------------------------------------- |
| 1st     | warning  | retry          | Re-spawn with same params               |
| 2nd     | error    | block          | Mark WU blocked, notify parallel agents |
| 3rd+    | critical | human_escalate | Create Bug WU, alert human              |

**Check orchestrator inbox:**

```bash
pnpm mem:inbox --wu WU-XXX --type spawn_failure
```

## Initiative Orchestration

**Wave-based execution**:

- Groups WUs by dependency depth (Kahn's algorithm)
- Parallel spawning within waves
- Checkpoint mode auto-enabled for >3 WUs or >2 waves

```bash
pnpm orchestrate:initiative -i INIT-009 -c     # Explicit checkpoint
pnpm orchestrate:initiative -i INIT-009        # Auto-detects
```

**Checkpoint mode**:

- Spawns one wave then exits (no polling)
- Writes manifest to `.beacon/artifacts/waves/`
- Idempotent re-runs advance to next wave

## Recovery Suggestions

When issues are detected, `orchestrate:monitor` outputs copy-pasteable commands:

```bash
# For stuck spawns
pnpm wu:block --id WU-XXX --reason "Spawn stuck for 45 minutes"

# For zombie lane locks
pnpm lane:unlock "Operations: Tooling" --reason "Zombie lock (PID 12345 not running)"

# After recovery, re-spawn
pnpm wu:unblock --id WU-XXX
pnpm wu:spawn --id WU-XXX
```

## Decision Tree

```
Starting WU?
├── Run: pnpm orchestrate:suggest --wu WU-XXX
└── Review agent recommendations

Initiative with multiple WUs?
├── Run: pnpm orchestrate:initiative -i INIT-XXX --dry-run
└── Review wave plan, then execute

Agent appears stuck or crashed?
├── Run: pnpm orchestrate:monitor
├── Check spawn tree: pnpm spawn:list --wu WU-XXX
└── Follow recovery suggestions in output
```

---

**Full docs**: [execution-memory skill](../execution-memory/SKILL.md)
