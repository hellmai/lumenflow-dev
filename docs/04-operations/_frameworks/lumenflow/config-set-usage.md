# config:set and config:get CLI Commands

**Added in:** WU-1902

Safe CLI commands for modifying and reading `workspace.yaml` without directly editing YAML files.

## Why

Agents and users who raw-edit `workspace.yaml` with Write/Edit tools risk:

- Breaking YAML syntax
- Bypassing Zod schema validation
- Getting blocked by worktree hooks on main

`config:set` solves this by validating against the Zod schema before writing and using micro-worktree isolation for atomic commits.

## Commands

### config:set

Safely updates a value in `workspace.yaml`.

```bash
pnpm config:set --key <dotpath> --value <value>
```

**Arguments:**

| Flag      | Required | Description                                              |
| --------- | -------- | -------------------------------------------------------- |
| `--key`   | Yes      | Config key in dot notation (e.g., `methodology.testing`) |
| `--value` | Yes      | Value to set (comma-separated for array append)          |

**Examples:**

```bash
# Set a scalar value
pnpm config:set --key methodology.testing --value test-after

# Set a numeric value
pnpm config:set --key gates.minCoverage --value 85

# Set a boolean value
pnpm config:set --key gates.enableCoverage --value false

# Append to an array field
pnpm config:set --key agents.methodology.principles --value Library-First,KISS

# Set a nested value
pnpm config:set --key experimental.context_validation --value true
```

**Behavior:**

1. Reads the current `workspace.yaml`
2. Coerces the string value to the correct type (boolean, number, array append)
3. Validates the entire config against the Zod schema
4. If validation fails, rejects with a clear error message
5. If validation passes, writes via micro-worktree atomic commit

### config:get

Reads and displays a value from `workspace.yaml`.

```bash
pnpm config:get --key <dotpath>
```

**Arguments:**

| Flag    | Required | Description                                              |
| ------- | -------- | -------------------------------------------------------- |
| `--key` | Yes      | Config key in dot notation (e.g., `methodology.testing`) |

**Examples:**

```bash
# Read a scalar value
pnpm config:get --key methodology.testing
# Output: tdd

# Read a numeric value
pnpm config:get --key gates.minCoverage
# Output: 90

# Read a nested object
pnpm config:get --key methodology
# Output: (YAML-formatted object)

# Read a missing key
pnpm config:get --key nonexistent.key
# Output: [config:get] Key "nonexistent.key" is not set (undefined)
```

## Supported Dotpaths

Any key in the `workspace.yaml` schema can be addressed via dotpath. Common examples:

| Dotpath                           | Type     | Description                    |
| --------------------------------- | -------- | ------------------------------ |
| `methodology.testing`             | enum     | `tdd`, `test-after`, `none`    |
| `methodology.architecture`        | enum     | `hexagonal`, `layered`, `none` |
| `gates.minCoverage`               | number   | Coverage threshold (0-100)     |
| `gates.enableCoverage`            | boolean  | Enable coverage gate           |
| `gates.maxEslintWarnings`         | number   | Max lint warnings              |
| `agents.methodology.principles`   | string[] | Methodology principles array   |
| `experimental.context_validation` | boolean  | Enable context validation      |
| `experimental.validation_mode`    | enum     | `off`, `warn`, `error`         |
| `git.requireRemote`               | boolean  | Require remote repository      |
| `memory.progress_signals.enabled` | boolean  | Enable progress signals        |
| `cleanup.trigger`                 | enum     | `on_done`, `on_init`, `manual` |

## Value Coercion

`config:set` automatically coerces string values:

| Input Value | Existing Type | Coerced To         |
| ----------- | ------------- | ------------------ |
| `"true"`    | any           | `true` (boolean)   |
| `"false"`   | any           | `false` (boolean)  |
| `"42"`      | number        | `42` (number)      |
| `"A,B,C"`   | array         | append A, B, C     |
| `"hello"`   | string        | `"hello"` (string) |

## Error Handling

If the value fails Zod validation, the command exits with a clear error:

```
[config:set] Validation failed for methodology.testing=invalid-value:
  methodology.testing: Invalid enum value. Expected 'tdd' | 'test-after' | 'none', received 'invalid-value'
```

No changes are written to the config file when validation fails.

## Micro-Worktree Isolation

Like `lane:edit`, `config:set` uses the micro-worktree pattern (WU-1262) to commit changes atomically without modifying the main checkout directly. This means:

- Changes are committed in an isolated temporary worktree
- Push failures are retried with rebase (race-safe)
- The main checkout is never directly modified

## Path Resolution Invariant

For runtime code, treat `workspace.yaml` as the only path source of truth:

- Resolve paths from `software_delivery.directories.*` (for example via `createWuPaths()` or `getConfig()`).
- Do not derive sibling paths from other paths (for example `dirname(backlogPath)/status.md`).
- Do not assume fixed depth (for example repeated `dirname()` calls from `statusPath`).

This keeps layouts fully configurable (`simple`, `arc42`, or custom) without hidden coupling.
