# Contributing to LumenFlow

Thanks for your interest in contributing! This guide covers two workflows:

- **External contributors** (you, probably) -- fork + PR
- **Maintainers** -- trunk-based WU workflow

## External Contributors

### Getting Started

1. Fork the repo on GitHub
2. Clone your fork and install dependencies:

```bash
git clone https://github.com/<your-username>/lumenflow.git
cd lumenflow
pnpm install
pnpm build
```

### Making Changes

1. Create a branch from `main`:

```bash
git checkout -b fix/describe-your-change
```

2. Make your changes
3. Run quality checks locally:

```bash
pnpm lint        # ESLint
pnpm typecheck   # TypeScript
pnpm test        # Vitest
```

4. Commit and push:

```bash
git add <files>
git commit -m "fix: describe what you changed"
git push origin fix/describe-your-change
```

5. Open a pull request on GitHub against `main`

### PR Requirements

- One maintainer approval required
- All CI checks must pass
- Clear description of what changed and why

### What Makes a Good PR

- **Small and focused** -- one logical change per PR
- **Tests included** -- new features need tests, bug fixes need regression tests
- **Passes gates** -- `pnpm lint && pnpm typecheck && pnpm test` all green

## Maintainers (Trunk-Based Workflow)

Maintainers have direct push access to `main` through the LumenFlow WU workflow. We dogfood LumenFlow to build LumenFlow.

```bash
# Create a work unit
pnpm wu:create --lane "Framework: Core" --title "Your change"

# Claim it (creates an isolated git worktree)
pnpm wu:claim --id WU-XXXX

# Work in the worktree
cd worktrees/<lane>-wu-xxxx

# Validate and complete
pnpm wu:prep --id WU-XXXX
cd /path/to/repo && pnpm wu:done --id WU-XXXX
```

This pushes directly to `main` -- no PR needed. The WU lifecycle enforces quality gates, worktree isolation, and atomic merges.

See [LUMENFLOW.md](../LUMENFLOW.md) for the full workflow reference.

## Reporting Issues

- **Bugs**: Open a GitHub issue with steps to reproduce
- **Features**: Open a GitHub issue describing the use case
- **Security**: Do NOT file public issues. Email security@hellm.ai

## Code Style

- TypeScript with strict mode
- Prettier for formatting (auto-checked by gates)
- ESLint 9 flat config
- Vitest for testing

## License

By contributing, you agree that your contributions will be licensed under [Apache-2.0](../LICENSE).
