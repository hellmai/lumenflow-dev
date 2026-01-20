# hellmai/os

HellmAI Operating System: LumenFlow workflow framework.

## Overview

This monorepo contains the open-source LumenFlow framework for AI-native software development workflows.

## Packages

| Package                  | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `@lumenflow/core`        | Core WU lifecycle: state machine, validators, spawn management, memory |
| `@lumenflow/memory`      | Session tracking, context recovery, agent coordination                 |
| `@lumenflow/initiatives` | Multi-phase project orchestration across WUs                           |
| `@lumenflow/agent`       | Agent definitions, skill loading, verification                         |
| `@lumenflow/cli`         | Command-line tools for wu:claim, wu:done, wu:spawn                     |
| `@lumenflow/metrics`     | DORA metrics, flow analysis, telemetry                                 |
| `@lumenflow/shims`       | Git and pnpm safety shims                                              |

## Apps

| App               | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `apps/github-app` | GitHub App for SaaS workflow enforcement (webhooks, billing) |

## Actions

| Action                    | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `actions/lumenflow-gates` | Reusable GitHub Action with language presets (Node, Python, Go, Rust) |

## Documentation

- [LumenFlow Complete Guide](docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md) - Comprehensive framework reference
- [WU Overview](docs/04-operations/_frameworks/lumenflow/wu-overview.md) - Work Unit concepts
- [WU Sizing Guide](docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md) - Scoping work appropriately
- [Invariants](docs/04-operations/_frameworks/lumenflow/invariants.md) - Non-negotiable system rules
- [Templates](docs/templates/) - WU and config templates
- [Distribution Roadmap](docs/DISTRIBUTION.md) - Packaging for consultancy distribution

## Requirements

- Node.js >= 22
- pnpm >= 9

## Getting Started

```bash
# Install dependencies
pnpm install

# Run linting
pnpm lint

# Run type checking
pnpm typecheck

# Run tests
pnpm test

# Build all packages
pnpm build
```

## Development

This project uses:

- **ESLint 9** with flat config for linting
- **Prettier 3.8** for code formatting
- **TypeScript 5.7** for type checking
- **Vitest 4** for testing
- **Turbo 2.7** for monorepo build orchestration

### Architecture

The framework follows hexagonal architecture principles. The ESLint boundaries plugin enforces:

- `ports` - Interface definitions (can only import from `shared`)
- `application` - Business logic (can import from `ports`, `shared`)
- `infrastructure` - External adapters (can import from `ports`, `shared`)
- `shared` - Common utilities (can only import from `shared`)

## License

Apache-2.0
