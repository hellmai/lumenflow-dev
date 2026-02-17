// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import micromatch from 'micromatch';
import { z } from 'zod';
import type { ToolCapability, ToolOutput, ToolScope } from '../../kernel.schemas.js';
import { BASE64_ENCODING, UTF8_ENCODING } from '../../shared-constants.js';
import type { PolicyHook, PolicyHookInput } from '../tool-host.js';
import { ToolRegistry } from '../tool-registry.js';

const BUILTIN_POLICY_IDS = {
  DEFAULT_ALLOW: 'kernel.policy.builtin-default',
  PROC_EXEC_DEFAULT_DENY: 'kernel.policy.proc-exec-default-deny',
} as const;

const BUILTIN_TOOL_NAMES = {
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  PROC_EXEC: 'proc:exec',
} as const;

const BUILTIN_SUBPROCESS_ENTRIES = {
  FS_WRITE: 'kernel/tool-impl/fs-write.js',
  PROC_EXEC: 'kernel/tool-impl/proc-exec.js',
} as const;
const BUILTIN_PACK_ID = 'kernel-builtins';
const BUILTIN_TOOL_VERSION = '1.0.0';

const TEXT_ENCODINGS = [UTF8_ENCODING, BASE64_ENCODING] as const;

const FsReadInputSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(TEXT_ENCODINGS).optional(),
});

const FsReadOutputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  bytes: z.number().int().nonnegative(),
});

const FsWriteInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(TEXT_ENCODINGS).optional(),
});

const FsWriteOutputSchema = z.object({
  queued: z.boolean(),
  target: z.string().min(1),
});

const ProcExecInputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const ProcExecOutputSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export interface BuiltinSubprocessEntries {
  fsWrite?: string;
  procExec?: string;
}

export interface BuiltinToolOptions {
  declaredScopes: ToolScope[];
  includeInternalTools?: boolean;
  subprocessEntries?: BuiltinSubprocessEntries;
}

export interface BuiltinPolicyOptions {
  allowInternalProcExec?: boolean;
}

function buildScopeKey(scope: ToolScope): string {
  if (scope.type === 'path') {
    return `${scope.type}:${scope.access}:${scope.pattern}`;
  }
  return `${scope.type}:${scope.posture}`;
}

function dedupeScopes(scopes: ToolScope[]): ToolScope[] {
  const seen = new Set<string>();
  const deduped: ToolScope[] = [];
  for (const scope of scopes) {
    const key = buildScopeKey(scope);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(scope);
  }
  return deduped;
}

function buildFailureOutput(code: string, message: string): ToolOutput {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}

async function runFsRead(input: unknown, scopes: ToolScope[]): Promise<ToolOutput> {
  const parsedInput = FsReadInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return buildFailureOutput('INVALID_INPUT', parsedInput.error.message);
  }

  const resolvedPath = resolve(parsedInput.data.path);
  const canReadPath = scopesAllowReadPath(scopes, resolvedPath);
  if (!canReadPath) {
    return buildFailureOutput(
      'SCOPE_VIOLATION',
      `Path ${resolvedPath} is outside the enforced read scopes for fs:read.`,
    );
  }

  const encoding = parsedInput.data.encoding || UTF8_ENCODING;
  try {
    const content = await readFile(resolvedPath, { encoding });
    return {
      success: true,
      data: {
        path: resolvedPath,
        content,
        bytes: Buffer.byteLength(content),
      },
    };
  } catch (error) {
    return buildFailureOutput('FS_READ_FAILED', (error as Error).message);
  }
}

