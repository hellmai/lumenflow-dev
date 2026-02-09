---
name: execution-memory
description: Memory layer for session tracking, context recovery, and agent coordination. Use when resuming work after /clear, coordinating with parallel agents, or managing long-running sessions.
version: 1.2.0
source: docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md
source_sections: Memory Commands
last_updated: 2026-01-26
allowed-tools: Read, Bash, Grep
---

# Execution Memory Skill

**Source**: Memory Layer (implemented across wu:claim, wu:done, and mem:\* commands)

This skill documents the memory layer for agent session tracking, context recovery, and coordination. It provides patterns for resuming work after `/clear`, coordinating with parallel agents, and managing discoveries during execution.

## When to Use This Skill

Activate automatically when:

- Resuming work after `/clear` or session handoff
- Coordinating with parallel agents (signals/inbox)
- Managing long-running sessions (>20 tool calls)
- Capturing discoveries (bugs, ideas) mid-WU
- Context window feels constrained

## Quick Reference: Storage Location

All memory data is stored in `.lumenflow/memory/` as append-only JSONL:

```
.lumenflow/memory/
├── memory.jsonl        # Session/checkpoint/discovery/summary nodes
├── relationships.jsonl # Optional node relationships (blocks, related)
├── signals.jsonl       # Inter-agent coordination signals
└── config.yaml         # Retention policy defaults
```

The source of truth is `.lumenflow/memory/`.

## Automatic Integration

The memory layer integrates automatically with WU lifecycle commands:

### wu:claim (automatic)

When you run `pnpm wu:claim`:

1. Creates session node in `.lumenflow/memory/memory.jsonl`
2. Links session to WU ID
3. Records baseline main SHA for recovery

### wu:done (automatic)

When you run `pnpm wu:done`:

1. Creates pre-gates checkpoint (recovery point if gates fail)
2. Broadcasts completion signal to parallel agents (`signals.jsonl`)
3. Checks `mem:inbox` for recent signals from other agents
4. Ends session and marks as completed

**No manual intervention required** for basic session tracking.

## Manual Commands Reference

### Session Management

```bash
# Start a new session (usually automatic via wu:claim)
pnpm mem:start --wu WU-XXX

# Create progress checkpoint
pnpm mem:checkpoint "Completed port definitions, starting tests" --wu WU-XXX

# Query ready nodes (what's pending/next?)
pnpm mem:ready --wu WU-XXX
pnpm mem:ready --wu WU-XXX --type discovery  # Filter by type
pnpm mem:ready --wu WU-XXX --format json     # JSON output
```

### Discovery Capture

```bash
# Create discovery node with type aliases
pnpm mem:create "Found race condition in auth flow" --type bug         # → type=discovery, tags=[bug]
pnpm mem:create "Could extract common validation logic" --type idea    # → type=discovery, tags=[idea]

# Canonical form (equivalent, explicit)
pnpm mem:create "Performance issue" --type discovery --tags bug,performance

# Tags are merged and deduplicated
pnpm mem:create "Bug with extra tags" --type bug --tags scope-creep   # → tags=[bug, scope-creep]

# WU is auto-inferred from current session (no --wu required if session exists)
pnpm mem:create "Found issue" --type bug                               # auto-links to current WU

# List discoveries for review
pnpm mem:triage --list

# Promote discovery to WU
pnpm mem:triage --promote mem-xxxx --lane "Operations: Tooling"
```

### Agent Coordination

```bash
# Send signal to other agents
pnpm mem:signal "Completed auth refactor, ready for integration" --wu WU-XXX

# Read signals for your lane
pnpm mem:inbox --lane Operations
pnpm mem:inbox --lane "Operations: Tooling"

# Watch mode for real-time coordination
pnpm mem:inbox --since 1h --watch
```

### Maintenance

```bash
# Summarise nodes for context compaction
pnpm mem:summarize --wu WU-XXX

# Preview cleanup
pnpm mem:cleanup --dry-run

# Execute cleanup per lifecycle rules
pnpm mem:cleanup

# Initialize memory directory (first time setup)
pnpm mem:init
```

## Context Recovery Pattern

When resuming work after `/clear` or session handoff:

### Step 1: Check Pending Work

```bash
# What's pending for this WU?
pnpm mem:ready --wu WU-XXX
```

