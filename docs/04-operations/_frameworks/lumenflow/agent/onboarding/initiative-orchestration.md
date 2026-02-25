# Initiative Orchestration Guide

**Last updated:** 2026-02-24

Step-by-step guide for agents orchestrating multi-WU initiatives. This document ties together the orchestration, delegation, memory coordination, and failure recovery patterns into a single prescriptive workflow.

---

## Prerequisites

Before orchestrating an initiative, ensure:

1. The initiative YAML exists at `docs/04-operations/tasks/initiatives/INIT-XXX.yaml`
2. All WUs are linked to the initiative via `initiative:add-wu`
3. Dependencies between WUs are defined (blocking relationships)
4. Lane lifecycle is locked (`pnpm lane:status` shows `locked`)

---

## Step-by-Step: Orchestrating an Initiative

### Step 1: Assess the Initiative

```bash
# Check initiative status and WU breakdown
pnpm initiative:status --id INIT-XXX

# Preview the execution plan (dry run)
pnpm orchestrate:initiative --initiative INIT-XXX --dry-run
```

The dry-run output shows:

- **Waves**: Groups of WUs that can run in parallel (computed via topological sort)
- **Bottleneck WUs**: WUs that block the most downstream work (prioritize these)
- **Recommended execution mode**: Checkpoint-per-wave vs continuous

### Step 2: Choose Execution Mode

| Mode                  | Command                                              | When to use                            |
| --------------------- | ---------------------------------------------------- | -------------------------------------- |
| Checkpoint-per-wave   | `pnpm orchestrate:initiative -i INIT-XXX -c`         | Large initiatives (>3 WUs or >2 waves) |
| Continuous            | `pnpm orchestrate:initiative -i INIT-XXX`            | Small initiatives (<=3 WUs, 1-2 waves) |
| Manual brief/delegate | `pnpm wu:brief --id WU-XXX --client <client>` per WU | Testing individual WUs, debugging      |

Checkpoint-per-wave is recommended for most initiatives. It processes one wave at a time and writes a manifest before exiting, giving you control between waves.

### Step 3: Delegate WUs

For each WU in the current wave, generate a handoff prompt:

```bash
# Option A: Generate prompt + evidence (no lineage side effect)
pnpm wu:brief --id WU-100 --client claude-code

# Option B: Generate prompt + record delegation lineage (for audit)
pnpm wu:delegate --id WU-100 --parent-wu WU-050 --client claude-code
```

**Use `wu:delegate` (not `wu:brief`) when:**

- You are the orchestrator agent managing the initiative
- You need an audit trail of who-delegated-what
- The initiative has more than one wave

**Verification checklist before spawning:**

1. The generated prompt ends with `<!-- LUMENFLOW_SPAWN_END -->`
2. The `</constraints>` block is present near the end
3. The `LUMENFLOW_TRUNCATION_WARNING` banner is at the start

If any of these are missing, the prompt was truncated. Re-generate it or use `--codex` for a shorter format.

### Step 4: Monitor Progress

Between waves (or during continuous execution), monitor agent progress:

```bash
# Check for coordination signals from spawned agents
pnpm mem:inbox --since 30m

# Compact progress view
pnpm orchestrate:init-status -i INIT-XXX

# Check for stuck or crashed agents
pnpm orchestrate:monitor --initiative INIT-XXX

# View delegation tree
pnpm delegation:list --initiative INIT-XXX
```

**Do NOT use TaskOutput to poll agent progress** -- it causes context explosion. Use `mem:inbox` instead.

### Step 5: Advance to Next Wave

After all WUs in the current wave are complete:

```bash
# Re-run orchestrate (idempotent -- skips completed WUs, advances to next wave)
pnpm orchestrate:initiative -i INIT-XXX -c
```

Repeat Steps 4-5 until all waves are complete.

### Step 6: Verify Completion

```bash
# Final status check
pnpm initiative:status --id INIT-XXX

# Mark initiative as done
pnpm initiative:edit --id INIT-XXX --status done
```

---

## Memory Coordination Between Waves

Agents coordinate through the memory layer. Here is the signal flow during multi-wave execution.

### Signal Flow

```
Wave 1 Agent (WU-100)                    Orchestrator
       │                                       │
       ├── works on WU-100                     │
       ├── wu:done (auto-broadcasts signal)    │
       │                                       │
       │                                       ├── mem:inbox --since 30m
       │                                       ├── (sees: "WU-100 complete")
       │                                       ├── orchestrate:init-status
       │                                       ├── (sees: Wave 1 complete)
       │                                       ├── orchestrate:initiative -c
       │                                       │   (spawns Wave 2)
       │                                       │
Wave 2 Agent (WU-103)                          │
       │                                       │
       ├── works on WU-103                     │
       └── wu:done (auto-broadcasts signal)    │
```

