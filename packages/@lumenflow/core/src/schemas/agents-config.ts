// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Agents Configuration Schemas
 *
 * Agent client configuration including blocks, skills, enforcement,
 * methodology defaults, and capabilities mapping.
 *
 * @module schemas/agents-config
 */

import { z } from 'zod';
import { LUMENFLOW_CLIENT_IDS } from '../wu-context-constants.js';

/**
 * Methodology defaults (agent-facing project defaults)
 */
export const DEFAULT_METHODOLOGY_PRINCIPLES = [
  'TDD',
  'Hexagonal Architecture',
  'SOLID',
  'DRY',
  'YAGNI',
  'KISS',
  'Library-First',
];

export const MethodologyDefaultsSchema = z.object({
  /** Enable or disable project defaults output */
  enabled: z.boolean().default(true),

  /** Whether defaults are required or recommended */
  enforcement: z.enum(['required', 'recommended']).default('required'),

  /** Default methodology principles to apply */
  principles: z.array(z.string()).default(DEFAULT_METHODOLOGY_PRINCIPLES),

  /** Optional notes appended to Project Defaults */
  notes: z.string().optional(),
});

/**
 * Client-specific blocks (agent-facing spawn blocks)
 */
export const ClientBlockSchema = z.object({
  /** Block title */
  title: z.string(),

  /** Block content (markdown allowed) */
  content: z.string(),
});

/**
 * Client-specific skills guidance
 */
export const ClientSkillsSchema = z.object({
  /** Optional skills selection guidance text */
  instructions: z.string().optional(),

  /** Recommended skills to load for this client */
  recommended: z.array(z.string()).default([]),

  /**
   * WU-1142: Lane-specific skills to recommend
   * Maps lane names to arrays of skill names
   * @example
   * byLane:
   *   'Framework: Core': ['tdd-workflow', 'lumenflow-gates']
   *   'Content: Documentation': ['worktree-discipline']
   */
  byLane: z.record(z.string(), z.array(z.string())).optional(),
});

/**
 * WU-1367: Client enforcement configuration
 *
 * Configures workflow compliance enforcement via Claude Code hooks.
 * When enabled, hooks block non-compliant operations instead of relying
 * on agents to remember workflow rules.
 *
 * @example
 * ```yaml
 * agents:
 *   clients:
 *     claude-code:
 *       enforcement:
 *         hooks: true
 *         block_outside_worktree: true
 *         require_wu_for_edits: true
 *         warn_on_stop_without_wu_done: true
 * ```
 */
export const ClientEnforcementSchema = z.object({
  /**
   * Enable enforcement hooks.
   * When true, hooks are generated in .claude/hooks/
   * @default false
   */
  hooks: z.boolean().default(false),

  /**
   * Block Write/Edit operations when cwd is not a worktree.
   * Prevents accidental edits to main checkout.
   * @default false
   */
  block_outside_worktree: z.boolean().default(false),

  /**
   * Require a claimed WU for Write/Edit operations.
   * Ensures all edits are associated with tracked work.
   * @default false
   */
  require_wu_for_edits: z.boolean().default(false),

  /**
   * Warn when session ends without wu:done being called.
   * Reminds agents to complete their work properly.
   * @default false
   */
  warn_on_stop_without_wu_done: z.boolean().default(false),
});

/** WU-1367: TypeScript type for client enforcement config */
export type ClientEnforcement = z.infer<typeof ClientEnforcementSchema>;

/**
 * Client configuration (per-client settings)
 */
export const ClientConfigSchema = z.object({
  /** Preamble file path (e.g. 'CLAUDE.md') or false to disable */
  preamble: z.union([z.string(), z.boolean()]).optional(),

  /** Skills directory path */
  skillsDir: z.string().optional(),

  /** Agents directory path */
  agentsDir: z.string().optional(),

  /** Client-specific blocks injected into wu:spawn output */
  blocks: z.array(ClientBlockSchema).default([]),

  /** Client-specific skills guidance for wu:spawn */
  skills: ClientSkillsSchema.optional(),

  /**
   * WU-1367: Enforcement configuration for Claude Code hooks.
   * When enabled, generates hooks that enforce workflow compliance.
   */
  enforcement: ClientEnforcementSchema.optional(),

  /**
   * WU-1900: Capability-to-skill mapping for classifier-driven skill suggestions.
   * Maps abstract capability tags from the work classifier to client-specific skill names.
   *
   * @example
   * ```yaml
   * agents:
   *   clients:
   *     claude-code:
   *       capabilities_map:
   *         ui-design-awareness: frontend-design
   *         component-reuse-check: library-first
   * ```
   */
  capabilities_map: z.record(z.string(), z.string()).optional(),
});

/**
 * Agents configuration
 */
export const AgentsConfigSchema = z.object({
  /** Default client to use if not specified (configure per project; bootstrap default: 'claude-code') */
  defaultClient: z.string().default(LUMENFLOW_CLIENT_IDS.CLAUDE_CODE),

  /** Client-specific configurations */
  clients: z.record(z.string(), ClientConfigSchema).default({}),

  /** Project methodology defaults (agent-facing) */
  methodology: MethodologyDefaultsSchema.default(() => MethodologyDefaultsSchema.parse({})),
});

export type MethodologyDefaults = z.infer<typeof MethodologyDefaultsSchema>;
export type ClientBlock = z.infer<typeof ClientBlockSchema>;
export type ClientSkills = z.infer<typeof ClientSkillsSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
