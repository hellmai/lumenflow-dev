# LumenFlow Agents

This directory contains agent definitions for Claude Code Task tool orchestration.

## Design Principle

**Agents = Orchestration, Skills = Validation**

- **Agents** coordinate work, spawn sub-tasks, and manage workflows
- **Skills** provide domain expertise and validation checklists

## Agent Inventory

| Agent                | Model   | Purpose                          | Auto-Invoke Trigger                                        |
| -------------------- | ------- | -------------------------------- | ---------------------------------------------------------- |
| `general-purpose`    | opus    | Standard WU implementation       | Default for most tasks                                     |
| `lumenflow-enforcer` | haiku   | WU validation, gates enforcement | Before `wu:done`, after WU changes                         |
| `lumenflow-pm`       | inherit | WU lifecycle, state repairs      | WU claim/block/done, initiative planning                   |
| `test-engineer`      | inherit | TDD, coverage gaps               | Before implementing features, code touching business logic |
| `code-reviewer`      | opus    | PR review, quality               | Before `wu:done`, PR reviews, cross-package changes        |
| `bug-triage`         | haiku   | Bug classification (P0-P3)       | When bugs discovered mid-WU                                |
| `lumenflow-doc-sync` | haiku   | Keep docs updated                | WU state changes, completion                               |

## Spawning Agents

```bash
# Generate handoff prompt for a WU
pnpm wu:brief --id WU-XXX --client claude-code

# Generate prompt + record delegation lineage
pnpm wu:delegate --id WU-XXX --parent-wu WU-YYY

# Use Task tool with agent type
# Task tool parameter: subagent_type: "lumenflow-pm"
```

## Agent Structure

```yaml
---
name: agent-name
description: When to use this agent
tools: Read, Write, Edit, Bash # Available tools
model: opus|haiku|inherit # Model to use
skills: skill1, skill2 # Skills to load
---
# Agent Instructions

Agent-specific instructions here...
```

## Model Selection

| Model   | Use Case                                                   |
| ------- | ---------------------------------------------------------- |
| opus    | Complex reasoning, architecture, implementation            |
| haiku   | Simple validation, quick checks, lightweight orchestration |
| inherit | Use parent conversation's model                            |

## Token Budgets

Agents have token budget comments indicating expected context consumption:

- **Lean** (~800-1,500): Simple orchestrators that delegate to skills
- **Medium** (~2,000-4,000): Complex analysis, multi-step coordination
- **Full** (~6,000+): Deep implementation work

## Skills Integration

Agents can reference skills using:

```markdown
## Load Skills for Detailed Patterns

/skill tdd-workflow # For test-driven development patterns
/skill code-quality # For SOLID/DRY validation
/skill lumenflow-gates # For gate troubleshooting
```

## Adding New Agents

1. Create `.claude/agents/<agent-name>.md`
2. Add YAML frontmatter with required fields
3. Document primary responsibilities
4. List key documents to reference
5. Define success criteria
6. Add to this README inventory

## Constraints Capsule

All agents must load and verify against `.lumenflow/constraints.md` before starting work. This ensures:

1. Worktree discipline & git safety
2. WUs are specs, not code
3. Docs-only vs code WUs
4. Gates and skip-gates
5. Safety compliance

## Related

- `.claude/skills/` — Domain expertise and validation checklists
- `.lumenflow.config.yaml` — Agent configuration
- `pnpm wu:brief` / `pnpm wu:delegate` — Generate agent prompts
