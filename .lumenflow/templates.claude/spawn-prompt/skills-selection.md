---
id: skills-selection
name: Skills Selection (Claude)
required: true
order: 50
tokens: []
---

## Skills Selection (Claude Code)

**IMPORTANT**: Before starting work, select and load relevant skills.

### Loading Skills

Use the `/skill` command to load skills:

```
/skill wu-lifecycle       # WU claim/block/done automation
/skill tdd-workflow       # RED-GREEN-REFACTOR patterns
/skill worktree-discipline # Prevent absolute path trap
/skill lumenflow-gates    # Gate troubleshooting
```

### Skills Catalog

View available skills: `ls .claude/skills/`

### Recommended by Context

| Context       | Skills to Load                        |
| ------------- | ------------------------------------- |
| Any WU        | `wu-lifecycle`, `worktree-discipline` |
| Feature/Bug   | `tdd-workflow`                        |
| Gates failing | `lumenflow-gates`                     |
| UI work       | `frontend-design`                     |
| Multi-phase   | `initiative-management`               |

### Graceful Degradation

If skills directory is unavailable:

- Load baseline: `/skill wu-lifecycle`, `/skill tdd-workflow`
- Continue with implementation using constraints section
