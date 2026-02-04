# Understanding MCP (Model Context Protocol)

**Purpose:** Explain how MCP works and why LumenFlow uses it, for contributors and users who want to understand the AI integration layer.

## What is MCP?

MCP (Model Context Protocol) is an open standard for AI agents to call external tools. Think of it as a JSON-RPC server that AI clients connect to:

- **Origin:** Created by Anthropic in November 2024
- **Governance:** Donated to Linux Foundation (Agentic AI Foundation) in December 2025
- **Adoption:** OpenAI, Google, Microsoft, and 97M+ monthly SDK downloads

MCP standardizes how AI systems integrate with external data sources and tools, similar to how the Language Server Protocol standardized IDE integrations.

## Why MCP vs CLI?

Without MCP, AI agents must learn CLI command syntax and parse text output:

```
AI thinks: "I need to list WUs... the command is probably pnpm wu:list?"
AI calls:  Bash("pnpm wu:list --status ready")
Result:    "Unknown command: wu:list"  (it's wu:status, not wu:list)
```

With MCP, AI agents see structured tool definitions:

```json
{
  "name": "lumenflow_wu_list",
  "description": "List Work Units by status, lane, or initiative",
  "inputSchema": {
    "type": "object",
    "properties": {
      "status": { "enum": ["ready", "in_progress", "blocked", "done"] },
      "lane": { "type": "string" },
      "limit": { "type": "number", "default": 20 }
    }
  }
}
```

The AI knows exactly what parameters are valid and gets typed responses back.

| CLI Only                | CLI + MCP             |
| ----------------------- | --------------------- |
| AI parses stdout text   | AI gets typed JSON    |
| AI guesses parameters   | AI sees JSON Schema   |
| Manual shell invocation | Native tool calling   |
| Must know commands      | Tools auto-discovered |

## How MCP Works

### The Protocol Flow

```
1. INITIALIZE
   Client → Server: { method: "initialize", params: { capabilities: {...} } }
   Server → Client: { result: { capabilities: { tools: true, resources: true } } }

2. LIST TOOLS
   Client → Server: { method: "tools/list" }
   Server → Client: { result: { tools: [
     { name: "lumenflow_wu_list", inputSchema: {...} },
     { name: "lumenflow_wu_claim", inputSchema: {...} }
   ]}}

3. CALL TOOL
   Client → Server: { method: "tools/call", params: {
     name: "lumenflow_wu_list",
     arguments: { status: "ready" }
   }}
   Server → Client: { result: { content: [{ type: "text", text: "[...]" }] } }

4. READ RESOURCE
   Client → Server: { method: "resources/read", params: {
     uri: "lumenflow://wu/WU-1234"
   }}
   Server → Client: { result: { contents: [{ uri: "...", text: "..." }] } }
```

### Core Primitives

MCP servers expose three types of capabilities:

| Primitive     | Purpose                    | Example                                 |
| ------------- | -------------------------- | --------------------------------------- |
| **Tools**     | Actions the AI can take    | `lumenflow_wu_claim` - claim a WU       |
| **Resources** | Data the AI can read       | `lumenflow://backlog` - backlog content |
| **Prompts**   | Reusable message templates | (LumenFlow doesn't use these)           |

## Transport Options

### stdio (LumenFlow Default)

The client spawns the server as a subprocess and communicates via stdin/stdout:

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

When Claude Code starts:

1. Runs `npx -y @lumenflow/mcp`
2. Server starts, listens on stdin
3. Claude sends JSON-RPC messages
4. Server responds on stdout

**Best for:** Local tools that need filesystem access.

### Streamable HTTP (Modern Standard)

For remote servers, clients connect via HTTP POST with optional SSE for streaming:

```json
{
  "mcpServers": {
    "remote-service": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

**Best for:** Cloud services, shared team resources.

### HTTP + SSE (Legacy)

Protocol version 2024-11-05, maintained for backwards compatibility.

## LumenFlow's MCP Integration

LumenFlow participates in MCP as both consumer and provider:

### As Consumer

LumenFlow projects can use external MCP servers:

```json
{
  "mcpServers": {
    "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}
```

### As Provider

The `@lumenflow/mcp` package exposes LumenFlow as an MCP server:

| Tool                    | What It Does                            |
| ----------------------- | --------------------------------------- |
| `lumenflow_context_get` | Get location, git state, valid commands |
| `lumenflow_wu_list`     | List WUs by status/lane                 |
| `lumenflow_wu_status`   | Detailed WU status                      |
| `lumenflow_wu_create`   | Create new WU                           |
| `lumenflow_wu_claim`    | Claim WU, create worktree               |
| `lumenflow_wu_done`     | Complete WU                             |
| `lumenflow_gates_run`   | Run quality gates                       |

See [mcp-server.md](mcp-server.md) for full tool reference.

## Security Considerations

### User Consent

The MCP specification requires that hosts obtain explicit user consent before invoking tools. AI clients like Claude Code implement this at the protocol level.

### Local Trust Model

LumenFlow's MCP server runs locally with the same permissions as the user. No additional authentication is required for local stdio transport.

### Tool Safety

Per the MCP specification: "Tools represent arbitrary code execution and must be treated with appropriate caution."

LumenFlow mitigates this by:

- Routing write operations through the CLI (preserving hooks/enforcement)
- Not exposing dangerous overrides like `skip_gates`
- Validating context (main vs worktree) before operations

### Annotations

Tool descriptions and annotations are considered "untrusted unless obtained from a trusted server." Since LumenFlow runs locally from your own project, it's a trusted server.

## MCP Ecosystem

### SDKs Available

| Language   | Package                     |
| ---------- | --------------------------- |
| TypeScript | `@modelcontextprotocol/sdk` |
| Python     | `mcp`                       |
| C#         | Available                   |
| Java       | Available                   |

### Industry Adoption

- **December 2025:** Donated to Linux Foundation
- **2026:** Gartner predicts 40% of enterprise apps will include AI agents
- **Future:** Multi-agent collaboration ("agent squads") orchestrated via MCP

## Learning Resources

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25) - Official protocol spec
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Reference implementation
- [Anthropic MCP Course](https://anthropic.skilljar.com/introduction-to-model-context-protocol) - Hands-on tutorial

---

## Version History

### v1.0 (February 2026) - Initial Guide

Documented MCP concepts, protocol flow, transport options, and LumenFlow's dual role as MCP consumer and provider.
