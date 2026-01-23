# LumenFlow Gates Action

Config-driven quality gates for any language.

## Overview

LumenFlow Gates reads your gate commands from `.lumenflow.config.yaml`, allowing you to define custom format, lint, and test commands for any language or toolchain. No more hardcoded presets.

## Quick Start

### 1. Add gates configuration to `.lumenflow.config.yaml`

```yaml
# .lumenflow.config.yaml
version: '2.0'

gates:
  execution:
    format: 'pnpm format:check'
    lint: 'pnpm lint'
    typecheck: 'pnpm typecheck'
    test: 'pnpm test'
```

### 2. Use the action

```yaml
- uses: hellmai/lumenflow-gates@v1
  with:
    token: ${{ secrets.LUMENFLOW_TOKEN }}
```

## Configuration

### Using Presets

For common languages, use a preset to get sensible defaults:

```yaml
# .lumenflow.config.yaml
gates:
  execution:
    preset: 'python'
    # Override specific commands
    lint: 'mypy . && ruff check .'
```

Available presets: `node`, `python`, `go`, `rust`, `dotnet`

### Custom Commands

Define any commands for your toolchain:

```yaml
# .lumenflow.config.yaml
gates:
  execution:
    setup: 'pnpm install'
    format: 'pnpm prettier --check .'
    lint: 'pnpm eslint .'
    typecheck: 'pnpm tsc --noEmit'
    test: 'pnpm vitest run'
```

### Command Options

Commands can be strings or objects with options:

```yaml
gates:
  execution:
    format: 'dotnet format --verify-no-changes'
    test:
      command: 'dotnet test --no-restore'
      timeout: 300000 # 5 minutes
      continueOnError: false
```

## Language Examples

### Node.js / TypeScript

```yaml
gates:
  execution:
    preset: 'node'
    # Or custom:
    setup: 'pnpm install --frozen-lockfile'
    format: 'pnpm prettier --check .'
    lint: 'pnpm eslint . --max-warnings 0'
    typecheck: 'pnpm tsc --noEmit'
    test: 'pnpm vitest run'
```

### Python

```yaml
gates:
  execution:
    preset: 'python'
    # Or custom:
    setup: 'pip install -e ".[dev]"'
    format: 'ruff format --check .'
    lint: 'ruff check . && mypy .'
    test: 'pytest -v'
```

### .NET

```yaml
gates:
  execution:
    preset: 'dotnet'
    # Or custom:
    setup: 'dotnet restore'
    format: 'dotnet format --verify-no-changes'
    lint: 'dotnet build --no-restore -warnaserror'
    test: 'dotnet test --no-restore --logger "console;verbosity=normal"'
```

### Go

```yaml
gates:
  execution:
    preset: 'go'
    # Or custom:
    format: 'test -z "$(gofmt -l .)"'
    lint: 'golangci-lint run'
    typecheck: 'go vet ./...'
    test: 'go test -v ./...'
```

### Rust

```yaml
gates:
  execution:
    preset: 'rust'
    # Or custom:
    format: 'cargo fmt --check'
    lint: 'cargo clippy -- -D warnings'
    typecheck: 'cargo check'
    test: 'cargo test'
```

## Inputs

| Input               | Description             | Default |
| ------------------- | ----------------------- | ------- |
| `token`             | LumenFlow API token     | -       |
| `working-directory` | Directory to run in     | `.`     |
| `skip-format`       | Skip format check       | `false` |
| `skip-lint`         | Skip lint check         | `false` |
| `skip-typecheck`    | Skip type check         | `false` |
| `skip-test`         | Skip tests              | `false` |

## Outputs

| Output            | Description                     |
| ----------------- | ------------------------------- |
| `preset-detected` | Preset/config mode used         |
| `gates-passed`    | Whether all gates passed (true/false) |

## Backwards Compatibility

If no `gates.execution` config is present, the action falls back to auto-detecting your project type based on files present (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) and uses the corresponding preset defaults.

## Full Workflow Example

```yaml
name: LumenFlow Gates

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Run LumenFlow Gates
        uses: hellmai/lumenflow-gates@v1
        with:
          token: ${{ secrets.LUMENFLOW_TOKEN }}

      - name: Check result
        if: always()
        run: |
          echo "Gates passed: ${{ steps.gates.outputs.gates-passed }}"
          echo "Preset used: ${{ steps.gates.outputs.preset-detected }}"
```

## Monorepo Support

```yaml
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hellmai/lumenflow-gates@v1
        with:
          token: ${{ secrets.LUMENFLOW_TOKEN }}
          working-directory: packages/frontend

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hellmai/lumenflow-gates@v1
        with:
          token: ${{ secrets.LUMENFLOW_TOKEN }}
          working-directory: packages/backend
```

## License

Apache-2.0
