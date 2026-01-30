---
id: skills-selection
name: Skills Selection (Cursor)
required: true
order: 50
tokens: []
---

## Skills Selection (Cursor)

**IMPORTANT**: Before starting work, load relevant rules files.

### Loading Rules

Reference rules files with `@rules`:

- `@rules .cursor/rules/lumenflow.md` - Core LumenFlow workflow
- `@rules .cursor/rules/tdd.md` - Test-driven development
- `@rules .cursor/rules/git-safety.md` - Git workflow safety

### Rules Catalog

View available rules: check `.cursor/rules/` directory

### Recommended by Context

| Context        | Rules to Load   |
| -------------- | --------------- |
| Any WU         | `lumenflow.md`  |
| Feature/Bug    | `tdd.md`        |
| Git operations | `git-safety.md` |

### Graceful Degradation

If rules files are unavailable:

- Follow constraints section below
- Use TDD workflow: RED-GREEN-REFACTOR
