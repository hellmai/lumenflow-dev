# @lumenflow/mcp Server

**Purpose:** Document the architecture and usage of the LumenFlow MCP server, which exposes WU lifecycle operations as native tools for AI coding assistants.

## Overview

The `@lumenflow/mcp` package exposes LumenFlow as an MCP (Model Context Protocol) server. This allows AI agents to manage Work Units natively, with typed parameters and structured responses, instead of learning CLI command syntax.

```
┌─────────────────┐     stdio          ┌─────────────────┐
│   AI Client     │ ←────────────────→ │   MCP Server    │
│  (Claude Code)  │   JSON-RPC 2.0     │  (@lumenflow/   │
│                 │                     │      mcp)       │
└─────────────────┘                     └─────────────────┘
        │                                       │
        │ "Call lumenflow_wu_list"              │
        │ ─────────────────────────────────→    │
        │                                       │ reads from
        │ { wus: [...] }                        │ @lumenflow/core
        │ ←─────────────────────────────────    │
```

## Quick Start

### Installation

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "lumenflow": {
      "command": "npx",
      "args": ["-y", "@lumenflow/mcp"]
    }
  }
}
```

Or use `lumenflow init` which scaffolds this automatically:

```bash
pnpm lumenflow init --client claude
```

### Verification

```bash
# List connected MCP servers in Claude Code
claude mcp list

# Should show:
# - lumenflow (connected)
```

## Tools Reference

### lumenflow_context_get

Get current execution context: location, git state, active WU, valid commands.

| Parameter | Type   | Required | Description                    |
| --------- | ------ | -------- | ------------------------------ |
| `cwd`     | string | No       | Override working directory     |
| `wu_id`   | string | No       | Specific WU to get context for |

**Returns:** `WuContext` with location, git state, WU info, valid commands.

### lumenflow_wu_list

List Work Units by status, lane, or filter.

| Parameter | Type   | Required | Description                                         |
| --------- | ------ | -------- | --------------------------------------------------- |
| `cwd`     | string | No       | Project root override                               |
| `status`  | enum   | No       | Filter by status: ready, in_progress, blocked, done |
| `lane`    | string | No       | Filter by lane name                                 |
| `limit`   | number | No       | Max results (default: 20)                           |

**Returns:** Array of `{ id, status, lane, title, completedAt? }`

### lumenflow_wu_status

Get detailed status for a specific WU.

| Parameter | Type   | Required | Description             |
| --------- | ------ | -------- | ----------------------- |
| `wu_id`   | string | Yes      | WU ID (e.g., "WU-1234") |
| `cwd`     | string | No       | Project root override   |

**Returns:** YAML-derived status with consistency validation.

### lumenflow_wu_create

Create a new WU spec.

| Parameter     | Type     | Required | Description                             |
| ------------- | -------- | -------- | --------------------------------------- |
| `lane`        | string   | Yes      | Lane name                               |
| `title`       | string   | Yes      | WU title                                |
| `description` | string   | Yes      | Context/problem/solution                |
| `acceptance`  | string[] | Yes      | Acceptance criteria                     |
| `code_paths`  | string[] | No       | Files to modify                         |
| `exposure`    | enum     | Yes      | ui, api, backend-only, documentation    |
| `id`          | string   | No       | Explicit ID (auto-generates if omitted) |

**Returns:** CLI output with created WU ID.

### lumenflow_wu_claim

Claim a WU and create worktree.

| Parameter | Type    | Required | Description                     |
| --------- | ------- | -------- | ------------------------------- |
| `wu_id`   | string  | Yes      | WU ID to claim                  |
| `lane`    | string  | Yes      | Lane name                       |
| `cwd`     | string  | No       | Project root override           |
| `force`   | boolean | No       | Force claim even if lane locked |

**Returns:** CLI output with worktree path.

### lumenflow_wu_done

Complete a WU (runs gates, merges, stamps).

| Parameter | Type   | Required | Description           |
| --------- | ------ | -------- | --------------------- |
| `wu_id`   | string | Yes      | WU ID to complete     |
| `cwd`     | string | No       | Project root override |

**Returns:** CLI output with completion summary.

**Note:** Must be run from main checkout, not worktree. The server validates this.

### lumenflow_gates_run

Run quality gates.

| Parameter    | Type    | Required | Description                           |
| ------------ | ------- | -------- | ------------------------------------- |
| `cwd`        | string  | No       | Working directory (worktree ok)       |
| `docs_only`  | boolean | No       | Skip code gates for docs-only changes |
| `full_tests` | boolean | No       | Run all tests, not just affected      |
| `full_lint`  | boolean | No       | Lint all files, not just changed      |

**Returns:** CLI output with gate results.

## Resources Reference

| URI                   | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `lumenflow://context` | Current execution context (same as lumenflow_context_get) |
| `lumenflow://wu/{id}` | Raw WU YAML content for specific WU                       |
| `lumenflow://backlog` | Raw backlog.md content                                    |

