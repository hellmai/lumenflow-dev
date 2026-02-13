/**
 * Gates Utility Helpers
 *
 * WU-1647: Extracted utility functions used across gate runners,
 * plan resolvers, and the gates orchestrator.
 *
 * @module gates-utils
 */

import { execSync, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { buildGatesLogPath } from '@lumenflow/core/gates-agent-mode';
import { createGitForPath } from '@lumenflow/core/git-adapter';
import { getCurrentWU } from '@lumenflow/core/telemetry';
import { createWuPaths } from '@lumenflow/core/wu-paths';
import { readWURaw } from '@lumenflow/core/wu-yaml';
import {
  PKG_MANAGER,
  SCRIPTS,
  FILE_SYSTEM,
  EXIT_CODES,
  PRETTIER_ARGS,
  PRETTIER_FLAGS,
} from '@lumenflow/core/wu-constants';

// ── Types ──────────────────────────────────────────────────────────────

export type GateLogContext = {
  agentLog?: { logFd: number; logPath: string } | null;
  useAgentMode: boolean;
  cwd?: string;
};

// ── Shell command builders ─────────────────────────────────────────────

/**
 * Build a pnpm command string
 */
export function pnpmCmd(...parts: string[]) {
  return `${PKG_MANAGER} ${parts.join(' ')}`;
}

/**
 * Build a pnpm run command string
 */
export function pnpmRun(script: string, ...args: string[]) {
  const argsStr = args.length > 0 ? ` ${args.join(' ')}` : '';
  return `${PKG_MANAGER} ${SCRIPTS.RUN} ${script}${argsStr}`;
}

// ── Path/string helpers ────────────────────────────────────────────────

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function getBasename(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

export function quoteShellArgs(files: string[]): string {
  return files.map((file) => `"${file}"`).join(' ');
}

// ── Prettier helpers ───────────────────────────────────────────────────

export function parsePrettierListOutput(output: string): string[] {
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\[error\]\s*/i, '').trim())
    .filter(
      (line) =>
        !line.toLowerCase().includes('code style issues found') &&
        !line.toLowerCase().includes('all matched files use prettier') &&
        !line.toLowerCase().includes('checking formatting'),
    );
}

export function buildPrettierWriteCommand(files: string[]): string {
  const quotedFiles = files.map((file) => `"${file}"`).join(' ');
  const base = pnpmCmd(SCRIPTS.PRETTIER, PRETTIER_FLAGS.WRITE);
  return quotedFiles ? `${base} ${quotedFiles}` : base;
}

export function buildPrettierCheckCommand(files: string[]): string {
  const filesArg = files.length > 0 ? quoteShellArgs(files) : '.';
  return pnpmCmd(SCRIPTS.PRETTIER, PRETTIER_ARGS.CHECK, filesArg);
}

export function formatFormatCheckGuidance(files: string[]): string[] {
  if (!files.length) return [];
  const command = buildPrettierWriteCommand(files);
  return [
    '',
    '\u274C format:check failed',
    'Fix with:',
    `  ${command}`,
    '',
    'Affected files:',
    ...files.map((file) => `  - ${file}`),
    '',
  ];
}

