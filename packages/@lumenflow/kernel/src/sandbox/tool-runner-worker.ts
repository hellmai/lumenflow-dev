import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  ToolOutputSchema,
  ToolScopeSchema,
  type ToolOutput,
  type ToolScope,
} from '../kernel.schemas.js';
import { UTF8_ENCODING } from '../shared-constants.js';
import { resolveScopeEnforcementNote } from './profile.js';

export interface ToolRunnerWorkerContext {
  tool_name: string;
  receipt_id: string;
  scope_enforced: ToolScope[];
}

export const ToolRunnerWorkerInvocationSchema = z.object({
  tool_name: z.string().min(1),
  handler_entry: z.string().min(1),
  input: z.unknown(),
  scope_enforced: z.array(ToolScopeSchema),
  receipt_id: z.string().min(1),
});

export type ToolRunnerWorkerInvocation = z.infer<typeof ToolRunnerWorkerInvocationSchema>;

export const ToolRunnerWorkerResponseSchema = z.object({
  output: ToolOutputSchema,
});

export type ToolRunnerWorkerResponse = z.infer<typeof ToolRunnerWorkerResponseSchema>;

export interface ToolRunnerWorkerExecutionOptions {
  importModule?: (specifier: string) => Promise<unknown>;
}

export interface ToolRunnerWorkerStreams {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

type ToolAdapter = (input: unknown, context: ToolRunnerWorkerContext) => Promise<unknown> | unknown;

function buildFailureOutput(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ToolOutput {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function withScopeNote(output: ToolOutput, scopeEnforced: ToolScope[]): ToolOutput {
  const note = resolveScopeEnforcementNote(scopeEnforced);
  if (!note) {
    return output;
  }
  return {
    ...output,
    metadata: {
      ...(output.metadata || {}),
      scope_enforcement_note: note,
    },
  };
}

async function defaultImportModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function resolveEntrySpecifier(entry: string): string {
  if (entry.startsWith('file:')) {
    return entry;
  }
  if (path.isAbsolute(entry)) {
    return pathToFileURL(path.resolve(entry)).href;
  }
  if (entry.startsWith('.')) {
    return pathToFileURL(path.resolve(process.cwd(), entry)).href;
  }
  return entry;
}

function isToolAdapter(value: unknown): value is ToolAdapter {
  return typeof value === 'function';
}

function selectAdapterExport(candidate: unknown): ToolAdapter | null {
  if (isToolAdapter(candidate)) {
    return candidate;
  }

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const moduleRecord = candidate as Record<string, unknown>;
  const defaultExport = moduleRecord.default;
  if (isToolAdapter(defaultExport)) {
    return defaultExport;
  }

  const runExport = moduleRecord.run;
  if (isToolAdapter(runExport)) {
    return runExport;
  }

  const handlerExport = moduleRecord.handler;
  if (isToolAdapter(handlerExport)) {
    return handlerExport;
  }

  return null;
}

async function readStreamAsString(stream: NodeJS.ReadableStream): Promise<string> {
  let output = '';
  for await (const chunk of stream) {
    output += typeof chunk === 'string' ? chunk : chunk.toString(UTF8_ENCODING);
  }
  return output;
}

export function parseToolRunnerWorkerResponse(raw: string): ToolRunnerWorkerResponse {
  const parsedPayload = JSON.parse(raw) as unknown;
  return ToolRunnerWorkerResponseSchema.parse(parsedPayload);
}

export async function executeToolRunnerInvocation(
  invocationInput: unknown,
  options: ToolRunnerWorkerExecutionOptions = {},
): Promise<ToolOutput> {
  const parsedInvocation = ToolRunnerWorkerInvocationSchema.safeParse(invocationInput);
  if (!parsedInvocation.success) {
    return buildFailureOutput('INVALID_INVOCATION_PAYLOAD', parsedInvocation.error.message);
  }

  const invocation = parsedInvocation.data;
  const importModule = options.importModule || defaultImportModule;

  let loadedModule: unknown;
  try {
    loadedModule = await importModule(resolveEntrySpecifier(invocation.handler_entry));
  } catch (error) {
    return withScopeNote(
      buildFailureOutput(
        'ADAPTER_LOAD_FAILED',
        `Failed to load adapter "${invocation.handler_entry}": ${(error as Error).message}`,
      ),
      invocation.scope_enforced,
    );
  }

  const adapter = selectAdapterExport(loadedModule);
  if (!adapter) {
    return withScopeNote(
      buildFailureOutput(
        'ADAPTER_LOAD_FAILED',
        `Adapter "${invocation.handler_entry}" does not export a function`,
      ),
      invocation.scope_enforced,
    );
  }

  let rawOutput: unknown;
  try {
    rawOutput = await adapter(invocation.input, {
      tool_name: invocation.tool_name,
      receipt_id: invocation.receipt_id,
      scope_enforced: invocation.scope_enforced,
    });
  } catch (error) {
    return withScopeNote(
      buildFailureOutput(
        'TOOL_EXECUTION_FAILED',
        `Adapter "${invocation.handler_entry}" failed: ${(error as Error).message}`,
      ),
      invocation.scope_enforced,
    );
  }

  const parsedOutput = ToolOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) {
    return withScopeNote(
      buildFailureOutput('INVALID_OUTPUT', parsedOutput.error.message),
      invocation.scope_enforced,
    );
  }

  return withScopeNote(parsedOutput.data, invocation.scope_enforced);
}

export async function runToolRunnerWorkerFromStreams(
  streams: ToolRunnerWorkerStreams,
  options: ToolRunnerWorkerExecutionOptions = {},
): Promise<void> {
  const rawPayload = await readStreamAsString(streams.stdin);
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload) as unknown;
  } catch {
    const invalidPayload = buildFailureOutput(
      'INVALID_INVOCATION_PAYLOAD',
      'Worker stdin payload is not valid JSON',
    );
    streams.stdout.write(JSON.stringify({ output: invalidPayload }));
    return;
  }

  const output = await executeToolRunnerInvocation(payload, options);
  streams.stdout.write(JSON.stringify({ output }));
}

export async function runToolRunnerWorkerProcess(): Promise<void> {
  await runToolRunnerWorkerFromStreams({
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

function shouldRunAsMain(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return pathToFileURL(path.resolve(entryPath)).href === import.meta.url;
}

if (shouldRunAsMain()) {
  void runToolRunnerWorkerProcess();
}