## Architecture

### Hybrid Execution Model

```
┌────────────────────────────────────────────────────────────┐
│                    @lumenflow/mcp                          │
├────────────────────────────────────────────────────────────┤
│  Read Operations          │  Write Operations              │
│  ─────────────────────    │  ────────────────────────      │
│  Import @lumenflow/core   │  Shell out to CLI              │
│  - Fast, typed responses  │  - Preserves hooks/enforcement │
│  - Direct state access    │  - Same behavior as manual     │
│                           │  - Audit trail maintained      │
└────────────────────────────────────────────────────────────┘
```

**Why CLI for writes?**

1. **Hooks preserved:** Pre-commit hooks, validation, enforcement all trigger
2. **Audit trail:** Same commits and state changes as manual operation
3. **Single source of truth:** CLI is authoritative for write operations
4. **Safety:** Dangerous operations go through same gates as human users

### Core APIs Used

The MCP server imports these from `@lumenflow/core`:

| API              | Purpose                           |
| ---------------- | --------------------------------- |
| `computeContext` | Location, git state, WU detection |
| `WUStateStore`   | Event-sourced WU state            |
| `readWURaw`      | WU YAML parsing                   |
| `listWUs`        | Merged state + YAML listing       |
| `toJSONSchema`   | Convert Zod schemas to MCP format |

### Transport

**Default:** stdio (local process communication)

The AI client spawns the MCP server as a subprocess and communicates via stdin/stdout using JSON-RPC 2.0.

**Future:** Streamable HTTP for remote/cloud scenarios (not in MVP).

## Security Model

### Local Trust

The MCP server runs locally with same permissions as the user. No additional authentication required.

### Enforcement Preserved

- Write operations go through CLI, triggering all hooks
- `skip_gates` is **not exposed** via MCP (enforcement is non-negotiable)
- Lane locks and state validation enforced by underlying CLI

### MCP Protocol Security

Per MCP specification, hosts must obtain user consent before tool invocation. Claude Code and other MCP clients handle this at the protocol level.

## Configuration

### Environment Variables

| Variable                  | Description                                 | Default     |
| ------------------------- | ------------------------------------------- | ----------- |
| `LUMENFLOW_PROJECT_ROOT`  | Override project root detection             | Auto-detect |
| `LUMENFLOW_MCP_LOG_LEVEL` | Logging verbosity: debug, info, warn, error | info        |

### Version Pinning

```json
{
  "mcpServers": {
    "lumenflow": {
      "command": "npx",
      "args": ["-y", "@lumenflow/mcp@1.2.3"]
    }
  }
}
```

## Comparison: CLI vs MCP

| Aspect              | CLI Only           | CLI + MCP           |
| ------------------- | ------------------ | ------------------- |
| Parameter discovery | AI guesses flags   | AI sees JSON Schema |
| Output parsing      | AI parses stdout   | AI gets typed JSON  |
| Error handling      | Text parsing       | Structured errors   |
| Discoverability     | Must know commands | Tools auto-listed   |
| Integration         | Manual bash calls  | Native tool calling |

## Package Structure

```
packages/@lumenflow/mcp/
├── src/
│   ├── index.ts              # CLI entrypoint (bin)
│   ├── server.ts             # MCP server bootstrap
│   ├── tools/
│   │   ├── context.ts        # lumenflow_context_get
│   │   ├── wu.ts             # wu_list, wu_status, wu_create, wu_claim, wu_done
│   │   └── gates.ts          # lumenflow_gates_run
│   ├── resources/
│   │   ├── context.ts        # lumenflow://context
│   │   ├── wu.ts             # lumenflow://wu/{id}
│   │   └── backlog.ts        # lumenflow://backlog
│   └── lib/
│       ├── cli-runner.ts     # Spawn CLI, capture output
│       ├── paths.ts          # Project root resolution
│       └── schema.ts         # Zod to JSON Schema mapping
└── package.json
```

---

## Version History

### v1.0 (February 2026) - Initial Architecture

Documented MCP server design with 7 MVP tools, 3 resources, hybrid execution model (core reads, CLI writes), and stdio transport.
