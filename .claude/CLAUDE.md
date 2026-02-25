# Claude Code Entry Point

**Start here:** Read [docs/04-operations/\_frameworks/lumenflow/agent/onboarding/starting-prompt.md](docs/04-operations/_frameworks/lumenflow/agent/onboarding/starting-prompt.md) for complete onboarding.

Then read `LUMENFLOW.md` for workflow details.

## CLI Commands

### WU Lifecycle

| Command                                        | Description                                               |
| ---------------------------------------------- | --------------------------------------------------------- |
| `pnpm wu:status --id WU-XXX`                   | Show WU status, location, valid commands                  |
| `pnpm wu:claim --id WU-XXX --lane <Lane>`      | Claim WU and create worktree                              |
| `pnpm wu:prep --id WU-XXX`                     | Run gates in worktree                                     |
| `pnpm wu:done --id WU-XXX`                     | Complete WU (from main)                                   |
| `pnpm wu:brief --id WU-XXX --client <client>`  | Generate handoff prompt + record evidence (worktree only) |
| `pnpm wu:delegate --id WU-XXX --parent-wu <P>` | Generate prompt + record delegation lineage               |
| `pnpm wu:recover --id WU-XXX`                  | Fix WU state inconsistencies                              |

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

Delegate WUs to sub-agents:

```bash
pnpm wu:brief --id WU-XXX --client claude-code    # Generate prompt + evidence (worktree only)
pnpm wu:delegate --id WU-XXX --parent-wu WU-YYY   # Generate prompt + evidence + delegation lineage
```

Use `wu:brief` when you want a context-loaded prompt for another agent.
Use `wu:delegate` when you also need auditable lineage tracking (initiative work).

**Important:** When run from a worktree, `wu:brief` records a checkpoint event
to `.lumenflow/state/wu-events.jsonl`. This evidence is **required** — `wu:done`
blocks feature/bug WUs that are missing it. Do not delete or revert `wu-events.jsonl`
entries written by lifecycle commands.

Available agents in `.claude/agents/`:

- `general-purpose` — Standard WU implementation
- `lumenflow-pm` — Backlog & lifecycle management
- `test-engineer` — TDD, coverage enforcement
- `code-reviewer` — Quality checks

## Safe YAML Modification (Constraint 9)

**Never use Write or Edit tools to modify `.lumenflow.config.yaml` or WU YAML files.**

Claude Code has tool-level hooks (PreToolUse) that validate worktree paths, but YAML config files are in the allowlist. This means Write/Edit to these files is not blocked by hooks -- you must follow the policy voluntarily.

| File                     | Safe Command                                 | Do NOT Use           |
| ------------------------ | -------------------------------------------- | -------------------- |
| `.lumenflow.config.yaml` | `pnpm config:set --key <path> --value <val>` | Write/Edit tools     |
| `.lumenflow.config.yaml` | `pnpm config:get --key <path>` (read)        | --                   |
| WU YAML specs            | `pnpm wu:edit --id WU-XXX --field value`     | Write/Edit tools     |
| WU YAML specs            | `pnpm wu:create ...` (creation)              | Write to create YAML |

**Exception:** Reading YAML files with the Read tool is acceptable.

For details, see the [YAML editing policy](.lumenflow/rules/yaml-editing-policy.md) and [agent safety architecture](docs/04-operations/_frameworks/lumenflow/agent-safety-architecture.md).

## Quick Reminders

- **Run `<command> --help` before first use of any unfamiliar CLI command.**
- Load `/skill design-first` before implementing features (question, delete, simplify).
- Always claim WUs with `pnpm wu:claim` and work in the worktree.
- Run `pnpm gates` before `pnpm wu:done`.
- Complete work with `pnpm wu:done --id WU-XXX` from the main checkout.
- Load relevant skills before starting complex work.
- **Never raw-edit YAML files** -- use `pnpm config:set` and `pnpm wu:edit` instead.
