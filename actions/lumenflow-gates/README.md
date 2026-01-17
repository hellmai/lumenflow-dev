# LumenFlow Gates Action

AI-native quality gates with automatic language detection.

## Usage

### Basic (Auto-detect)

```yaml
- uses: hellmai/lumenflow-gates@v1
```

Automatically detects your project type from:
- `package.json` → Node.js/TypeScript
- `pyproject.toml` / `setup.py` → Python
- `go.mod` → Go
- `Cargo.toml` → Rust

### Specify Preset

```yaml
- uses: hellmai/lumenflow-gates@v1
  with:
    preset: python
    python-version: '3.11'
```

### Skip Specific Gates

```yaml
- uses: hellmai/lumenflow-gates@v1
  with:
    skip-typecheck: true  # For JS projects without TypeScript
```

## Presets

### Node.js (`node`)

| Gate | Command | Fallback |
|------|---------|----------|
| Format | `npm run format:check` | `prettier --check .` |
| Lint | `npm run lint` | `eslint .` |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Test | `npm test` | - |

Supports: npm, pnpm, yarn, bun (auto-detected from lockfile)

### Python (`python`)

| Gate | Command | Fallback |
|------|---------|----------|
| Format | `ruff format --check .` | `black --check .` |
| Lint | `ruff check .` | `flake8 .` |
| Typecheck | `mypy .` | - |
| Test | `pytest` | `python -m unittest discover` |

### Go (`go`)

| Gate | Command |
|------|---------|
| Format | `gofmt -l .` |
| Lint | `golangci-lint run` |
| Typecheck | `go vet ./...` |
| Test | `go test ./...` |

### Rust (`rust`)

| Gate | Command |
|------|---------|
| Format | `cargo fmt --check` |
| Lint | `cargo clippy -- -D warnings` |
| Typecheck | `cargo check` |
| Test | `cargo test` |

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `preset` | Language preset | `auto` |
| `working-directory` | Directory to run in | `.` |
| `node-version` | Node.js version | `20` |
| `python-version` | Python version | `3.12` |
| `go-version` | Go version | `1.22` |
| `skip-format` | Skip format check | `false` |
| `skip-lint` | Skip lint check | `false` |
| `skip-typecheck` | Skip type check | `false` |
| `skip-test` | Skip tests | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `preset-detected` | The preset that was used |
| `gates-passed` | Whether all gates passed |

## Full Example

```yaml
name: LumenFlow Gates

on:
  pull_request:
    branches: [main]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: hellmai/lumenflow-gates@v1
        with:
          preset: auto
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
          working-directory: packages/frontend
          preset: node

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hellmai/lumenflow-gates@v1
        with:
          working-directory: packages/backend
          preset: python
```

## License

Apache-2.0
