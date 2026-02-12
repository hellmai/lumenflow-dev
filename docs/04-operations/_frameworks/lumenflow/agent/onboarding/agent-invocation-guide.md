# Agent Invocation Guide (LumenFlow)

**Last updated:** 2026-01-31

This guide defines how to generate and hand off sub-agent delegation briefs so agents start with the right context, follow LumenFlow constraints, and leave durable artifacts for handoff.

Use this document when:

- Generating delegation briefs for sub-agents or parallel WUs
- Writing orchestrator prompts
- Starting a new session after `/clear`
- Coordinating multi-wave initiatives

---

## 1) Context Tiers (Load Order)

Load context in this order to reduce "lost in the middle" failures:

1. `LUMENFLOW.md` — workflow fundamentals
2. `README.md` — repo structure / commands
3. `lumenflow-complete.md` §§1-7 — constraints + governance
4. WU YAML — current task spec
5. Task instructions — what to do
6. **Critical Constraints block** — append at the end (see below)

**Tier guidance:**

- **Tier 1 (minimal):** `LUMENFLOW.md`, `README.md`, WU YAML
- **Tier 2 (standard):** Tier 1 + `lumenflow-complete.md` §§1-7
- **Tier 3 (full):** Tier 2 + relevant framework/agent docs

Use Tier 1 after `/clear` to stay lean, then load more only if needed.

---

## 2) Session Management (Start Fresh)

When approaching context limits, **start a fresh agent instead of compaction**.
The handoff prompt is the bridge between sessions. `wu:brief` generates this prompt; execution happens when you invoke your Task tool with that prompt.

**Mandatory triggers:**

- Context usage >80%
- 50+ tool calls
- Performance degradation (forgotten context, redundant queries)
- About to run `/compact` or `/clear`

**Start-fresh protocol:**

```bash
pnpm mem:checkpoint "Progress: completed X, next: Y" --wu WU-XXX
git add -A && git commit -m "checkpoint: progress on X"
git push origin lane/<lane>/wu-xxx
pnpm wu:brief --id WU-XXX --client claude-code
# Copy generated prompt into Task tool to start the next agent session.
# Exit current session; start fresh in the new session.
```

**Optional safety net:** If your client supports hooks, add a pre-clear checkpoint hook:

```bash
pnpm mem:checkpoint "Pre-clear: <summary>" --wu WU-XXX --trigger pre-clear
```

---

## 2a) Memory Context Injection (Automatic)

When the memory layer is initialized (`memory.jsonl` exists), `wu:brief` automatically
injects relevant memory context into the handoff prompt under a `## Memory Context` section.

**What gets included:**

- WU-specific checkpoints and notes
- Project-level architectural decisions
- Recent context relevant to the lane

**Configuration:**

Configure max context size in `.lumenflow.config.yaml`:

```yaml
memory:
  spawn_context_max_size: 4096 # Default: 4KB
```

**Skip context injection:**

Use `--no-context` when you want a clean prompt without memory context:

```bash
pnpm wu:brief --id WU-XXX --client claude-code --no-context
```

This is useful when:

- Starting completely fresh without prior context
- Debugging context-related issues
- Memory layer contains stale or irrelevant data

---

## 2b) Delegation Provenance (Intent vs Execution)

`wu:delegate` records **delegation intent**: that a brief was generated for a target WU with explicit parent lineage.

It does **not** by itself prove pickup or execution. Pickup/execution confirmation comes from lifecycle evidence (claim/completion events, checkpoints, signals, and final `wu:done`).

---

## 3) Spawn Prompt Structure (Recommended)

Use this structure for sub-agent prompts:

1. **Objective** — clear, single outcome
2. **Scope** — what is in/out of scope
3. **Code Paths** — allowed paths (from WU `code_paths`)
4. **Tests/Gates** — required checks
5. **Progress Artifacts** — checkpoints, commits, signals
6. **Recovery** — what to do if blocked
7. **Critical Constraints** — append at the end

---

## 4) Append These Constraints at the End (Mandatory)

Paste this block at the end of every multi-agent prompt:

```
CRITICAL CONSTRAINTS (append at end, do not omit):
1) Work only in worktrees after wu:claim; main is read-only for WU work.
2) Never bypass hooks (--no-verify, HUSKY=0). Fix root causes instead.
3) WUs are specs, not code; stay within code_paths.
4) Run correct gates before wu:done (docs-only vs full).
5) Use LLM-first inference; avoid brittle regex/keyword shortcuts.
6) If uncertain about safety, stop and ask.
```

For full details, see `.lumenflow/constraints.md`.

---

## 5) Coordination Checklist (Orchestrators)

Before spawning:

- Confirm WU status and lane availability
- Ensure worktree exists (or claim first)
- Provide explicit code_paths and tests
- Require `mem:checkpoint` at 50+ tool calls
- Require `mem:signal` for milestones

After spawning:

- Monitor with `pnpm mem:inbox --since 30m`
- Use `pnpm mem:ready --wu WU-XXX` for handoff status

---

## 6) Related Skills

- `.claude/skills/context-management/SKILL.md`
- `.claude/skills/multi-agent-coordination/SKILL.md`
- `.claude/skills/execution-memory/SKILL.md`
