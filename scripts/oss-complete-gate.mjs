#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_WORKSPACE_PATH = 'workspace.yaml';
const DEFAULT_SDK_DIR = path.join('packages', '@lumenflow', 'control-plane-sdk');
const TARBALL_PREFIX = 'lumenflow-oss-complete-pack-';
const COMMENT_PREFIX = '#';

/**
 * Runtime dependencies that would pull AGPL code into the Apache SDK artifact.
 * WU-2150 removed @lumenflow/kernel runtime dependency; this gate preserves that boundary.
 */
export const AGPL_RUNTIME_DEPENDENCIES = new Set([
  '@lumenflow/agent',
  '@lumenflow/cli',
  '@lumenflow/core',
  '@lumenflow/initiatives',
  '@lumenflow/kernel',
  '@lumenflow/mcp',
  '@lumenflow/memory',
  '@lumenflow/metrics',
  '@lumenflow/runtime',
  '@lumenflow/shims',
]);

/**
 * Detect whether workspace YAML declares a top-level control_plane key.
 * Local-only test configuration must not include this cloud-connected block.
 */
export function containsTopLevelControlPlaneConfig(yamlContent) {
  const lines = String(yamlContent).split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(COMMENT_PREFIX)) {
      continue;
    }

    const hasTopLevelIndentation = /^\S/.test(rawLine);
    if (!hasTopLevelIndentation) {
      continue;
    }

    if (/^control_plane\s*:/.test(trimmed)) {
      return true;
    }
  }

  return false;
}

export function validateLocalOnlyWorkspaceYaml(yamlContent) {
  if (containsTopLevelControlPlaneConfig(yamlContent)) {
    throw new Error('Local-only workspace must not define control_plane configuration.');
  }
}

function collectRuntimeDependencyNames(packageJson) {
  const dependencies = packageJson?.dependencies ?? {};
  const optionalDependencies = packageJson?.optionalDependencies ?? {};
  return Object.keys({ ...dependencies, ...optionalDependencies });
}

export function findForbiddenAgplRuntimeDependencies(packageJson) {
  const runtimeDependencies = collectRuntimeDependencyNames(packageJson);

  return runtimeDependencies
    .filter((dependencyName) => AGPL_RUNTIME_DEPENDENCIES.has(dependencyName))
    .sort();
}

export function assertOssCompleteConstraints({ workspaceYamlContent, packedPackageJson }) {
  const failures = [];

  try {
    validateLocalOnlyWorkspaceYaml(workspaceYamlContent);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const forbiddenDependencies = findForbiddenAgplRuntimeDependencies(packedPackageJson);
  if (forbiddenDependencies.length > 0) {
    failures.push(
      `Packed SDK artifact contains forbidden AGPL runtime dependencies: ${forbiddenDependencies.join(', ')}`,
    );
  }

  if (failures.length > 0) {
    const details = failures.map((failure) => `  - ${failure}`).join('\n');
    throw new Error(`OSS-complete gate failed:\n${details}`);
  }
}

function resolveAbsolutePath(basePath, inputPath) {
  if (!inputPath) {
    return basePath;
  }

  return path.isAbsolute(inputPath) ? inputPath : path.resolve(basePath, inputPath);
}

function readPackedSdkPackageJson(sdkDirectory) {
  const packDir = mkdtempSync(path.join(tmpdir(), TARBALL_PREFIX));

  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- workflow contract expects pnpm on PATH
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: sdkDirectory,
      stdio: 'pipe',
    });

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp directory is generated in-process
    const tarballName = readdirSync(packDir).find((entry) => entry.endsWith('.tgz'));
    if (!tarballName) {
      throw new Error(`No tarball created in ${packDir}`);
    }

    const tarballPath = path.join(packDir, tarballName);
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- workflow contract expects tar on PATH
    const packedJson = execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    return JSON.parse(packedJson);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

export function runOssCompleteGate({
  repoRoot = DEFAULT_REPO_ROOT,
  workspacePath = DEFAULT_WORKSPACE_PATH,
  sdkDir = DEFAULT_SDK_DIR,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedWorkspacePath = resolveAbsolutePath(resolvedRepoRoot, workspacePath);
  const resolvedSdkDir = resolveAbsolutePath(resolvedRepoRoot, sdkDir);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is controlled by CI/workflow invocation
  const workspaceYamlContent = readFileSync(resolvedWorkspacePath, 'utf8');
  const packedPackageJson = readPackedSdkPackageJson(resolvedSdkDir);

  assertOssCompleteConstraints({
    workspaceYamlContent,
    packedPackageJson,
  });

  return {
    workspacePath: resolvedWorkspacePath,
    sdkDir: resolvedSdkDir,
  };
}

function parseCliArgs(argv) {
  let repoRoot;
  let workspacePath;
  let sdkDir;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo-root') {
      repoRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--workspace') {
      workspacePath = argv[i + 1];
      i += 1;
    } else if (arg === '--sdk-dir') {
      sdkDir = argv[i + 1];
      i += 1;
    }
  }

  return { repoRoot, workspacePath, sdkDir };
}

function main() {
  const options = parseCliArgs(globalThis.process.argv.slice(2));

  try {
    const result = runOssCompleteGate(options);
    globalThis.console.log('[oss-complete-gate] PASS');
    globalThis.console.log(`[oss-complete-gate] workspace: ${result.workspacePath}`);
    globalThis.console.log(`[oss-complete-gate] sdk: ${result.sdkDir}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    globalThis.console.error(`[oss-complete-gate] FAIL\n${message}`);
    globalThis.process.exitCode = 1;
  }
}

const isDirectExecution =
  globalThis.process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(globalThis.process.argv[1]);

if (isDirectExecution) {
  main();
}