### Key Commands

| Command                          | Who runs it    | When                          |
| -------------------------------- | -------------- | ----------------------------- |
| `mem:signal "msg" --wu WU-XXX`   | Worker agent   | After significant progress    |
| `mem:inbox --since <duration>`   | Orchestrator   | Between waves, during polling |
| `mem:checkpoint "msg" --wu WU-X` | Worker agent   | Before risky operations       |
| `mem:ready --wu WU-XXX`          | Recovery agent | When taking over a stuck WU   |

### Signal Storage

All signals are written to `.lumenflow/memory/signals.jsonl` as append-only JSONL. Signals produce immutable receipts and support read-state tracking (marking signals as read after consumption).

---

## Checkpoint-Per-Wave Mechanics

### How Manifests Work

When running with `--checkpoint-per-wave` (or `-c`):

1. The orchestrator computes wave groupings using Kahn's algorithm on WU dependencies
2. For the current wave, it spawns agents for all ready WUs
3. It writes a manifest to `.lumenflow/artifacts/waves/INIT-XXX-wave-N.json`
4. It exits (does not poll or wait)

### Manifest Contents

```json
{
  "initiative": "INIT-XXX",
  "wave": 1,
  "wus": ["WU-100", "WU-101", "WU-102"],
  "spawned_at": "2026-02-24T10:00:00Z",
  "agent_ids": ["agent-abc", "agent-def", "agent-ghi"],
  "status": {
    "WU-100": "in_progress",
    "WU-101": "in_progress",
    "WU-102": "in_progress"
  }
}
```

### Idempotent Re-Runs

If the orchestrator crashes or is interrupted:

- Re-running `orchestrate:initiative -i INIT-XXX -c` reads the existing manifest
- WUs with `status: done` in their YAML are skipped
- WUs still `ready` or `in_progress` are re-spawned
- Once all WUs in the wave are done, the next wave begins

This makes checkpoint mode safe to interrupt and resume at any point.

### Auto-Detection

Checkpoint mode is auto-enabled when an initiative has:

- More than 3 WUs, OR
- More than 2 waves

You can always pass `-c` explicitly for smaller initiatives.

---

## Failure Recovery Playbook

### Escalation Levels

The orchestration system uses a 3-level escalation model:

| Attempt | Severity   | Action           | What happens                                       |
| ------- | ---------- | ---------------- | -------------------------------------------------- |
| 1st     | `warning`  | Retry            | Re-spawn agent with same parameters                |
| 2nd     | `error`    | Block            | Mark WU blocked, notify parallel agents via signal |
| 3rd+    | `critical` | Human escalation | Create Bug WU, alert human operator                |

### Detection: Finding Stuck Agents

```bash
# Default threshold: 30 minutes without progress
pnpm orchestrate:monitor

# Custom threshold (in minutes)
pnpm orchestrate:monitor --threshold 60

# Filter to initiative
pnpm orchestrate:monitor --initiative INIT-XXX
```

The monitor checks:

- Spawn registry for agents that have not completed within the threshold
- Lane locks that reference dead processes (zombie locks)
- Memory signals for explicit failure broadcasts

### Recovery: Step-by-Step

**Scenario 1: Agent stuck (no progress, but process may still be running)**

```bash
# 1. Block the WU
pnpm wu:block --id WU-100 --reason "Agent stuck for 45 minutes, no progress signals"

# 2. Check what the agent accomplished
pnpm mem:ready --wu WU-100

# 3. Unblock and re-delegate
pnpm wu:unblock --id WU-100
pnpm wu:brief --id WU-100 --client claude-code
```

**Scenario 2: Zombie lane lock (agent process died, lock remains)**

```bash
# 1. Identify the zombie lock
pnpm orchestrate:monitor  # Shows "Zombie lock (PID XXXXX not running)"

# 2. Unlock the lane
pnpm lane:unlock "Framework: Core" --reason "Zombie lock (PID 12345 not running)"

# 3. Release and re-claim the WU
pnpm wu:release --id WU-100
pnpm wu:claim --id WU-100 --lane "Framework: Core"
```

**Scenario 3: Agent crashed, worktree left behind**

```bash
# 1. Inspect the worktree
cd worktrees/<lane>-wu-100
git log --oneline -5   # What did they commit?
git status             # Any uncommitted work?

# 2. Check last checkpoint
pnpm mem:ready --wu WU-100

# 3. Either resume (continue from checkpoint) or release
# Resume: stay in worktree, continue the work
# Release: pnpm wu:release --id WU-100
```