Output shows:

- Checkpoints with progress notes
- Pending discoveries to triage
- Incomplete tasks from previous session

### Step 2: Check Coordination Signals

```bash
# Any messages from parallel agents?
pnpm mem:inbox --wu WU-XXX
pnpm mem:inbox --lane Operations --since 2h
```

### Step 3: Resume or Start Fresh

```bash
# Option A: Resume from checkpoint (context available)
# Read the checkpoint, continue from where you left off

# Option B: Start new session (fresh context)
pnpm mem:start --wu WU-XXX
```

### Context Compaction Workflow

For long sessions (>20 tool calls):

1. **Checkpoint progress**: `pnpm mem:checkpoint "status" --wu WU-XXX`
2. **Clear context**: `/clear` in your AI coding tool
3. **Reload minimal context**: Tier 1 docs + WU YAML
4. **Query ready nodes**: `pnpm mem:ready --wu WU-XXX`
5. **Continue from checkpoint**

If your client supports hooks, add a pre-clear hook that runs `pnpm mem:checkpoint` automatically
before `/clear` or `/compact` to avoid losing context.

## Discovery Lifecycle

Discoveries captured via `mem:create` follow this lifecycle:

```
created → triaged → promoted/dismissed
```

**States:**

- `created`: Just captured, needs review
- `triaged`: Reviewed, decision pending
- `promoted`: Converted to WU via `mem:triage --promote`
- `dismissed`: Not actionable, archived

**Discovery Types (via `--type` argument):**

| Type Alias  | Stored As   | Auto-Tag | Description                      |
| ----------- | ----------- | -------- | -------------------------------- |
| `bug`       | `discovery` | `bug`    | Defect found during work         |
| `idea`      | `discovery` | `idea`   | Improvement suggestion           |
| `discovery` | `discovery` | -        | General finding (canonical type) |

## Signal Patterns

### Completion Broadcast

After completing significant work:

```bash
pnpm mem:signal "WU-XXX complete: auth refactor merged" --wu WU-XXX
```

### Coordination Request

When needing input from parallel agent:

```bash
pnpm mem:signal "Need review of auth flow before proceeding" --wu WU-XXX
```

### Polling Pattern (Orchestrators)

For orchestrators managing multiple agents:

```bash
# Check for updates from all lanes
pnpm mem:inbox --since 30m
pnpm mem:inbox --lane "Operations: Tooling"
```

## Integration with Other Skills

### wu-lifecycle

The execution-memory skill complements wu-lifecycle:

- `wu:claim` automatically starts session
- `wu:done` automatically creates checkpoint and broadcasts signal
- `wu:block/unblock` preserves session state

### multi-agent-coordination

For parallel WU coordination:

- Use `mem:signal` to notify completion
- Use `mem:inbox` to receive coordination messages
- Use `mem:ready` to check handoff status

### orchestration

For initiative orchestration:

- `orchestrate:initiative` polls `mem:inbox` during wave execution
- Signals inform wave coordination decisions
- Discoveries feed into WU creation pipeline

## Decision Trees

### When to Create Checkpoint

**Create checkpoint if:**

- Completing significant milestone (port definition, test pass)
- Context window feeling constrained (>50 tool calls)
- About to run `/clear`
- Switching to sub-task (will return later)

**Skip checkpoint if:**

- Quick edit (<5 tool calls total)
- Already near completion
- WU is simple single-file change

### When to Capture Discovery

**Capture as discovery if:**

- Bug found in code outside current WU's `code_paths`
- Idea for improvement unrelated to current work
- Performance/security concern for later investigation
- Question needs external input

**Fix in place if:**

- Bug is in current WU's `code_paths`
- Fix is small (<=10 lines)
- Directly blocks acceptance criteria

See `bug-classification` skill for full decision tree.

## Related Skills

- [wu-lifecycle](../wu-lifecycle/SKILL.md) - WU claim/block/done (auto-integrated)
- [multi-agent-coordination](../multi-agent-coordination/SKILL.md) - Parallel agent patterns
- [orchestration](../orchestration/SKILL.md) - Initiative wave coordination

## Version History

- **v1.1.0** (2025-12-17): Added type aliases (`--type bug/idea`) and worktree-aware WU auto-inference
- **v1.0.0** (2025-12-11): Initial skill for memory layer
