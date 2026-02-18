// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { KernelRuntime, TaskSpec } from '@lumenflow/kernel';
import { AG_UI_EVENT_TYPES, type AgUiEvent } from './ag-ui-adapter.js';
import type { EventSubscriber } from './event-stream.js';

const HTTP_METHOD = {
  POST: 'POST',
} as const;

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_SERVER_ERROR: 500,
} as const;

const HEADER = {
  CACHE_CONTROL: 'cache-control',
  CONNECTION: 'connection',
  CONTENT_TYPE: 'content-type',
} as const;

const HEADER_VALUE = {
  CACHE_CONTROL: 'no-cache',
  CONNECTION: 'keep-alive',
  EVENT_STREAM: 'text/event-stream; charset=utf-8',
  JSON: 'application/json; charset=utf-8',
} as const;

const JSON_RESPONSE_KEY_ERROR = 'error';
const JSON_RESPONSE_KEY_MESSAGE = 'message';
const JSON_LINE_SEPARATOR = '\n';
const UTF8_ENCODING = 'utf8';
const JSON_BODY_EMPTY = '';

const RUN_AGENT_DEFAULTS = {
  WORKSPACE_ID: 'ag-ui',
  LANE_ID: 'ag-ui',
  DOMAIN: 'ag-ui',
  RISK: 'low' as const,
  TYPE: 'runtime' as const,
  PRIORITY: 'P2' as const,
  TITLE_PREFIX: 'AG-UI RunAgent: ',
  BY_PREFIX: 'ag-ui-client',
  SESSION_PREFIX: 'ag-ui-session-',
} as const;

interface RunAgentMessage {
  id: string;
  role: string;
  content: string;
}

interface RunAgentTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface RunAgentContext {
  name: string;
  description?: string;
  value: unknown;
}

export interface RunAgentInput {
  threadId: string;
  runId: string;
  messages: RunAgentMessage[];
  tools?: RunAgentTool[];
  context?: RunAgentContext[];
  state?: Record<string, unknown>;
  forwardedProps?: Record<string, unknown>;
}

/**
 * AG-UI RunAgent event extends the base AG-UI event with CopilotKit-compatible
 * threadId and runId fields at the event level. These are separate from kernel
 * task_id/run_id and map to the AG-UI client's thread/run identifiers.
 */
export interface RunAgentEvent extends AgUiEvent {
  threadId: string;
  runId: string;
}

export interface RunAgentRouter {
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ): Promise<boolean>;
}

class RunAgentValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = HTTP_STATUS.BAD_REQUEST) {
    super(message);
    this.statusCode = statusCode;
  }
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = JSON_BODY_EMPTY;
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString(UTF8_ENCODING) : String(chunk);
  }
  return body;
}

async function readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
  const rawBody = await readRequestBody(request);
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new RunAgentValidationError('Request body must be valid JSON.');
  }
}

function validateRunAgentInput(payload: unknown): RunAgentInput {
  if (!isJsonRecord(payload)) {
    throw new RunAgentValidationError('Request body must be a JSON object.');
  }

  const { threadId, runId, messages, tools, context, state, forwardedProps } = payload;

  if (typeof threadId !== 'string' || threadId.trim().length === 0) {
    throw new RunAgentValidationError('threadId is required and must be a non-empty string.');
  }

  if (typeof runId !== 'string' || runId.trim().length === 0) {
    throw new RunAgentValidationError('runId is required and must be a non-empty string.');
  }

  if (!Array.isArray(messages)) {
    throw new RunAgentValidationError('messages is required and must be an array.');
  }

  const validatedMessages: RunAgentMessage[] = [];
  for (const msg of messages) {
    if (!isJsonRecord(msg)) {
      throw new RunAgentValidationError('Each message must be a JSON object.');
    }
    validatedMessages.push({
      id: typeof msg.id === 'string' ? msg.id : '',
      role: typeof msg.role === 'string' ? msg.role : 'user',
      content: typeof msg.content === 'string' ? msg.content : '',
    });
  }

  const validatedTools: RunAgentTool[] = [];
  if (tools !== undefined) {
    if (!Array.isArray(tools)) {
      throw new RunAgentValidationError('tools must be an array when provided.');
    }
    for (const tool of tools) {
      if (!isJsonRecord(tool)) {
        throw new RunAgentValidationError('Each tool must be a JSON object.');
      }
      validatedTools.push({
        name: typeof tool.name === 'string' ? tool.name : '',
        description: typeof tool.description === 'string' ? tool.description : undefined,
        parameters: isJsonRecord(tool.parameters) ? tool.parameters : undefined,
      });
    }
  }

  const validatedContext: RunAgentContext[] = [];
  if (context !== undefined) {
    if (!Array.isArray(context)) {
      throw new RunAgentValidationError('context must be an array when provided.');
    }
    for (const ctx of context) {
      if (!isJsonRecord(ctx)) {
        throw new RunAgentValidationError('Each context entry must be a JSON object.');
      }
      validatedContext.push({
        name: typeof ctx.name === 'string' ? ctx.name : '',
        description: typeof ctx.description === 'string' ? ctx.description : undefined,
        value: ctx.value,
      });
    }
  }

  return {
    threadId,
    runId,
    messages: validatedMessages,
    tools: validatedTools.length > 0 ? validatedTools : undefined,
    context: validatedContext.length > 0 ? validatedContext : undefined,
    state: isJsonRecord(state) ? state : undefined,
    forwardedProps: isJsonRecord(forwardedProps) ? forwardedProps : undefined,
  };
}

