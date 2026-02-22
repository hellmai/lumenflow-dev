#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Sandbox - Execute a command using the core sandbox engine.
 *
 * Usage:
 *   pnpm wu:sandbox --id WU-123 -- <command> [args...]
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import {
  createWUParser,
  WU_OPTIONS,
  resolveLocation,
  readWURaw,
  buildSandboxProfile,
  resolveSandboxBackendForPlatform,
  SANDBOX_BACKEND_IDS,
  createLinuxSandboxBackend,
  createMacosSandboxBackend,
  createWindowsSandboxBackend,
  type SandboxBackend,
  type SandboxExecutionPlan,
  type SandboxProfile,
  WORKSPACE_CONFIG_FILE_NAME,
  WORKSPACE_V2_KEYS,
} from '@lumenflow/core';
import { WU_PATHS, defaultWorktreeFrom } from '@lumenflow/core/wu-paths';
import { die } from '@lumenflow/core/error-handler';
import { LOG_PREFIX, EXIT_CODES } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const PREFIX = LOG_PREFIX.CLAIM.replace('wu-claim', 'wu:sandbox');
const DEFAULT_ALLOW_UNSANDBOXED_ENV_VAR = 'LUMENFLOW_SANDBOX_ALLOW_UNSANDBOXED';
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

interface SandboxPolicyConfig {
  allow_unsandboxed_fallback_env?: string;
  extra_writable_roots?: string[];
  deny_writable_roots?: string[];
}

export interface ResolvedSandboxPolicy {
  allowUnsandboxedEnvVar: string;
  extraWritableRoots: string[];
  denyWritableRoots: string[];
}

export interface WuSandboxOptions {
  id: string;
  worktree?: string;
  command: string[];
}

export interface WuSandboxExecutionInput extends WuSandboxOptions {
  cwd?: string;
}

interface BuildSandboxExecutionResult {
  profile: SandboxProfile;
  plan: SandboxExecutionPlan;
  worktreePath: string;
  policy: ResolvedSandboxPolicy;
  allowUnsandboxedFallback: boolean;
}

