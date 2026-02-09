# Claude Code Entry Point

**Start here:** Read [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/starting-prompt.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/starting-prompt.md) for complete onboarding.

Then read `LUMENFLOW.md` for workflow details.

## CLI Commands

### WU Lifecycle

| Command                                   | Description                              |
| ----------------------------------------- | ---------------------------------------- |
| `pnpm wu:status --id WU-XXX`              | Show WU status, location, valid commands |
| `pnpm wu:claim --id WU-XXX --lane <Lane>` | Claim WU and create worktree             |
| `pnpm wu:prep --id WU-XXX`                | Run gates in worktree                    |
| `pnpm wu:done --id WU-XXX`                | Complete WU (from main)                  |
| `pnpm wu:spawn --id WU-XXX`               | Generate sub-agent spawn prompt          |
| `pnpm wu:recover --id WU-XXX`             | Fix WU state inconsistencies             |

### Gates & Orchestration

| Command                                    | Description                  |
| ------------------------------------------ | ---------------------------- |
| `pnpm gates`                               | Run all quality gates        |
| `pnpm orchestrate:init-status -i INIT-XXX` | Initiative progress view     |
| `pnpm orchestrate:monitor`                 | Monitor spawn/agent activity |
| `pnpm mem:inbox --since 30m`               | Check coordination signals   |
| `pnpm mem:checkpoint --wu WU-XXX`          | Save progress checkpoint     |
| `pnpm mem:recover --wu WU-XXX`             | Generate recovery context    |

### Context Recovery (WU-1394)

Recovery hooks automatically preserve context across compaction:

- **PreCompact hook**: Saves checkpoint and writes recovery file before `/compact`
- **SessionStart hook**: Reads recovery context after compaction/resume/clear

Hook files are scaffolded by `lumenflow init --client claude` in `.claude/hooks/`.

For manual recovery: `pnpm mem:recover --wu WU-XXX`

## Skills

Load skills for domain expertise:

```bash
/skill wu-lifecycle       # WU claim/block/done automation
/skill tdd-workflow       # RED-GREEN-REFACTOR patterns
/skill lumenflow-gates    # Gate troubleshooting
/skill worktree-discipline # Prevent path trap
```

View all skills: `ls .claude/skills/`

## Agents

Spawn sub-agents for parallel work:

```bash
pnpm wu:spawn --id WU-XXX --client claude-code
```

Use `wu:spawn` when:

- You need parallel investigation or implementation on the same WU.
- You want a standardized, context-loaded prompt for another agent.

Available agents in `.claude/agents/`:

- `general-purpose` — Standard WU implementation
- `lumenflow-pm` — Backlog & lifecycle management
- `test-engineer` — TDD, coverage enforcement
- `code-reviewer` — Quality checks

## Quick Reminders

- **Run `<command> --help` before first use of any unfamiliar CLI command.**
- Load `/skill design-first` before implementing features (question, delete, simplify).
- Always claim WUs with `pnpm wu:claim` and work in the worktree.
- Run `pnpm gates` before `pnpm wu:done`.
- Complete work with `pnpm wu:done --id WU-XXX` from the main checkout.
- Load relevant skills before starting complex work.
