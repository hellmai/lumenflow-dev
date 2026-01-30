---
id: skills-selection
name: Skills Selection (Base)
required: true
order: 50
tokens: []
---

## Skills Selection

**IMPORTANT**: Before starting work, select and load relevant skills for your client tool.

### Recommended Skills by Context

| Context       | Skills to Load                        |
| ------------- | ------------------------------------- |
| Any WU        | `wu-lifecycle`, `worktree-discipline` |
| Feature/Bug   | `tdd-workflow`                        |
| Gates failing | `lumenflow-gates`                     |
| UI work       | `frontend-design`                     |
| Multi-phase   | `initiative-management`               |

### Skills Catalog

Check your client's skills directory for available skills:

- Claude: `.claude/skills/`
- Cursor: `.cursor/rules/`
- LumenFlow: `.lumenflow/skills/`

### Graceful Degradation

If skills are unavailable:

- Follow the constraints section
- Use TDD workflow: RED-GREEN-REFACTOR
- Run `pnpm gates` before completion
