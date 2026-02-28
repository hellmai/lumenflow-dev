// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { UTF8_ENCODING } from '../constants.js';

export const RUNTIME_CLI_COMMANDS = {
  AGENT_ISSUES_QUERY: 'agent-issues-query',
  AGENT_LOG_ISSUE: 'agent-log-issue',
  AGENT_SESSION: 'agent-session',
  AGENT_SESSION_END: 'agent-session-end',
  BACKLOG_PRUNE: 'backlog-prune',
  CONFIG_GET: 'config-get',
  CONFIG_SET: 'config-set',
  DELEGATION_LIST: 'delegation-list',
  DOCS_SYNC: 'docs-sync',
  FILE_DELETE: 'file-delete',
  FILE_EDIT: 'file-edit',
  FILE_READ: 'file-read',
  FILE_WRITE: 'file-write',
  FLOW_BOTTLENECKS: 'flow-bottlenecks',
  FLOW_REPORT: 'flow-report',
  GATES: 'gates',
  GIT_BRANCH: 'git-branch',
  GIT_DIFF: 'git-diff',
  GIT_LOG: 'git-log',
  INIT: 'init',
  INITIATIVE_ADD_WU: 'initiative-add-wu',
  INITIATIVE_BULK_ASSIGN: 'initiative-bulk-assign-wus',
  INITIATIVE_CREATE: 'initiative-create',
  INITIATIVE_EDIT: 'initiative-edit',
  INITIATIVE_LIST: 'initiative-list',
  INITIATIVE_PLAN: 'initiative-plan',
  INITIATIVE_REMOVE_WU: 'initiative-remove-wu',
  INITIATIVE_STATUS: 'initiative-status',
  INTEGRATE: 'commands/integrate',
  LANE_HEALTH: 'lane-health',
  LANE_SUGGEST: 'lane-suggest',
  LUMENFLOW_DOCTOR: 'doctor',
  LUMENFLOW_UPGRADE: 'lumenflow-upgrade',
  MEM_CHECKPOINT: 'mem-checkpoint',
  MEM_CLEANUP: 'mem-cleanup',
  MEM_CONTEXT: 'mem-context',
  MEM_CREATE: 'mem-create',
  MEM_DELETE: 'mem-delete',
  MEM_EXPORT: 'mem-export',
  MEM_INBOX: 'mem-inbox',
  MEM_INIT: 'mem-init',
  MEM_READY: 'mem-ready',
  MEM_RECOVER: 'mem-recover',
  MEM_SIGNAL: 'mem-signal',
  MEM_START: 'mem-start',
  MEM_SUMMARIZE: 'mem-summarize',
  MEM_TRIAGE: 'mem-triage',
  METRICS: 'metrics-cli',
  METRICS_SNAPSHOT: 'metrics-snapshot',
  ORCHESTRATE_INIT_STATUS: 'orchestrate-init-status',
  ORCHESTRATE_INITIATIVE: 'orchestrate-initiative',
  ORCHESTRATE_MONITOR: 'orchestrate-monitor',
  PLAN_CREATE: 'plan-create',
  PLAN_EDIT: 'plan-edit',
  PLAN_LINK: 'plan-link',
  PLAN_PROMOTE: 'plan-promote',
  RELEASE: 'release',
  SIGNAL_CLEANUP: 'signal-cleanup',
  STATE_BOOTSTRAP: 'state-bootstrap',
  STATE_CLEANUP: 'state-cleanup',
  STATE_DOCTOR: 'state-doctor',
  SYNC_TEMPLATES: 'sync-templates',
  VALIDATE: 'validate',
  VALIDATE_AGENT_SKILLS: 'validate-agent-skills',
  VALIDATE_AGENT_SYNC: 'validate-agent-sync',
  VALIDATE_BACKLOG_SYNC: 'validate-backlog-sync',
  VALIDATE_SKILLS_SPEC: 'validate-skills-spec',
  WU_BLOCK: 'wu-block',
  WU_BRIEF: 'wu-brief',
  WU_CLAIM: 'wu-claim',
  WU_CLEANUP: 'wu-cleanup',
  WU_CREATE: 'wu-create',
  WU_DELEGATE: 'wu-delegate',
  WU_DELETE: 'wu-delete',
  WU_DEPS: 'wu-deps',
  WU_DONE: 'wu-done',
  WU_EDIT: 'wu-edit',
  WU_INFER_LANE: 'wu-infer-lane',
  WU_PREFLIGHT: 'wu-preflight',
  WU_PREP: 'wu-prep',
  WU_PROTO: 'wu-proto',
  WU_PRUNE: 'wu-prune',
  WU_RECOVER: 'wu-recover',
  WU_RELEASE: 'wu-release',
  WU_REPAIR: 'wu-repair',
  WU_SANDBOX: 'wu-sandbox',
  WU_STATUS: 'wu-status',
  WU_UNBLOCK: 'wu-unblock',
  WU_UNLOCK_LANE: 'wu-unlock-lane',
  WU_VALIDATE: 'wu-validate',
  WORKSPACE_INIT: 'workspace-init',
} as const;