**Scenario 4: Repeated failures (3+ attempts)**

At this point, stop automated retries and create a Bug WU:

```bash
# The orchestrate:monitor output will suggest this
pnpm wu:create --lane "Operations: Tooling" \
  --title "Bug: WU-100 repeatedly fails during INIT-XXX" \
  --type bug \
  --description "WU-100 has failed 3 times during initiative orchestration. ..."
```

### Self-Healing Signal Flow

The recovery system is agent-in-loop, not fully automated:

1. `orchestrate:monitor` detects the stuck spawn
2. `recoverStuckSpawn()` attempts automatic recovery (retry)
3. If auto-recovery fails, `signalOrchestratorFailure()` broadcasts a `spawn_failure` signal
4. The orchestrator reads the signal via `mem:inbox --type spawn_failure`
5. The orchestrator decides: retry, block, or escalate to human

```bash
# Check for failure signals specifically
pnpm mem:inbox --wu WU-100 --type spawn_failure
```

---

## Delegation Lineage

### Why Lineage Matters

When multiple agents work on an initiative, you need to answer:

- Which agent was responsible for WU-100?
- Who delegated it, and when?
- What is the current state of every delegation?

### Recording Lineage

Use `wu:delegate` instead of `wu:brief` for auditable delegation:

```bash
pnpm wu:delegate --id WU-100 --parent-wu WU-050 --client claude-code
```

This records a delegation record with:

- `parent_wu`: The orchestrator or coordinator WU
- `child_wu`: The delegated WU
- `client`: The agent type
- `state`: `pending` (initial), then `completed`, `timeout`, `crashed`, or `escalated`
- `timestamp`: When delegation occurred

### Viewing the Tree

```bash
# All delegations for a WU
pnpm delegation:list --wu WU-050

# All delegations for an initiative
pnpm delegation:list --initiative INIT-XXX

# JSON output for programmatic use
pnpm delegation:list --initiative INIT-XXX --json
```

### Delegation States

| State       | Meaning                                          |
| ----------- | ------------------------------------------------ |
| `pending`   | Agent spawned but not yet complete               |
| `completed` | WU completed successfully (wu:done ran)          |
| `timeout`   | Agent exceeded time threshold without completing |
| `crashed`   | Agent process terminated unexpectedly            |
| `escalated` | Repeated failures, escalated to human            |

---

## Quick Reference: All Orchestration Commands

| Command                                             | Description                                        |
| --------------------------------------------------- | -------------------------------------------------- |
| `pnpm orchestrate:initiative -i INIT-XXX --dry-run` | Preview wave plan without executing                |
| `pnpm orchestrate:initiative -i INIT-XXX -c`        | Execute one wave then checkpoint and exit          |
| `pnpm orchestrate:initiative -i INIT-XXX`           | Execute all waves continuously                     |
| `pnpm orchestrate:init-status -i INIT-XXX`          | Compact progress view                              |
| `pnpm orchestrate:monitor`                          | Detect stuck agents and zombie locks               |
| `pnpm wu:brief --id WU-XXX --client <client>`       | Generate handoff prompt + evidence (worktree only) |
| `pnpm wu:delegate --id WU-XXX --parent-wu <P>`      | Generate prompt + record delegation                |
| `pnpm delegation:list --initiative INIT-XXX`        | View delegation tree                               |
| `pnpm mem:signal "msg" --wu WU-XXX`                 | Broadcast coordination signal                      |
| `pnpm mem:inbox --since <duration>`                 | Read coordination signals                          |
| `pnpm mem:checkpoint "msg" --wu WU-XXX`             | Save progress checkpoint                           |
| `pnpm mem:ready --wu WU-XXX`                        | Check pending work/checkpoints                     |
| `pnpm wu:block --id WU-XXX --reason "..."`          | Block stuck WU                                     |
| `pnpm wu:unblock --id WU-XXX`                       | Unblock recovered WU                               |
| `pnpm wu:release --id WU-XXX`                       | Release abandoned WU for re-claim                  |

---

## Related Documents

- [Initiatives Guide (Starlight)](../../../../../../apps/docs/src/content/docs/guides/initiatives.mdx) -- Public user-facing documentation
- [Quick Reference: Commands](quick-ref-commands.md) -- Complete CLI command reference
- [Starting Prompt](starting-prompt.md) -- Agent onboarding entry point
- [Agent Invocation Guide](agent-invocation-guide.md) -- When to use wu:brief vs wu:delegate vs inline context