function buildTaskTitle(input: RunAgentInput): string {
  const lastMessage = input.messages[input.messages.length - 1];
  const snippet = lastMessage?.content.slice(0, 80) ?? input.runId;
  return `${RUN_AGENT_DEFAULTS.TITLE_PREFIX}${snippet}`;
}

function buildTaskDescription(input: RunAgentInput): string {
  return input.messages.map((msg) => `[${msg.role}] ${msg.content}`).join('\n');
}

function buildDeclaredScopes(_input: RunAgentInput): TaskSpec['declared_scopes'] {
  return [];
}

function buildTaskSpec(input: RunAgentInput, taskId: string): TaskSpec {
  return {
    id: taskId,
    workspace_id: RUN_AGENT_DEFAULTS.WORKSPACE_ID,
    lane_id: RUN_AGENT_DEFAULTS.LANE_ID,
    domain: RUN_AGENT_DEFAULTS.DOMAIN,
    title: buildTaskTitle(input),
    description: buildTaskDescription(input),
    acceptance: [],
    declared_scopes: buildDeclaredScopes(input),
    risk: RUN_AGENT_DEFAULTS.RISK,
    type: RUN_AGENT_DEFAULTS.TYPE,
    priority: RUN_AGENT_DEFAULTS.PRIORITY,
    created: new Date().toISOString().split('T')[0] ?? '',
  };
}

function generateTaskId(input: RunAgentInput): string {
  return `ag-ui-${input.threadId}-${Date.now()}`;
}

function writeJsonError(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  message: string,
): void {
  response.statusCode = statusCode;
  response.setHeader(HEADER.CONTENT_TYPE, HEADER_VALUE.JSON);
  response.end(
    JSON.stringify({
      [JSON_RESPONSE_KEY_ERROR]: {
        [JSON_RESPONSE_KEY_MESSAGE]: message,
      },
    }),
  );
}

function writeEventStreamHeaders(response: ServerResponse<IncomingMessage>): void {
  response.statusCode = HTTP_STATUS.OK;
  response.setHeader(HEADER.CONTENT_TYPE, HEADER_VALUE.EVENT_STREAM);
  response.setHeader(HEADER.CACHE_CONTROL, HEADER_VALUE.CACHE_CONTROL);
  response.setHeader(HEADER.CONNECTION, HEADER_VALUE.CONNECTION);
}

function writeRunAgentEvent(response: ServerResponse<IncomingMessage>, event: RunAgentEvent): void {
  const payload = `${JSON.stringify(event)}${JSON_LINE_SEPARATOR}`;
  response.write(payload);
}

function createRunAgentEvent(
  type: string,
  input: RunAgentInput,
  taskId: string,
  kernelRunId: string | undefined,
  extraPayload: Record<string, unknown> = {},
): RunAgentEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    threadId: input.threadId,
    runId: input.runId,
    task_id: taskId,
    run_id: kernelRunId,
    payload: extraPayload,
    metadata: {
      source: 'ag_ui_run_agent',
    },
  };
}

export function createRunAgentRouter(
  runtime: KernelRuntime,
  _eventSubscriber?: EventSubscriber,
): RunAgentRouter {
  return {
    async handleRequest(
      request: IncomingMessage,
      response: ServerResponse<IncomingMessage>,
    ): Promise<boolean> {
      const method = request.method ?? '';

      if (method !== HTTP_METHOD.POST) {
        writeJsonError(response, HTTP_STATUS.METHOD_NOT_ALLOWED, `Unsupported method: ${method}`);
        return true;
      }

      let input: RunAgentInput;
      try {
        const body = await readJsonRequestBody(request);
        input = validateRunAgentInput(body);
      } catch (error) {
        if (error instanceof RunAgentValidationError) {
          writeJsonError(response, error.statusCode, error.message);
          return true;
        }
        writeJsonError(response, HTTP_STATUS.BAD_REQUEST, 'Invalid request body.');
        return true;
      }

      try {
        writeEventStreamHeaders(response);

        const taskId = generateTaskId(input);
        const taskSpec = buildTaskSpec(input, taskId);

        const createResult = await runtime.createTask(taskSpec);
        const createdTaskId = createResult.task.id;

        const claimResult = await runtime.claimTask({
          task_id: createdTaskId,
          by: `${RUN_AGENT_DEFAULTS.BY_PREFIX}`,
          session_id: `${RUN_AGENT_DEFAULTS.SESSION_PREFIX}${input.threadId}`,
        });

        const runId = claimResult.run?.run_id;

        const runStartedEvent = createRunAgentEvent(
          AG_UI_EVENT_TYPES.RUN_STARTED,
          input,
          createdTaskId,
          runId,
          {
            messages: input.messages,
            tools: input.tools,
            context: input.context,
          },
        );
        writeRunAgentEvent(response, runStartedEvent);

        const runCompletedEvent = createRunAgentEvent(
          AG_UI_EVENT_TYPES.RUN_COMPLETED,
          input,
          createdTaskId,
          runId,
        );
        writeRunAgentEvent(response, runCompletedEvent);

        response.end();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'RunAgent execution failed.';
        writeJsonError(response, HTTP_STATUS.INTERNAL_SERVER_ERROR, message);
        return true;
      }
    },
  };
}
