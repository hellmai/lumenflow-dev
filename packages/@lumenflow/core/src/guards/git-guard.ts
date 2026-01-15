/**
 * Git Guard (WU-2539)
 *
 * Protects main branch from destructive git commands.
 * Blocks operations like reset --hard, stash, clean -fd on protected contexts.
 *
 * @module @lumenflow/core/guards
 */

/**
 * Result of checking if a git command is banned.
 */
export interface BannedCheckResult {
  /** Whether the command is banned */
  banned: boolean;
  /** Reason for banning, or null if allowed */
  reason: string | null;
}

/**
 * Context information for protection check.
 */
export interface ProtectedContextInput {
  /** Current git branch name */
  branch: string;
  /** Whether we're in the main worktree */
  isMainWorktree: boolean;
}

/**
 * Result of checking protected context.
 */
export interface ProtectedContext {
  /** Whether the context is protected */
  protected: boolean;
  /** Description of the context */
  context: string;
}

interface BannedPattern {
  command: string;
  flags?: string[];
}

const BANNED_PATTERNS: BannedPattern[] = [
  { command: 'reset', flags: ['--hard'] },
  { command: 'stash' },
  { command: 'clean', flags: ['-fd', '-df'] },
  { command: 'checkout', flags: ['-f', '--force'] },
  { command: 'push', flags: ['--force', '-f'] },
];

const BANNED_FLAGS = ['--no-verify', '--no-gpg-sign'];

export function checkBannedPattern(args: string[]): BannedCheckResult {
  if (args.length === 0) {
    return { banned: false, reason: null };
  }

  const command = args[0]?.toLowerCase();
  const flags = args.slice(1).map((a) => a.toLowerCase());

  for (const bannedFlag of BANNED_FLAGS) {
    if (flags.includes(bannedFlag)) {
      return {
        banned: true,
        reason: `Flag ${bannedFlag} bypasses hooks and is forbidden`,
      };
    }
  }

  for (const pattern of BANNED_PATTERNS) {
    if (command !== pattern.command) {
      continue;
    }

    if (!pattern.flags) {
      return {
        banned: true,
        reason: `Command "git ${command}" is destructive and forbidden on main`,
      };
    }

    const hasRequiredFlag = pattern.flags.some((reqFlag) => flags.includes(reqFlag));
    if (hasRequiredFlag) {
      return {
        banned: true,
        reason: `Command "git ${args.join(' ')}" is destructive and forbidden on main`,
      };
    }
  }

  return { banned: false, reason: null };
}

export function checkProtectedContext(input: ProtectedContextInput): ProtectedContext {
  const { branch, isMainWorktree } = input;

  const isProtected = branch === 'main' || isMainWorktree;

  let context: string;
  if (isProtected) {
    context = isMainWorktree ? 'main worktree' : 'main branch';
  } else {
    context = `${branch} branch in lane worktree`;
  }

  return { protected: isProtected, context };
}

export function formatBlockedError(command: string, reason: string, context: string): string {
  return `[GIT GUARD] BLOCKED

  Command: git ${command}
  Reason: ${reason}
  Context: ${context}`;
}