export type RuntimeCliCommand = (typeof RUNTIME_CLI_COMMANDS)[keyof typeof RUNTIME_CLI_COMMANDS];

export interface RuntimeCliModule {
  main: () => Promise<void>;
}

type RuntimeCliModuleLoader = (command: RuntimeCliCommand) => Promise<RuntimeCliModule>;

type WriteCallback = ((error?: Error | null) => void) | undefined;
type WriteEncodingOrCallback = BufferEncoding | WriteCallback;
type WriteFn = (
  chunk: string | Uint8Array,
  encodingOrCallback?: WriteEncodingOrCallback,
  callback?: (error?: Error | null) => void,
) => boolean;

const EXIT_STATUS_DEFAULT_OK = 0;
const EXIT_STATUS_DEFAULT_ERROR = 1;
const OUTPUT_LINE_SUFFIX = '\n';
const CLI_SOURCE_ROOT = 'packages/@lumenflow/cli/src';
const CLI_MODULE_FILE_EXTENSION = '.js';

type ConsoleCaptureMethodName = 'debug' | 'error' | 'info' | 'log' | 'warn';
type ConsoleCaptureMethod = (...args: unknown[]) => void;
const STDOUT_CONSOLE_METHODS: readonly ConsoleCaptureMethodName[] = ['debug', 'info', 'log'];
const STDERR_CONSOLE_METHODS: readonly ConsoleCaptureMethodName[] = ['error', 'warn'];

function resolveCliModuleRelativePath(command: RuntimeCliCommand): string {
  return `${command}${CLI_MODULE_FILE_EXTENSION}`;
}

function resolveCliModuleUrl(command: RuntimeCliCommand): string {
  const absolutePath = resolvePath(
    process.cwd(),
    CLI_SOURCE_ROOT,
    resolveCliModuleRelativePath(command),
  );
  return pathToFileURL(absolutePath).href;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeExitCode(code: number | string | undefined): number {
  if (typeof code === 'number' && Number.isFinite(code)) {
    return Math.trunc(code);
  }
  if (typeof code === 'string') {
    const parsed = Number.parseInt(code, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return EXIT_STATUS_DEFAULT_OK;
}

function appendCapturedChunk(
  target: string[],
  chunk: string | Uint8Array,
  encoding: BufferEncoding,
): void {
  if (typeof chunk === 'string') {
    target.push(chunk);
    return;
  }
  target.push(Buffer.from(chunk).toString(encoding));
}

class RuntimeCliExitSignal extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`CLI requested process exit (${exitCode})`);
    this.exitCode = exitCode;
  }
}

function patchStreamWrite(stream: NodeJS.WriteStream, target: string[]): () => void {
  const original = stream.write as unknown as WriteFn;
  const patched: WriteFn = (chunk, encodingOrCallback, callback) => {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : UTF8_ENCODING;
    const resolvedCallback: WriteCallback =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;

    appendCapturedChunk(target, chunk, encoding);

    if (resolvedCallback) {
      resolvedCallback(null);
    }
    return true;
  };

  stream.write = patched as unknown as typeof stream.write;
  return () => {
    stream.write = original as unknown as typeof stream.write;
  };
}

