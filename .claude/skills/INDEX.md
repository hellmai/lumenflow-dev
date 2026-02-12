# Skills Index

Master registry of all available skills for LumenFlow development.

## Quick Reference

| Skill                                                         | Trigger               | Description                                            |
| ------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| [bug-classification](bug-classification/SKILL.md)             | Bug discovered mid-WU | Classify bugs (P0-P3), fix-in-place vs separate WU     |
| [design-first](design-first/SKILL.md)                         | Before features       | 5-step design validation before implementation         |
| [code-quality](code-quality/SKILL.md)                         | Code review           | SOLID/DRY patterns, hex architecture compliance        |
| [context-management](context-management/SKILL.md)             | Long sessions         | Session checkpoints, output bypass, sub-agent spawning |
| [execution-memory](execution-memory/SKILL.md)                 | After /clear          | Session tracking, context recovery, agent coordination |
| [frontend-design](frontend-design/SKILL.md)                   | React components, UI  | Production-grade frontend interfaces                   |
| [initiative-management](initiative-management/SKILL.md)       | INIT-NNN IDs          | Multi-phase initiatives, cross-lane coordination       |
| [library-first](library-first/SKILL.md)                       | Before custom code    | Validate libraries exist before implementing           |
| [lumenflow-gates](lumenflow-gates/SKILL.md)                   | Gate failures         | Troubleshoot format, lint, typecheck, tests            |
| [multi-agent-coordination](multi-agent-coordination/SKILL.md) | Parallel WUs          | Git branch locking for agent coordination              |
| [ops-maintenance](ops-maintenance/SKILL.md)                   | wu:prune, metrics     | Maintenance tasks, metrics reports, validation         |
| [orchestration](orchestration/SKILL.md)                       | Complex tasks         | Agent dashboard, initiative execution                  |
| [tdd-workflow](tdd-workflow/SKILL.md)                         | New features          | RED-GREEN-REFACTOR, ports-first for hex                |
| [worktree-discipline](worktree-discipline/SKILL.md)           | File operations       | Prevent absolute path trap in worktrees                |
| [wu-lifecycle](wu-lifecycle/SKILL.md)                         | WU operations         | Claim/block/done workflow automation                   |

## By Category

### WU Lifecycle

- **[wu-lifecycle](wu-lifecycle/SKILL.md)** — Claim/block/done workflow automation
- **[worktree-discipline](worktree-discipline/SKILL.md)** — Prevent absolute path trap

### Quality & Testing

- **[design-first](design-first/SKILL.md)** — 5-step validation before implementation (question, delete, simplify)
- **[tdd-workflow](tdd-workflow/SKILL.md)** — Test-driven development (RED-GREEN-REFACTOR)
- **[code-quality](code-quality/SKILL.md)** — SOLID/DRY review, hex architecture
- **[lumenflow-gates](lumenflow-gates/SKILL.md)** — Gate troubleshooting
- **[library-first](library-first/SKILL.md)** — Validate libraries before custom code

### Agent Coordination

- **[multi-agent-coordination](multi-agent-coordination/SKILL.md)** — Parallel WU coordination
- **[orchestration](orchestration/SKILL.md)** — Agent dashboard, initiative execution
- **[context-management](context-management/SKILL.md)** — Session checkpoints, sub-agents
- **[execution-memory](execution-memory/SKILL.md)** — Session tracking, context recovery

### Project Management

- **[initiative-management](initiative-management/SKILL.md)** — Multi-phase initiatives
- **[bug-classification](bug-classification/SKILL.md)** — Bug triage (P0-P3)
- **[ops-maintenance](ops-maintenance/SKILL.md)** — Maintenance, metrics, validation

### UI Development

- **[frontend-design](frontend-design/SKILL.md)** — React components, UI design

## Runtime Discovery

```bash
# List all skills with triggers
ls .claude/skills/*/SKILL.md

# Generate prompt with skill selection
pnpm wu:brief --id WU-XXX --client claude-code

# Get context tier recommendation
pnpm session:recommend
```

## Adding New Skills

1. Create directory: `.claude/skills/<skill-name>/`
2. Create `SKILL.md` with YAML frontmatter:
   ```yaml
   ---
   name: skill-name
   description: One-line description for skill selection
   version: 1.0.0
   source: path/to/canonical/source.md
   last_updated: YYYY-MM-DD
   allowed-tools: Read, Bash, Grep
   ---
   ```
3. Add entry to this INDEX.md
4. Test with skill loading

## Skill Frontmatter Schema

| Field             | Required | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `name`            | Yes      | Skill identifier (matches directory name)   |
| `description`     | Yes      | One-line description for AI skill selection |
| `version`         | Yes      | Semantic version                            |
| `source`          | Yes      | Path to canonical source document           |
| `last_updated`    | Yes      | Last modification date                      |
| `allowed-tools`   | Yes      | Comma-separated list of permitted tools     |
| `source_sections` | No       | Specific sections referenced                |

See [Anthropic Skills Best Practices](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) for authoring guidelines.
