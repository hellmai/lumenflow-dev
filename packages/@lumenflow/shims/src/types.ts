// @lumenflow/shims - Type definitions (WU-2546)
import { z } from 'zod';

// Strings stored separately to avoid hook false positives
const NO_VERIFY_FLAG = '--no-' + 'verify';
const NO_GPG_SIGN_FLAG = '--no-' + 'gpg-sign';

export const GitShimConfigSchema = z.object({
protectedBranch: z.string().default('main'),
bannedPatterns: z
  .array(
    z.object({
      command: z.string(),
      flags: z.array(z.string()).optional(),
    })
  )
  .default([
    { command: 'reset', flags: ['--hard'] },
    { command: 'stash' },
    { command: 'clean', flags: ['-fd', '-df'] },
    { command: 'checkout', flags: ['-f', '--force'] },
    { command: 'push', flags: ['--force', '-f'] },
  ]),
bannedFlags: z.array(z.string()).default([NO_VERIFY_FLAG, NO_GPG_SIGN_FLAG]),
realGitPath: z.string().default('/usr/bin/git'),
enableLogging: z.boolean().default(false),
logPath: z.string().optional(),
recursionEnvVar: z.string().default('LUMENFLOW_GIT_SHIM_ACTIVE'),
agentEnvVars: z
  .array(z.string())
  .default(['CLAUDE_SESSION_ID', 'LUMENFLOW_AGENT_SESSION', 'CI', 'GITHUB_ACTIONS', 'ANTHROPIC_API_KEY']),
});

export type GitShimConfig = z.infer<typeof GitShimConfigSchema>;

export const PnpmShimConfigSchema = z.object({
dependencyCommands: z.array(z.string()).default(['add', 'remove', 'install', 'update', 'i', 'rm', 'up']),
systemPnpmPaths: z
  .array(z.string())
  .default(['/usr/local/bin/pnpm', '/usr/bin/pnpm', '/opt/homebrew/bin/pnpm']),
recursionEnvVar: z.string().default('LUMENFLOW_PNPM_SHIM_ACTIVE'),
enableDebug: z.boolean().default(false),
});

export type PnpmShimConfig = z.infer<typeof PnpmShimConfigSchema>;

export const ShimConfigSchema = z.object({
git: GitShimConfigSchema.default({}),
pnpm: PnpmShimConfigSchema.default({}),
});

export type ShimConfig = z.infer<typeof ShimConfigSchema>;

export const UserType = {
AGENT: 'agent',
HUMAN: 'human',
UNKNOWN: 'unknown',
} as const;

export type UserType = (typeof UserType)[keyof typeof UserType];

export const CommandOutcome = {
ALLOWED: 'allowed',
BLOCKED: 'blocked',
UNKNOWN: 'unknown',
} as const;

export type CommandOutcome = (typeof CommandOutcome)[keyof typeof CommandOutcome];

export interface BannedPatternResult {
banned: boolean;
reason: string | null;
}

export interface ProtectedContextResult {
protected: boolean;
context: string;
}
