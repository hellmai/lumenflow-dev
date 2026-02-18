# CopilotKit + LumenFlow AG-UI Demo

A React app demonstrating [CopilotKit](https://copilotkit.ai) connected to the
[LumenFlow](https://lumenflow.dev) kernel via the
[AG-UI protocol](https://docs.ag-ui.com).

## What This Demonstrates

- **Task creation via chat** -- Each message creates a kernel task with policy evaluation
- **Tool execution visibility** -- Watch sandboxed tool calls, scope enforcement, and evidence receipts stream in real time
- **Policy intervention** -- See governance decisions (allow/deny) as policies cascade through workspace, lane, pack, and task levels
- **AG-UI event stream** -- The right panel shows the raw newline-delimited JSON event stream from the kernel

## Architecture

```
[CopilotKit React UI]       [Event Log Panel]
       |                           ^
       v                           |
[AG-UI Adapter] --- POST /ag-ui/v1/run ---> [LumenFlow Kernel]
                                              |
                                              |- TaskEngine.createTask()
                                              |- PolicyEngine.evaluate()
                                              |- ToolHost.execute() (bwrap sandbox)
                                              |- EvidenceStore.append()
                                              |
                                              v
                                         [AG-UI Event Stream]
                                         (newline-delimited JSON)
```

## Prerequisites

- Node.js >= 18
- npm or pnpm

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start both the mock AG-UI server and the Vite dev server
npm run dev
```

This runs two processes concurrently:

- **Mock AG-UI server** at `http://localhost:3101` -- simulates the LumenFlow kernel endpoint
- **Vite dev server** at `http://localhost:3100` -- serves the React app with a proxy to the mock server

Open [http://localhost:3100](http://localhost:3100) in your browser.

## Connecting to a Real LumenFlow Kernel

To connect to a running LumenFlow kernel instead of the mock server:

1. Start the LumenFlow runtime with the HTTP surface enabled:

   ```bash
   # From the LumenFlow repo root
   LUMENFLOW_WEB_ENABLE_KERNEL_RUNTIME=1 pnpm --filter @lumenflow/web dev
   ```

2. Update the Vite proxy target in `vite.config.ts`:

   ```ts
   proxy: {
     '/ag-ui': {
       target: 'http://localhost:3000', // LumenFlow web app port
       changeOrigin: true,
     },
   },
   ```

3. Start the demo app (just the Vite server):

   ```bash
   npm run dev:app
   ```

## AG-UI Event Types

The following events stream through the right panel:

| Event                 | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `RUN_STARTED`         | Kernel created a new task from the chat message      |
| `STEP_STARTED`        | Task claimed by the AG-UI session                    |
| `GOVERNANCE_DECISION` | Policy engine evaluated (allow/deny with reason)     |
| `TOOL_CALL_START`     | Tool execution began (shows scopes and sandbox mode) |
| `TOOL_CALL_END`       | Tool execution completed (result, duration, policy)  |
| `TOOL_CALL_RESULT`    | Evidence receipt (output hash, CAS reference)        |
| `StateSnapshot`       | Full task state synchronization                      |
| `TEXT_MESSAGE_*`      | Streamed text response tokens                        |
| `RUN_COMPLETED`       | Task execution finished                              |

## Project Structure

```
copilotkit-demo/
  index.html              Vite entry point
  vite.config.ts          Vite config with AG-UI proxy
  package.json            Dependencies and scripts
  tsconfig.json           TypeScript configuration
  src/
    main.tsx              React entry point
    App.tsx               Root component with CopilotKit provider
    index.css             Styles (dark theme, event log)
    components/
      ChatPanel.tsx       Chat interface connected to AG-UI adapter
      EventLog.tsx        Real-time AG-UI event stream viewer
    lib/
      ag-ui-adapter.ts    Fetch-based AG-UI client (POST + NDJSON parsing)
    server/
      mock-ag-ui-server.mjs  Standalone mock server simulating LumenFlow kernel
```

## How the AG-UI Adapter Works

The adapter (`src/lib/ag-ui-adapter.ts`) sends a `POST /ag-ui/v1/run` request with:

```json
{
  "threadId": "thread-123",
  "runId": "run-456",
  "messages": [{ "id": "msg-1", "role": "user", "content": "Create a task for auth" }]
}
```

The kernel responds with a `text/event-stream` of newline-delimited JSON events.
Each event follows the `AgUiEvent` interface defined in
`packages/@lumenflow/surfaces/http/ag-ui-adapter.ts`.

## License

AGPL-3.0 -- see [LICENSE](../../LICENSE) in the repository root.
