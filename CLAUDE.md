# LumenFlow Development Guide

**Last updated:** 2026-01-19

This repo contains LumenFlow source code. We dogfood LumenFlow to build LumenFlow.

---

## Quick Start

```bash
# 1. Setup (first time only)
pnpm setup

# 2. Create a WU
pnpm wu:create --id WU-XXXX --lane <Lane> --title "Title"

# 3. Edit WU spec with acceptance criteria
# Then claim:
pnpm wu:claim --id WU-XXXX --lane <Lane>
cd worktrees/<lane>-wu-xxxx

# 4. Implement in worktree

# 5. Run gates
pnpm gates --docs-only  # for docs changes
pnpm gates              # for code changes (requires built CLI in worktree)

# 6. Complete (from main)
cd /home/tom/source/hellmai/os
pnpm wu:done --id WU-XXXX
```

---

## Core Principles

1. **Dogfood LumenFlow**: Use LumenFlow workflow for all changes
2. **TDD**: Failing test → implementation → passing test (≥90% coverage on new code)
3. **Library-First**: Search context7 before custom code
4. **DRY/SOLID/KISS/YAGNI**: No magic numbers, no hardcoded strings
5. **Worktree Discipline**: After `wu:claim`, work ONLY in the worktree
6. **Gates Before Done**: All gates must pass before `wu:done`
7. **Do Not Bypass Hooks**: No `--no-verify`, fix issues properly

---

## Lanes

Use "Parent: Sublane" format (e.g., `Framework: CLI`). See `.lumenflow.config.yaml` for full list.

| Lane                       | Packages/Paths                       |
| -------------------------- | ------------------------------------ |
| Framework: Core            | `packages/@lumenflow/core/**`        |
| Framework: CLI             | `packages/@lumenflow/cli/**`         |
| Framework: Memory          | `packages/@lumenflow/memory/**`      |
| Framework: Agent           | `packages/@lumenflow/agent/**`       |
| Framework: Metrics         | `packages/@lumenflow/metrics/**`     |
| Framework: Initiatives     | `packages/@lumenflow/initiatives/**` |
| Framework: Shims           | `packages/@lumenflow/shims/**`       |
| Operations: Infrastructure | `apps/**`, `actions/**`              |
| Operations: CI/CD          | `.github/**`                         |
| Content: Documentation     | `docs/**`                            |

---

## Commands Reference

| Command               | Description                         |
| --------------------- | ----------------------------------- |
| `pnpm setup`          | Install deps and build CLI          |
| `pnpm wu:create`      | Create new WU spec                  |
| `pnpm wu:claim`       | Claim WU and create worktree        |
| `pnpm wu:done`        | Complete WU (merge, stamp, cleanup) |
| `pnpm gates`          | Run quality gates                   |
| `pnpm mem:init`       | Initialize memory layer             |
| `pnpm mem:checkpoint` | Save memory checkpoint              |

---

## Known Bootstrap Issues

1. **Worktree CLI**: Worktrees don't have CLI built. Use `--skip-gates` with `--reason` for bootstrap WUs, or run gates from main with `--docs-only`.

2. **Missing tool scripts**: Some gates expect ExampleApp-specific tools. Stubs exist in `tools/` and `packages/linters/`.

---

## Definition of Done

- Acceptance criteria satisfied
- Gates green (`pnpm gates` or `pnpm gates --docs-only`)
- WU YAML status = `done`
- `.beacon/stamps/WU-<id>.done` exists

---

## References

- [LumenFlow Playbook](docs/lumenflow/playbook.md)
- [WU Sizing Guide](docs/lumenflow/wu-sizing-guide.md)
- [Distribution Plan](docs/plans/distribution-dogfooding.md)
