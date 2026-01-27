# Claude Code Entry Point

**Start here:** Read [docs/04-operations/_frameworks/lumenflow/agent/onboarding/starting-prompt.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/starting-prompt.md) for complete onboarding.

Then read `LUMENFLOW.md` for workflow details.

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

- Always claim WUs with `pnpm wu:claim` and work in the worktree.
- Run `pnpm gates` before `pnpm wu:done`.
- Complete work with `pnpm wu:done --id WU-XXX` from the main checkout.
- Load relevant skills before starting complex work.
