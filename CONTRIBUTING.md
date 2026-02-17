# Contributing to LumenFlow

Thank you for your interest in contributing to LumenFlow! This document explains
our contribution process.

## Contributor License Agreement (CLA)

Before we can accept your contribution, you must sign our Contributor License
Agreement. This is required because LumenFlow uses a dual-licensing model:

- **AGPL v3** for the kernel, packs, surfaces, and runtime
- **Apache 2.0** for the control-plane-sdk

The CLA allows HellmAI to offer commercial licenses to enterprises that cannot
use AGPL-licensed software. Your contribution remains open source under the
original license — the CLA simply grants HellmAI the right to include your code
in commercial offerings as well.

When you open your first pull request, the CLA bot will guide you through the
signing process. It takes less than a minute.

## Getting Started

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all gates pass: `pnpm gates`
5. Submit a pull request

## Development Setup

```bash
# Install dependencies
pnpm install

# Build the CLI and all dependencies
pnpm bootstrap

# Run quality gates (format, lint, typecheck, test)
pnpm gates
```

## Code Style

- TypeScript strict mode
- Prettier for formatting (runs automatically via gates)
- ESLint for linting
- No magic numbers or hardcoded strings

## SPDX Headers

All source files must include an SPDX license header. Use the appropriate header
for the package you are modifying:

**AGPL packages** (kernel, packs, surfaces, runtime):

```typescript
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
```

**Apache 2.0 packages** (control-plane-sdk):

```typescript
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0
```

## Pull Request Guidelines

- Keep PRs focused — one logical change per PR
- Include tests for new functionality (target 90%+ coverage)
- Update relevant documentation
- Ensure all CI checks pass before requesting review

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing to LumenFlow, you agree that your contributions will be licensed
under the same license as the package you are contributing to (AGPL v3 or
Apache 2.0), subject to the terms of the CLA.