function scopesAllowReadPath(scopes: ToolScope[], filePath: string): boolean {
  const readScopes = scopes.filter(
    (scope): scope is Extract<ToolScope, { type: 'path' }> =>
      scope.type === 'path' && scope.access === 'read',
  );

  if (readScopes.length === 0) {
    return false;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  return readScopes.some((scope) =>
    micromatch.isMatch(normalizedPath, resolve(scope.pattern).replace(/\\/g, '/')),
  );
}

function createFsReadCapability(scopes: ToolScope[]): ToolCapability {
  return {
    name: BUILTIN_TOOL_NAMES.FS_READ,
    domain: 'filesystem',
    version: BUILTIN_TOOL_VERSION,
    input_schema: FsReadInputSchema,
    output_schema: FsReadOutputSchema,
    permission: 'read',
    required_scopes: scopes,
    handler: {
      kind: 'in-process',
      fn: (input) => runFsRead(input, scopes),
    },
    description: 'Read file content from an allowed scope',
    pack: BUILTIN_PACK_ID,
  };
}

function createFsWriteCapability(scopes: ToolScope[], entry: string): ToolCapability {
  return {
    name: BUILTIN_TOOL_NAMES.FS_WRITE,
    domain: 'filesystem',
    version: BUILTIN_TOOL_VERSION,
    input_schema: FsWriteInputSchema,
    output_schema: FsWriteOutputSchema,
    permission: 'write',
    required_scopes: scopes,
    handler: {
      kind: 'subprocess',
      entry,
    },
    description: 'Write file content through sandboxed subprocess execution',
    pack: BUILTIN_PACK_ID,
  };
}

function createProcExecCapability(scopes: ToolScope[], entry: string): ToolCapability {
  return {
    name: BUILTIN_TOOL_NAMES.PROC_EXEC,
    domain: 'process',
    version: BUILTIN_TOOL_VERSION,
    input_schema: ProcExecInputSchema,
    output_schema: ProcExecOutputSchema,
    permission: 'admin',
    required_scopes: scopes,
    handler: {
      kind: 'subprocess',
      entry,
    },
    description: 'Execute internal subprocess actions for pack tool implementations',
    pack: BUILTIN_PACK_ID,
  };
}

export function createBuiltinToolCapabilities(options: BuiltinToolOptions): ToolCapability[] {
  const dedupedScopes = dedupeScopes(options.declaredScopes);
  const subprocessEntries = {
    fsWrite: options.subprocessEntries?.fsWrite || BUILTIN_SUBPROCESS_ENTRIES.FS_WRITE,
    procExec: options.subprocessEntries?.procExec || BUILTIN_SUBPROCESS_ENTRIES.PROC_EXEC,
  };

  const capabilities: ToolCapability[] = [
    createFsReadCapability(dedupedScopes),
    createFsWriteCapability(dedupedScopes, subprocessEntries.fsWrite),
  ];

  if (options.includeInternalTools) {
    capabilities.push(createProcExecCapability(dedupedScopes, subprocessEntries.procExec));
  }

  return capabilities;
}

export function listAgentVisibleBuiltinTools(capabilities: ToolCapability[]): ToolCapability[] {
  return capabilities.filter((capability) => capability.name !== BUILTIN_TOOL_NAMES.PROC_EXEC);
}

export function registerBuiltinToolCapabilities(
  registry: ToolRegistry,
  options: BuiltinToolOptions,
): ToolCapability[] {
  const capabilities = createBuiltinToolCapabilities(options);
  for (const capability of capabilities) {
    registry.register(capability);
  }
  return capabilities;
}

export function createBuiltinPolicyHook(options: BuiltinPolicyOptions = {}): PolicyHook {
  const allowInternalProcExec = options.allowInternalProcExec || false;
  return async (input: PolicyHookInput) => {
    if (input.capability.name === BUILTIN_TOOL_NAMES.PROC_EXEC && !allowInternalProcExec) {
      return [
        {
          policy_id: BUILTIN_POLICY_IDS.PROC_EXEC_DEFAULT_DENY,
          decision: 'deny',
          reason: 'proc:exec is internal-only and default-denied by workspace policy.',
        },
      ];
    }

    return [
      {
        policy_id: BUILTIN_POLICY_IDS.DEFAULT_ALLOW,
        decision: 'allow',
        reason: 'Builtin tool allowed by default policy.',
      },
    ];
  };
}
