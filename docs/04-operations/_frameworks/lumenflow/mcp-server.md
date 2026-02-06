# @lumenflow/mcp Server

**Purpose:** Document the architecture and usage of the LumenFlow MCP server, which exposes LumenFlow workflow operations as native tools/resources for AI coding assistants.

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

## Tools Model

The MCP server currently exposes 68 tools organized into 10 categories.
The source of truth is `packages/@lumenflow/mcp/src/tools.ts` (`allTools` export).

| Category                 | Count | Purpose                                          |
| ------------------------ | ----- | ------------------------------------------------ |
| Core WU Operations       | 7     | Context + primary WU lifecycle commands          |
| Additional WU Operations | 16    | Extended WU management and recovery operations   |
| Initiative Operations    | 8     | Initiative creation/planning/assignment commands |
| Memory Operations        | 13    | Session memory, checkpoints, inbox/signals       |
| Agent Operations         | 4     | Agent session + issue logging                    |
| Orchestration Operations | 3     | Initiative orchestration/monitoring              |
| Spawn Operations         | 1     | Spawn registry listing                           |
| Flow/Metrics Operations  | 3     | Bottlenecks, reports, metrics snapshot           |
| Validation Operations    | 5     | Skills/backlog/agent validation commands         |
| Setup Operations         | 8     | Init/doctor/integrate/release/template sync      |

For full per-tool parameter and response reference, see:
`apps/docs/src/content/docs/reference/mcp.mdx`.

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

### Publish Authentication (`lumenflow_release`)

The MCP `lumenflow_release` tool delegates to CLI `release`, which uses this auth model:

1. Preferred for CI/automation: `NPM_TOKEN`
2. Also supported: `NODE_AUTH_TOKEN`
3. Local fallback: `_authToken=` entry in `~/.npmrc`

This keeps MCP release behavior aligned with direct CLI release behavior.

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
      "args": ["-y", "@lumenflow/mcp@2.11.0"]
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
│   ├── bin.ts                # stdio entrypoint
│   ├── index.ts              # package exports
│   ├── server.ts             # MCP server factory/handlers
│   ├── tools.ts              # all 68 tool definitions + allTools registry
│   ├── resources.ts          # 3 MCP resources + templates
│   ├── cli-runner.ts         # CLI shell-out adapter for write operations
│   └── __tests__/            # tool/resource/server integration tests
└── package.json
```

---

## Version History

### v2.11 (February 2026) - Launch-Readiness Alignment

Documented current 68-tool / 10-category model, publish auth behavior, and consolidated source layout.

### v1.0 (February 2026) - Initial Architecture

Initial MCP rollout with the first tool/resource set, hybrid execution model (core reads, CLI writes), and stdio transport.