function toNormalizedAbsolute(targetPath: string): string {
  const normalized = path.resolve(targetPath);
  return normalized.length > 1 && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized;
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidateKey = process.platform === 'win32' ? candidatePath.toLowerCase() : candidatePath;
  const rootKey = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function parsePolicyConfig(value: unknown): SandboxPolicyConfig {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as SandboxPolicyConfig;
}

function readWorkspaceSoftwareDelivery(projectRoot: string): Record<string, unknown> | null {
  const configPath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = parseYaml(readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const workspace = parsed as Record<string, unknown>;
    const softwareDelivery = workspace[SOFTWARE_DELIVERY_KEY];
    if (!softwareDelivery || typeof softwareDelivery !== 'object' || Array.isArray(softwareDelivery)) {
      return null;
    }

    return softwareDelivery as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readSandboxPolicy(projectRoot: string): ResolvedSandboxPolicy {
  const softwareDelivery = readWorkspaceSoftwareDelivery(projectRoot);
  if (!softwareDelivery) {
    return {
      allowUnsandboxedEnvVar: DEFAULT_ALLOW_UNSANDBOXED_ENV_VAR,
      extraWritableRoots: [],
      denyWritableRoots: [],
    };
  }

  const sandbox = parsePolicyConfig(softwareDelivery.sandbox);
  const allowUnsandboxedEnvVar =
    typeof sandbox.allow_unsandboxed_fallback_env === 'string' &&
    sandbox.allow_unsandboxed_fallback_env.trim() !== ''
      ? sandbox.allow_unsandboxed_fallback_env.trim()
      : DEFAULT_ALLOW_UNSANDBOXED_ENV_VAR;

  const extraWritableRoots = Array.isArray(sandbox.extra_writable_roots)
    ? sandbox.extra_writable_roots.filter((value): value is string => typeof value === 'string')
    : [];
  const denyWritableRoots = Array.isArray(sandbox.deny_writable_roots)
    ? sandbox.deny_writable_roots.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    allowUnsandboxedEnvVar,
    extraWritableRoots,
    denyWritableRoots,
  };
}

export function extractSandboxCommandFromArgv(argv: string[]): string[] {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    return [];
  }
  return argv.slice(separator + 1);
}

function parseWuSandboxOptions(argv: string[] = process.argv): WuSandboxOptions {
  const opts = createWUParser({
    name: 'wu-sandbox',
    description: 'Execute a command through the sandbox backend for this platform',
    options: [WU_OPTIONS.id, WU_OPTIONS.worktree],
    required: ['id'],
    allowPositionalId: true,
  });

  const command = extractSandboxCommandFromArgv(argv);
  return {
    id: String(opts.id).toUpperCase(),
    worktree: opts.worktree as string | undefined,
    command,
  };
}

function resolveCandidateRoots(projectRoot: string, policy: ResolvedSandboxPolicy): string[] {
  const deniedRoots = policy.denyWritableRoots.map((entry) =>
    path.isAbsolute(entry)
      ? toNormalizedAbsolute(entry)
      : toNormalizedAbsolute(path.join(projectRoot, entry)),
  );
  const extras = policy.extraWritableRoots.map((entry) =>
    path.isAbsolute(entry)
      ? toNormalizedAbsolute(entry)
      : toNormalizedAbsolute(path.join(projectRoot, entry)),
  );

  return extras.filter((extra) => !deniedRoots.some((denied) => isWithinRoot(extra, denied)));
}

function resolveWorktreeFromWu(projectRoot: string, wuId: string): string | null {
  const wuPath = path.join(projectRoot, WU_PATHS.WU(wuId));
  if (!existsSync(wuPath)) {
    return null;
  }
  try {
    const doc = readWURaw(wuPath);
    const defaultWorktree = defaultWorktreeFrom(doc);
    return defaultWorktree ? path.resolve(projectRoot, defaultWorktree) : null;
  } catch {
    return null;
  }
}

async function resolveWorktreePath(
  projectRoot: string,
  wuId: string,
  explicitWorktree: string | undefined,
  cwd: string,
): Promise<string> {
  if (explicitWorktree) {
    return path.isAbsolute(explicitWorktree)
      ? path.resolve(explicitWorktree)
      : path.resolve(projectRoot, explicitWorktree);
  }

  const location = await resolveLocation(cwd);
  if (location.type === 'worktree') {
    return path.resolve(location.gitRoot);
  }

  const fromWu = resolveWorktreeFromWu(projectRoot, wuId);
  if (fromWu) {
    return fromWu;
  }

  die(
    `Unable to determine worktree path for ${wuId}.\n` +
      `Run from the claimed worktree or provide --worktree <path>.`,
  );
}

function createBackendForCurrentPlatform(): SandboxBackend | null {
  const resolution = resolveSandboxBackendForPlatform();
  if (!resolution.supported) {
    return null;
  }
  if (resolution.id === SANDBOX_BACKEND_IDS.LINUX) {
    return createLinuxSandboxBackend();
  }
  if (resolution.id === SANDBOX_BACKEND_IDS.MACOS) {
    return createMacosSandboxBackend();
  }
  if (resolution.id === SANDBOX_BACKEND_IDS.WINDOWS) {
    return createWindowsSandboxBackend();
  }
  return null;
}

export function resolveAllowUnsandboxedFallback(
  env: NodeJS.ProcessEnv,
  envVarName: string,
): boolean {
  return env[envVarName] === '1';
}

async function buildSandboxExecution(
  input: WuSandboxExecutionInput,
): Promise<BuildSandboxExecutionResult> {
  const cwd = input.cwd || process.cwd();
  const location = await resolveLocation(cwd);
  const projectRoot = path.resolve(location.mainCheckout || cwd);
  const policy = readSandboxPolicy(projectRoot);
  const extraWritableRoots = resolveCandidateRoots(projectRoot, policy);
  const worktreePath = await resolveWorktreePath(projectRoot, input.id, input.worktree, cwd);
  const allowUnsandboxedFallback = resolveAllowUnsandboxedFallback(
    process.env,
    policy.allowUnsandboxedEnvVar,
  );

  const profile = buildSandboxProfile({
    projectRoot,
    worktreePath,
    wuId: input.id,
    extraWritableRoots,
  });

  const backend = createBackendForCurrentPlatform();
  if (!backend) {
    const unsupportedPlan: SandboxExecutionPlan = allowUnsandboxedFallback
      ? {
          backendId: SANDBOX_BACKEND_IDS.UNSUPPORTED,
          enforced: false,
          failClosed: false,
          warning:
            'Running unsandboxed because this platform does not have a hardened sandbox backend.',
        }
      : {
          backendId: SANDBOX_BACKEND_IDS.UNSUPPORTED,
          enforced: false,
          failClosed: true,
          reason:
            'No hardened sandbox backend is available for this platform. ' +
            `Set ${policy.allowUnsandboxedEnvVar}=1 to allow explicit unsandboxed fallback.`,
        };

    return {
      profile,
      plan: unsupportedPlan,
      worktreePath,
      policy,
      allowUnsandboxedFallback,
    };
  }

  const plan = backend.resolveExecution({
    profile,
    command: input.command,
    allowUnsandboxedFallback,
  });
  return {
    profile,
    plan,
    worktreePath,
    policy,
    allowUnsandboxedFallback,
  };
}

async function runCommand(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(EXIT_CODES.ERROR);
      } else {
        resolve(code ?? EXIT_CODES.ERROR);
      }
    });
  });
}

export async function runWuSandbox(input: WuSandboxExecutionInput): Promise<number> {
  if (!input.command || input.command.length === 0) {
    die('No command provided. Usage: pnpm wu:sandbox --id WU-XXXX -- <command> [args...]');
  }

  const { plan, worktreePath, policy } = await buildSandboxExecution(input);

  if (plan.failClosed) {
    die(
      `${plan.reason || 'Sandbox backend failed closed.'}\n` +
        `To allow explicit unsandboxed fallback for this command, set ${policy.allowUnsandboxedEnvVar}=1.`,
    );
  }

  if (plan.warning) {
    console.warn(`${PREFIX} Warning: ${plan.warning}`);
  }

  const commandToRun =
    plan.enforced && plan.invocation ? plan.invocation.command : input.command[0];
  const commandArgs =
    plan.enforced && plan.invocation ? plan.invocation.args : input.command.slice(1);

  if (plan.enforced) {
    console.log(`${PREFIX} Running command with ${plan.backendId} sandbox backend.`);
  } else {
    console.log(`${PREFIX} Running command unsandboxed (explicit fallback).`);
  }

  return runCommand(commandToRun, commandArgs, worktreePath);
}

async function main(): Promise<void> {
  const options = parseWuSandboxOptions(process.argv);
  const exitCode = await runWuSandbox(options);
  process.exit(exitCode);
}

if (import.meta.main) {
  void runCLI(main);
}