export function collectPrettierListDifferent(cwd: string, files: string[] = []): string[] {
  const filesArg = files.length > 0 ? quoteShellArgs(files) : '.';
  const cmd = pnpmCmd(SCRIPTS.PRETTIER, PRETTIER_ARGS.LIST_DIFFERENT, filesArg);

  const result = spawnSync(cmd, [], {
    shell: true,
    cwd,
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return parsePrettierListOutput(output);
}

export function emitFormatCheckGuidance({
  agentLog,
  useAgentMode,
  files,
  cwd,
}: {
  agentLog?: { logFd: number; logPath: string } | null;
  useAgentMode: boolean;
  files?: string[] | null;
  cwd: string;
}) {
  const formattedFiles = collectPrettierListDifferent(cwd, files ?? []);
  if (!formattedFiles.length) return;

  const lines = formatFormatCheckGuidance(formattedFiles);
  const logLine =
    useAgentMode && agentLog
      ? (line: string) => writeSync(agentLog.logFd, `${line}\n`)
      : (line: string) => console.log(line);

  for (const line of lines) {
    logLine(line);
  }
}

// ── Process execution ──────────────────────────────────────────────────

export function run(
  cmd: string,
  {
    agentLog,
    cwd = process.cwd(),
  }: { agentLog?: { logFd: number; logPath: string } | null; cwd?: string } = {},
) {
  const start = Date.now();

  if (!agentLog) {
    console.log(`\n> ${cmd}\n`);
    try {
      // Pre-existing: execSync is intentional here for synchronous gate execution
      execSync(cmd, {
        stdio: 'inherit',
        encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
        cwd,
      });
      return { ok: true, duration: Date.now() - start };
    } catch {
      return { ok: false, duration: Date.now() - start };
    }
  }

  writeSync(agentLog.logFd, `\n> ${cmd}\n\n`);

  const result = spawnSync(cmd, [], {
    shell: true,
    stdio: ['ignore', agentLog.logFd, agentLog.logFd],
    cwd,
    encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
  });

  return { ok: result.status === EXIT_CODES.SUCCESS, duration: Date.now() - start };
}

// ── Logging ────────────────────────────────────────────────────────────

export function makeGateLogger({ agentLog, useAgentMode }: GateLogContext) {
  return (line: string) => {
    if (!useAgentMode) {
      console.log(line);
      return;
    }
    if (agentLog) {
      writeSync(agentLog.logFd, `${line}\n`);
    }
  };
}

export function readLogTail(logPath: string, { maxLines = 40, maxBytes = 64 * 1024 } = {}) {
  try {
    const stats = statSync(logPath);
    const startPos = Math.max(0, stats.size - maxBytes);
    const bytesToRead = stats.size - startPos;
    const fd = openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      readSync(fd, buffer, 0, bytesToRead, startPos);
      const text = buffer.toString(FILE_SYSTEM.ENCODING as BufferEncoding);
      const lines = text.split(/\r?\n/).filter(Boolean);
      return lines.slice(-maxLines).join('\n');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

export function createAgentLogContext({
  wuId,
  lane,
  cwd,
}: {
  wuId: string | null;
  lane: string | null;
  cwd: string;
}) {
  const logPath = buildGatesLogPath({ cwd, env: process.env, wuId, lane });
  mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');

  const header = `# gates log\n# lane: ${lane || 'unknown'}\n# wu: ${wuId || 'unknown'}\n# started: ${new Date().toISOString()}\n\n`;
  writeSync(logFd, header);

  // Ensure we close the FD even if gates exit via die().
  process.on('exit', () => {
    try {
      closeSync(logFd);
    } catch {
      // ignore
    }
  });

  return { logPath, logFd };
}

// ── File system helpers ────────────────────────────────────────────────

export async function filterExistingFiles(files: string[]): Promise<string[]> {
  const existingFiles = await Promise.all(
    files.map(async (file) => {
      try {
        await access(file);
        return file;
      } catch {
        return null;
      }
    }),
  );

  return existingFiles.filter((file): file is string => Boolean(file));
}

// ── Git helpers ────────────────────────────────────────────────────────

export async function getChangedFilesForIncremental({
  git,
  baseBranch = 'origin/main',
}: {
  git: ReturnType<typeof createGitForPath>;
  baseBranch?: string;
}) {
  const mergeBase = await git.mergeBase('HEAD', baseBranch);
  const committedOutput = await git.raw(['diff', '--name-only', `${mergeBase}...HEAD`]);
  const committedFiles = committedOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const unstagedOutput = await git.raw(['diff', '--name-only']);
  const unstagedFiles = unstagedOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const untrackedOutput = await git.raw(['ls-files', '--others', '--exclude-standard']);
  const untrackedFiles = untrackedOutput
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  return [...new Set([...committedFiles, ...unstagedFiles, ...untrackedFiles])];
}

/**
 * WU-2062: Get all changed files for risk detection
 * Combines committed, unstaged, and untracked files.
 */
interface GetAllChangedFilesOptions {
  git?: ReturnType<typeof createGitForPath>;
  cwd?: string;
}

export async function getAllChangedFiles(options: GetAllChangedFilesOptions = {}) {
  const { git = createGitForPath(options.cwd ?? process.cwd()) } = options;

  try {
    return await getChangedFilesForIncremental({ git });
  } catch (error) {
    console.error('\u26A0\uFE0F  Failed to get changed files:', error.message);
    return [];
  }
}

// ── WU helpers ─────────────────────────────────────────────────────────

/**
 * Parse a WU ID from a branch name.
 * Returns canonical upper-case ID (e.g., WU-123) or null when not present.
 */
export function parseWUFromBranchName(branchName: string | null | undefined): string | null {
  if (!branchName) {
    return null;
  }

  const match = branchName.match(/wu-(\d+)/i);
  if (!match) {
    return null;
  }

  return `WU-${match[1]}`.toUpperCase();
}

export async function detectCurrentWUForCwd(cwd?: string): Promise<string | null> {
  const workingDir = cwd ?? process.cwd();

  try {
    const branch = await createGitForPath(workingDir).getCurrentBranch();
    const parsed = parseWUFromBranchName(branch);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall back to legacy process-cwd based resolver below.
  }

  return getCurrentWU();
}

// ── Package extraction (WU-1299) ──────────────────────────────────────

/**
 * WU-1299: Extract package name from a single code path
 */
function extractPackageFromPath(codePath: string): string | null {
  if (!codePath || typeof codePath !== 'string') {
    return null;
  }

  const normalized = codePath.replace(/\\/g, '/');

  // Handle packages/@scope/name/... or packages/name/...
  if (normalized.startsWith('packages/')) {
    const parts = normalized.slice('packages/'.length).split('/');
    // Scoped package (@scope/name)
    if (parts[0]?.startsWith('@') && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
    // Unscoped package
    if (parts[0]) {
      return parts[0];
    }
  }

  // WU-1415: Skip apps/ paths - they aren't valid turbo packages for test filtering
  return null;
}

/**
 * WU-1299: Extract package/app names from code_paths
 */
export function extractPackagesFromCodePaths(codePaths: string[]): string[] {
  if (!codePaths || !Array.isArray(codePaths) || codePaths.length === 0) {
    return [];
  }

  const packages = new Set<string>();

  for (const codePath of codePaths) {
    const pkg = extractPackageFromPath(codePath);
    if (pkg) {
      packages.add(pkg);
    }
  }

  return Array.from(packages);
}

/**
 * WU-1299: Load code_paths from current WU YAML
 */
export function loadCurrentWUCodePaths(options: { cwd?: string } = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const wuId = getCurrentWU();

  if (!wuId) {
    return [];
  }

  try {
    const wuPaths = createWuPaths({ projectRoot: cwd });
    const wuYamlPath = wuPaths.WU(wuId);
    const wuDoc = readWURaw(wuYamlPath);

    if (wuDoc && Array.isArray(wuDoc.code_paths)) {
      return wuDoc.code_paths.filter((p: unknown): p is string => typeof p === 'string');
    }
  } catch {
    // WU YAML not found or unreadable - return empty array
  }

  return [];
}
