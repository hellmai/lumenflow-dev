// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-template-assembler.ts
 * WU-2012: Extracted from wu-spawn.ts
 *
 * Template loading, assembly, and context building for spawn prompts.
 *
 * Single responsibility: Load templates from .lumenflow/templates/ and
 * assemble them for spawn prompts, with graceful fallback to hardcoded sections.
 *
 * @module spawn-template-assembler
 */

import {
  loadManifest,
  loadTemplatesWithOverrides,
  assembleTemplates,
  type TemplateContext,
} from './template-loader.js';
import type { ResolvedPolicy } from './resolve-policy.js';

/**
 * WU-1192: Truncation prevention constants (consolidated from CLI)
 *
 * These constants help detect when spawn output has been truncated during
 * copy-paste operations or context loading. The warning banner alerts users
 * to the truncation risk, and the end sentinel allows verification that
 * the full output was received.
 */
export const TRUNCATION_WARNING_BANNER = `<!-- LUMENFLOW_TRUNCATION_WARNING -->
<!--
  \u26a0\ufe0f CRITICAL: DO NOT TRUNCATE THIS OUTPUT

  This spawn prompt MUST be copied verbatim. Truncation causes:
  - Missing constraints (agents ignore safety rules)
  - Missing TDD directives (agents skip tests)
  - Degraded agent performance

  VERIFICATION: The output MUST end with: <!-- LUMENFLOW_SPAWN_END -->
  If you don't see that sentinel at the end, the output was truncated.
-->
`;

export const SPAWN_END_SENTINEL = '<!-- LUMENFLOW_SPAWN_END -->';

/**
 * WU-1253/WU-1291: Try to assemble spawn prompt sections from templates.
 *
 * This function loads templates from .lumenflow/templates/ and assembles
 * them according to the manifest order. Client-specific overrides are
 * supported via templates.{client}/ directories.
 *
 * **Decision (WU-1291)**: Template system is ACTIVATED. This function is called
 * by generateTaskInvocation() and generateCodexPrompt() to attempt template-based
 * generation. If it returns null (templates missing, manifest invalid, or assembly
 * fails), callers fall back to hardcoded generator functions.
 *
 * @param baseDir - Project root directory
 * @param clientName - Client name for overrides (e.g., 'claude', 'cursor')
 * @param context - Context for token replacement and condition evaluation
 * @returns Assembled template content, or null if templates unavailable
 */
export function tryAssembleSpawnTemplates(
  baseDir: string,
  clientName: string,
  context: TemplateContext,
): string | null {
  try {
    const manifest = loadManifest(baseDir);
    const templates = loadTemplatesWithOverrides(baseDir, clientName);

    if (templates.size === 0) {
      return null;
    }

    return assembleTemplates(templates, manifest, context);
  } catch {
    // Template loading failed - return null for hardcoded fallback (intentional)
    return null;
  }
}

/**
 * Build template context from WU document.
 *
 * @param doc - WU YAML document
 * @param id - WU ID
 * @returns Context for template assembly
 */
export function buildTemplateContext(doc: Record<string, unknown>, id: string): TemplateContext {
  const lane = (doc.lane as string) || '';
  const laneParent = lane.split(':')[0]?.trim() || '';

  return {
    WU_ID: id,
    LANE: lane,
    TYPE: ((doc.type as string) || 'feature').toLowerCase(),
    TITLE: (doc.title as string) || '',
    DESCRIPTION: (doc.description as string) || '',
    WORKTREE_PATH: (doc.worktree_path as string) || '',
    laneParent,
    // Add lowercase aliases for condition evaluation
    type: ((doc.type as string) || 'feature').toLowerCase(),
    lane,
    worktreePath: (doc.worktree_path as string) || '',
  };
}

/**
 * WU-1261: Build template context with resolved policy fields.
 *
 * Extends buildTemplateContext() with policy.testing and policy.architecture
 * fields for template condition evaluation.
 *
 * @param doc - WU YAML document
 * @param id - WU ID
 * @param policy - Resolved policy from resolvePolicy()
 * @returns Context for template assembly with policy fields
 */
export function buildTemplateContextWithPolicy(
  doc: Record<string, unknown>,
  id: string,
  policy: ResolvedPolicy,
): TemplateContext & { 'policy.testing': string; 'policy.architecture': string } {
  const baseContext = buildTemplateContext(doc, id);

  return {
    ...baseContext,
    'policy.testing': policy.testing,
    'policy.architecture': policy.architecture,
  };
}
