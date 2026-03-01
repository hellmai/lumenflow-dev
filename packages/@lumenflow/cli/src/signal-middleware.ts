// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { loadSignals, type Signal } from '@lumenflow/memory/signal';

/**
 * WU-2147: High-value commands always surface unread coordination signals.
 */
const HIGH_VALUE_COMMANDS = new Set([
  'wu:claim',
  'wu:create',
  'wu:prep',
  'wu:done',
  'wu:status',
  'wu:recover',
  'wu:release',
]);

/**
 * WU-2147: Low-value commands skip middleware checks entirely.
 */
const LOW_VALUE_COMMAND_PREFIXES = ['mem:', 'file:', 'git:'];

/**
 * WU-2147: Generic command checks are throttled to avoid noisy overhead.
 */
export const GENERIC_CHECK_THROTTLE_MS = 30_000;

/**
 * WU-2147: Remote pull timeout requirement.
 */
export const REMOTE_PULL_TIMEOUT_MS = 200;

/**
 * Circuit breaker threshold for remote pull failures.
 */
const REMOTE_CIRCUIT_FAILURE_THRESHOLD = 3;

/**
 * Duration to keep the remote pull circuit open after threshold is reached.
 */
const REMOTE_CIRCUIT_OPEN_MS = 60_000;

const genericLastCheckedAtMs = new Map<string, number>();

type RemoteCircuitState = {
  failureCount: number;
  openUntilMs: number;
};

const remoteCircuitState: RemoteCircuitState = {
  failureCount: 0,
  openUntilMs: 0,
};

export interface SignalMiddlewareOptions {
  commandName?: string | null;
  baseDir?: string;
  now?: () => number;
  stderrWrite?: (text: string) => void;
  loadUnreadSignals?: (baseDir: string) => Promise<Signal[]>;
  remotePull?: (baseDir: string) => Promise<void>;
  remotePullTimeoutMs?: number;
}

function defaultStderrWrite(text: string): void {
  process.stderr.write(text);
}

function defaultLoadUnreadSignals(baseDir: string): Promise<Signal[]> {
  return loadSignals(baseDir, { unreadOnly: true });
}

/**
 * Convert a bin name (wu-claim) to canonical command name (wu:claim).
 */
export function binToCommandName(binName: string): string {
  if (!binName.includes('-')) {
    return binName;
  }

  const [head, ...rest] = binName.split('-');
  if (!head || rest.length === 0) {
    return binName;
  }

  return `${head}:${rest.join('-')}`;
}

/**
 * Resolve command name from argv entry path.
 */
export function resolveCommandNameFromArgv(argv: string[]): string | null {
  const entry = argv[1];
  if (!entry || typeof entry !== 'string') {
    return null;
  }

  const normalizedEntry = entry.replace(/\\/g, '/');
  const fileName = normalizedEntry.split('/').at(-1) ?? '';
  if (!fileName) {
    return null;
  }

  const binName = fileName.replace(/\.m?js$/i, '');
  if (!binName) {
    return null;
  }

  return binToCommandName(binName);
}

function normalizeCommandName(commandName: string | null | undefined): string | null {
  if (!commandName) {
    return null;
  }
  const normalized = commandName.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isLowValueCommand(commandName: string): boolean {
  return LOW_VALUE_COMMAND_PREFIXES.some((prefix) => commandName.startsWith(prefix));
}

function isGenericCommand(commandName: string): boolean {
  return commandName.startsWith('wu:') && !HIGH_VALUE_COMMANDS.has(commandName);
}

function shouldRunGenericCheck(commandName: string, nowMs: number): boolean {
  const lastCheck = genericLastCheckedAtMs.get(commandName);
  if (lastCheck !== undefined && nowMs - lastCheck < GENERIC_CHECK_THROTTLE_MS) {
    return false;
  }
  genericLastCheckedAtMs.set(commandName, nowMs);
  return true;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Remote signal pull timed out')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function maybePullRemoteSignals(
  options: Required<Pick<SignalMiddlewareOptions, 'remotePull' | 'baseDir' | 'remotePullTimeoutMs'>> & {
    nowMs: number;
  },
): Promise<void> {
  const nowMs = options.nowMs;
  if (remoteCircuitState.openUntilMs > nowMs) {
    return;
  }

  try {
    await runWithTimeout(options.remotePull(options.baseDir), options.remotePullTimeoutMs);
    remoteCircuitState.failureCount = 0;
    remoteCircuitState.openUntilMs = 0;
  } catch {
    remoteCircuitState.failureCount += 1;
    if (remoteCircuitState.failureCount >= REMOTE_CIRCUIT_FAILURE_THRESHOLD) {
      remoteCircuitState.openUntilMs = nowMs + REMOTE_CIRCUIT_OPEN_MS;
      remoteCircuitState.failureCount = 0;
    }
  }
}

function formatSignalSummary(signals: Signal[]): string {
  const preview = signals.slice(0, 3);
  const lines = preview.map((signal, index) => {
    const scope = signal.wu_id ?? signal.lane ?? 'global';
    return `  ${index + 1}. [${scope}] ${signal.message}`;
  });

  const overflowCount = signals.length - preview.length;
  const overflowLine = overflowCount > 0 ? `\n  ...and ${overflowCount} more` : '';

  return (
    `[signals] ${signals.length} unread coordination signal(s)\n` +
    `${lines.join('\n')}${overflowLine}\n`
  );
}

/**
 * WU-2147: Pre-command middleware for signal surfacing.
 *
 * Fail-open by design: all errors are swallowed so command execution proceeds.
 */
export async function runSignalMiddleware(options: SignalMiddlewareOptions): Promise<void> {
  const commandName = normalizeCommandName(options.commandName);
  if (!commandName) {
    return;
  }

  if (isLowValueCommand(commandName)) {
    return;
  }

  const now = options.now ?? Date.now;
  const nowMs = now();
  const isHighValue = HIGH_VALUE_COMMANDS.has(commandName);

  if (!isHighValue && isGenericCommand(commandName) && !shouldRunGenericCheck(commandName, nowMs)) {
    return;
  }

  const baseDir = options.baseDir ?? process.cwd();
  const loadUnreadSignals = options.loadUnreadSignals ?? defaultLoadUnreadSignals;
  const stderrWrite = options.stderrWrite ?? defaultStderrWrite;

  try {
    if (options.remotePull) {
      await maybePullRemoteSignals({
        remotePull: options.remotePull,
        baseDir,
        remotePullTimeoutMs: options.remotePullTimeoutMs ?? REMOTE_PULL_TIMEOUT_MS,
        nowMs,
      });
    }

    const unreadSignals = await loadUnreadSignals(baseDir);
    if (unreadSignals.length === 0) {
      return;
    }

    stderrWrite(formatSignalSummary(unreadSignals));
  } catch {
    // WU-2147 AC3: middleware errors must never block command execution.
  }
}

/**
 * Test helper for resetting module-level throttling/circuit state.
 */
export function resetSignalMiddlewareStateForTests(): void {
  genericLastCheckedAtMs.clear();
  remoteCircuitState.failureCount = 0;
  remoteCircuitState.openUntilMs = 0;
}
