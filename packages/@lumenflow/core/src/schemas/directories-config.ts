// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Directories and State Paths Configuration Schemas
 *
 * Directory paths and .lumenflow state directory structure schemas.
 *
 * @module schemas/directories-config
 */

import { z } from 'zod';
import { DURATION_MS } from '../constants/duration-constants.js';

/**
 * Event archival configuration (WU-1207)
 *
 * Configures archival of old WU events from .lumenflow/state/wu-events.jsonl
 * to .lumenflow/archive/wu-events-YYYY-MM.jsonl to prevent unbounded growth.
 */
export const EventArchivalConfigSchema = z.object({
  /**
   * Archive events older than this duration in milliseconds (default: 90 days).
   * Completed WU events older than this are moved to monthly archive files.
   * Active WU events (in_progress/blocked/waiting) are never archived.
   */
  archiveAfter: z.number().int().positive().default(DURATION_MS.NINETY_DAYS),

  /**
   * Whether to keep archive files (default: true).
   * When true, archived events are preserved in monthly archive files.
   * When false, archived events are deleted (not recommended for audit trails).
   */
  keepArchives: z.boolean().default(true),
});

/**
 * Directory paths configuration
 */
export const DirectoriesSchema = z.object({
  /** Working directory for web app (default: 'apps/web/') */
  appsWeb: z.string().default('apps/web/'),

  /** Worktrees directory (default: 'worktrees/') */
  worktrees: z.string().default('worktrees/'),

  /** AI assets directory (default: 'ai/') */
  ai: z.string().default('ai/'),

  /** Claude configuration directory (default: '.claude/') */
  claude: z.string().default('.claude/'),

  /** Documentation root (default: 'docs/') */
  docs: z.string().default('docs/'),

  /** Packages directory (default: 'packages/') */
  packages: z.string().default('packages/'),

  /** Tools directory (default: 'tools/') */
  tools: z.string().default('tools/'),

  /** Memory bank directory (default: 'memory-bank/') */
  memoryBank: z.string().default('memory-bank/'),

  /** WU YAML files directory (default: 'docs/04-operations/tasks/wu') */
  wuDir: z.string().default('docs/04-operations/tasks/wu'),

  /** Initiatives directory (default: 'docs/04-operations/tasks/initiatives') */
  initiativesDir: z.string().default('docs/04-operations/tasks/initiatives'),

  /** Backlog file path (default: 'docs/04-operations/tasks/backlog.md') */
  backlogPath: z.string().default('docs/04-operations/tasks/backlog.md'),

  /** Status file path (default: 'docs/04-operations/tasks/status.md') */
  statusPath: z.string().default('docs/04-operations/tasks/status.md'),

  /** Skills directory (default: '.claude/skills') */
  skillsDir: z.string().default('.claude/skills'),

  /** Agents directory (default: '.claude/agents') */
  agentsDir: z.string().default('.claude/agents'),

  /** Plans directory (default: 'docs/04-operations/plans') - WU-1301 */
  plansDir: z.string().default('docs/04-operations/plans'),

  /** Templates directory (default: '.lumenflow/templates') - WU-1310 */
  templatesDir: z.string().default('.lumenflow/templates'),

  /** Onboarding directory (default: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding') - WU-1310 */
  onboardingDir: z.string().default('docs/04-operations/_frameworks/lumenflow/agent/onboarding'),

  /** Safe-git wrapper path relative to project root (default: 'scripts/safe-git') - WU-1654 */
  safeGitPath: z.string().default('scripts/safe-git'),
});

/**
 * State paths configuration (.lumenflow directory structure)
 */
export const StatePathsSchema = z.object({
  /** Base state directory (default: '.lumenflow') */
  base: z.string().default('.lumenflow'),

  /** State directory (default: '.lumenflow/state') */
  stateDir: z.string().default('.lumenflow/state'),

  /** Archive directory (default: '.lumenflow/archive') */
  archiveDir: z.string().default('.lumenflow/archive'),

  /** Stamps directory (default: '.lumenflow/stamps') */
  stampsDir: z.string().default('.lumenflow/stamps'),

  /** Merge lock file (default: '.lumenflow/merge.lock') */
  mergeLock: z.string().default('.lumenflow/merge.lock'),

  /** Telemetry directory (default: '.lumenflow/telemetry') */
  telemetry: z.string().default('.lumenflow/telemetry'),

  /** Flow log file (default: '.lumenflow/flow.log') */
  flowLog: z.string().default('.lumenflow/flow.log'),

  /** Sessions directory (default: '.lumenflow/sessions') */
  sessions: z.string().default('.lumenflow/sessions'),

  /** Incidents directory (default: '.lumenflow/incidents') */
  incidents: z.string().default('.lumenflow/incidents'),

  /** Commands log file (default: '.lumenflow/commands.log') */
  commandsLog: z.string().default('.lumenflow/commands.log'),

  /**
   * WU-1207: Event archival configuration
   * Controls archival of old WU events to prevent unbounded growth.
   */
  eventArchival: EventArchivalConfigSchema.default(() => EventArchivalConfigSchema.parse({})),
});

export type EventArchivalConfig = z.infer<typeof EventArchivalConfigSchema>;
export type Directories = z.infer<typeof DirectoriesSchema>;
export type StatePaths = z.infer<typeof StatePathsSchema>;