function patchConsoleMethod(methodName: ConsoleCaptureMethodName, target: string[]): () => void {
  const globalConsole = console as unknown as Record<
    ConsoleCaptureMethodName,
    ConsoleCaptureMethod
  >;
  const original = globalConsole[methodName];
  const patched: ConsoleCaptureMethod = (...args) => {
    target.push(`${format(...args)}${OUTPUT_LINE_SUFFIX}`);
  };
  globalConsole[methodName] = patched;
  return () => {
    globalConsole[methodName] = original;
  };
}

function patchConsoleOutput(stdoutChunks: string[], stderrChunks: string[]): () => void {
  const restoreMethods: Array<() => void> = [];
  for (const methodName of STDOUT_CONSOLE_METHODS) {
    restoreMethods.push(patchConsoleMethod(methodName, stdoutChunks));
  }
  for (const methodName of STDERR_CONSOLE_METHODS) {
    restoreMethods.push(patchConsoleMethod(methodName, stderrChunks));
  }

  return () => {
    for (let index = restoreMethods.length - 1; index >= 0; index -= 1) {
      restoreMethods[index]?.();
    }
  };
}

async function defaultLoadRuntimeCliModule(command: RuntimeCliCommand): Promise<RuntimeCliModule> {
  const moduleUrl = resolveCliModuleUrl(command);
  const loaded = (await import(moduleUrl)) as RuntimeCliModule;
  if (!loaded || typeof loaded.main !== 'function') {
    throw new Error(`Runtime CLI command "${command}" does not export main()`);
  }
  return loaded;
}

export interface RuntimeCliExecutionResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  executionError?: string;
}

export interface RuntimeCliAdapter {
  run(command: RuntimeCliCommand, args: string[]): Promise<RuntimeCliExecutionResult>;
}

export interface RuntimeCliAdapterOptions {
  loadModule?: RuntimeCliModuleLoader;
}

let executionQueue: Promise<void> = Promise.resolve();

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const scheduled = executionQueue.then(operation, operation);
  executionQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

export function createRuntimeCliAdapter(options: RuntimeCliAdapterOptions = {}): RuntimeCliAdapter {
  const loadModule = options.loadModule ?? defaultLoadRuntimeCliModule;

  return {
    async run(command: RuntimeCliCommand, args: string[]): Promise<RuntimeCliExecutionResult> {
      return runExclusive(async () => {
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        const originalArgv = [...process.argv];
        const originalExit = process.exit;
        const restoreStdout = patchStreamWrite(process.stdout, stdoutChunks);
        const restoreStderr = patchStreamWrite(process.stderr, stderrChunks);
        const restoreConsole = patchConsoleOutput(stdoutChunks, stderrChunks);

        process.argv = [process.execPath, command, ...args];
        process.exit = ((code?: number | string | null | undefined) => {
          throw new RuntimeCliExitSignal(normalizeExitCode(code ?? undefined));
        }) as typeof process.exit;

        let status = EXIT_STATUS_DEFAULT_OK;
        let executionError: string | undefined;

        try {
          const module = await loadModule(command);
          await module.main();
        } catch (error) {
          if (error instanceof RuntimeCliExitSignal) {
            status = error.exitCode;
          } else {
            status = EXIT_STATUS_DEFAULT_ERROR;
            executionError = toErrorMessage(error);
            stderrChunks.push(`${executionError}\n`);
          }
        } finally {
          process.argv = originalArgv;
          process.exit = originalExit;
          restoreConsole();
          restoreStdout();
          restoreStderr();
        }

        const stdout = stdoutChunks.join('');
        const stderr = stderrChunks.join('');

        return {
          ok: status === EXIT_STATUS_DEFAULT_OK && executionError === undefined,
          status,
          stdout,
          stderr,
          executionError,
        };
      });
    },
  };
}

export const runtimeCliAdapter = createRuntimeCliAdapter();
