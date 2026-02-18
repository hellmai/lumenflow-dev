/**
 * Mock LumenFlow AG-UI Server
 *
 * Simulates the LumenFlow kernel's AG-UI endpoint at POST /ag-ui/v1/run.
 * Returns a stream of newline-delimited JSON events that mirror the real
 * AG-UI adapter output (see packages/@lumenflow/surfaces/http/run-agent.ts).
 *
 * This allows the CopilotKit demo to run without a live kernel instance.
 */

import { createServer } from 'node:http';

const PORT = 3101;

const AG_UI_EVENT_TYPES = {
  RUN_STARTED: 'RUN_STARTED',
  STEP_STARTED: 'STEP_STARTED',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_END: 'TOOL_CALL_END',
  TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
  GOVERNANCE_DECISION: 'GOVERNANCE_DECISION',
  STATE_SNAPSHOT: 'StateSnapshot',
  STATE_DELTA: 'StateDelta',
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  RUN_COMPLETED: 'RUN_COMPLETED',
};

function createEvent(type, input, taskId, runId, extraPayload = {}) {
  return {
    type,
    timestamp: new Date().toISOString(),
    threadId: input.threadId,
    runId: input.runId,
    task_id: taskId,
    run_id: runId,
    payload: extraPayload,
    metadata: { source: 'mock_ag_ui_server' },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a realistic sequence of AG-UI events that demonstrate:
 * 1. Task creation (RUN_STARTED)
 * 2. Task claiming (STEP_STARTED)
 * 3. Tool execution with scope enforcement (TOOL_CALL_START/END/RESULT)
 * 4. Policy evaluation (GOVERNANCE_DECISION)
 * 5. State synchronization (StateSnapshot)
 * 6. Text response streaming (TEXT_MESSAGE_START/CONTENT/END)
 * 7. Task completion (RUN_COMPLETED)
 */
async function* generateEvents(input) {
  const taskId = `ag-ui-${input.threadId}-${Date.now()}`;
  const kernelRunId = `run-${Date.now()}`;
  const lastMessage = input.messages[input.messages.length - 1];
  const userContent = lastMessage?.content ?? 'No message provided';

  // 1. Run Started
  yield createEvent(AG_UI_EVENT_TYPES.RUN_STARTED, input, taskId, kernelRunId, {
    messages: input.messages,
    tools: input.tools,
    context: input.context,
  });
  await sleep(200);

  // 2. Step Started (task claimed)
  yield createEvent(AG_UI_EVENT_TYPES.STEP_STARTED, input, taskId, kernelRunId, {
    event: {
      kind: 'task_claimed',
      task_id: taskId,
      run_id: kernelRunId,
      by: 'ag-ui-client',
      session_id: `ag-ui-session-${input.threadId}`,
      timestamp: new Date().toISOString(),
    },
  });
  await sleep(150);

  // 3. Policy evaluation
  yield createEvent(AG_UI_EVENT_TYPES.GOVERNANCE_DECISION, input, taskId, kernelRunId, {
    policy_id: 'workspace-scope-policy',
    decision: 'allow',
    reason: 'Tool execution within declared scopes for lane ag-ui.',
    governance: true,
  });
  await sleep(100);

  // 4. Tool call (simulating a task creation tool)
  const receiptId = `receipt-${Date.now()}`;
  yield createEvent(AG_UI_EVENT_TYPES.TOOL_CALL_START, input, taskId, kernelRunId, {
    receipt_id: receiptId,
    tool_name: 'create_task',
    execution_mode: 'sandboxed',
    input_ref: `cas://sha256/${Buffer.from(userContent).toString('hex').slice(0, 16)}`,
    input_hash: `sha256:${Buffer.from(userContent).toString('hex').slice(0, 32)}`,
    scope_requested: ['create_task'],
    scope_allowed: ['create_task', 'inspect_task', 'list_tasks'],
    scope_enforced: true,
  });
  await sleep(300);

  yield createEvent(AG_UI_EVENT_TYPES.TOOL_CALL_END, input, taskId, kernelRunId, {
    receipt_id: receiptId,
    result: 'success',
    duration_ms: 287,
    policy_decisions: [
      { policy_id: 'lane-scope-policy', decision: 'allow', reason: 'Within lane ag-ui scopes.' },
    ],
    artifacts_written: [`tasks/${taskId}.yaml`],
  });
  await sleep(100);

  yield createEvent(AG_UI_EVENT_TYPES.TOOL_CALL_RESULT, input, taskId, kernelRunId, {
    receipt_id: receiptId,
    output_hash: `sha256:${Date.now().toString(16)}`,
    output_ref: `cas://sha256/${Date.now().toString(16)}`,
    redaction_summary: null,
    scope_enforcement_note: 'All scopes satisfied.',
    result: 'success',
  });
  await sleep(150);

  // 5. State snapshot
  yield createEvent(AG_UI_EVENT_TYPES.STATE_SNAPSHOT, input, taskId, kernelRunId, {
    state: {
      task_id: taskId,
      status: 'in_progress',
      title: `AG-UI RunAgent: ${userContent.slice(0, 80)}`,
      lane_id: 'ag-ui',
      workspace_id: 'ag-ui',
      claimed_by: 'ag-ui-client',
      run_id: kernelRunId,
      evidence_count: 1,
    },
  });
  await sleep(200);

  // 6. Text response - streamed token by token
  const messageId = `msg-${Date.now()}`;
  const responseText = generateResponseText(userContent);

  yield createEvent(AG_UI_EVENT_TYPES.TEXT_MESSAGE_START, input, taskId, kernelRunId, {
    messageId,
    role: 'assistant',
  });
  await sleep(50);

  // Stream response in chunks
  const words = responseText.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = i === 0 ? words[i] : ` ${words[i]}`;
    yield createEvent(AG_UI_EVENT_TYPES.TEXT_MESSAGE_CONTENT, input, taskId, kernelRunId, {
      messageId,
      delta: chunk,
    });
    await sleep(30 + Math.random() * 40);
  }

  yield createEvent(AG_UI_EVENT_TYPES.TEXT_MESSAGE_END, input, taskId, kernelRunId, {
    messageId,
  });
  await sleep(100);

  // 7. Run completed
  yield createEvent(AG_UI_EVENT_TYPES.RUN_COMPLETED, input, taskId, kernelRunId);
}

function generateResponseText(userContent) {
  const lower = userContent.toLowerCase();

  if (lower.includes('create') && lower.includes('task')) {
    return (
      'I have created a new task in LumenFlow. The kernel assigned it to the ag-ui lane, ' +
      'evaluated workspace-level policies (all passed), and the task is now in_progress. ' +
      'The tool execution was sandboxed with bwrap, and an immutable evidence receipt was ' +
      'recorded. You can see the full event trace in the panel on the right.'
    );
  }

  if (lower.includes('policy') || lower.includes('governance')) {
    return (
      'LumenFlow policies cascade through four levels: workspace, lane, pack, and task. ' +
      'Each tool call is evaluated against all applicable policies with deny-wins semantics. ' +
      "A restrictive policy at any level can't be loosened by a lower level. " +
      'The governance decision events in the right panel show policy evaluations in real time.'
    );
  }

  if (lower.includes('evidence') || lower.includes('receipt')) {
    return (
      'Every tool execution in LumenFlow produces an evidence receipt -- a cryptographic record ' +
      'of what was requested, what was allowed, and the content-addressed inputs. These receipts ' +
      'are append-only and tamper-evident. The TOOL_CALL_RESULT events contain output hashes and ' +
      'CAS references you can verify independently.'
    );
  }

  if (lower.includes('scope') || lower.includes('sandbox')) {
    return (
      'Tool execution runs inside a bwrap sandbox with write confinement. Every tool call passes ' +
      'through a 4-level scope intersection: workspace, lane, task, and tool-level permissions ' +
      'must all agree before execution proceeds. The TOOL_CALL_START events show the requested ' +
      'vs allowed vs enforced scopes.'
    );
  }

  return (
    `I received your message: "${userContent.slice(0, 100)}". ` +
    'This response was processed through the LumenFlow AG-UI endpoint. ' +
    'The kernel created a task, evaluated policies, executed tools in a sandboxed environment, ' +
    'and streamed events back via the AG-UI protocol. All events are visible in the right panel.'
  );
}

async function handleRunAgent(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  let input;
  try {
    input = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body.' } }));
    return;
  }

  if (!input.threadId || !input.runId || !Array.isArray(input.messages)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'threadId, runId, and messages are required.' } }));
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  for await (const event of generateEvents(input)) {
    res.write(JSON.stringify(event) + '\n');
  }

  res.end();
}

function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  if (handleCors(req, res)) return;

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/ag-ui/v1/run' && req.method === 'POST') {
    await handleRunAgent(req, res);
    return;
  }

  // Health check
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'mock-ag-ui-server' }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found.' } }));
});

server.listen(PORT, () => {
  console.log(`Mock LumenFlow AG-UI server running at http://localhost:${PORT}`);
  console.log(`  POST /ag-ui/v1/run  - AG-UI RunAgent endpoint`);
  console.log(`  GET  /health        - Health check`);
});
