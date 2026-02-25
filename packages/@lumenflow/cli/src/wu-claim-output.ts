// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-claim-output.ts
 * @description Output formatting and display helpers for wu:claim.
 *
 * WU-1649: Extracted from wu-claim.ts to reduce orchestration complexity.
 * All functions are mechanical extractions preserving original behavior.
 */

import { getErrorMessage } from '@lumenflow/core/error-handler';
import { LOG_PREFIX } from '@lumenflow/core/wu-constants';
// WU-1473: Surface unread signals on claim for agent awareness
import { surfaceUnreadSignals } from './hooks/enforcement-generator.js';

const PREFIX = LOG_PREFIX.CLAIM;

/**
 * WU-1473: Surface unread coordination signals and display them.
 * Fail-open: UnsafeAny error is logged as a warning, never blocks claim.
 *
 * @param baseDir - Project base directory for memory layer
 */
export async function surfaceUnreadSignalsForDisplay(baseDir: string): Promise<void> {
  try {
    const result = await surfaceUnreadSignals(baseDir);
    if (result.count > 0) {
      const MAX_DISPLAY = 5;
      console.log(`\n${PREFIX} Unread coordination signals (${result.count}):`);
      for (const signal of result.signals.slice(0, MAX_DISPLAY)) {
        const timestamp = new Date(signal.created_at).toLocaleTimeString();
        const scope = signal.wu_id ? ` [${signal.wu_id}]` : '';
        console.log(`  - [${timestamp}]${scope} ${signal.message}`);
      }
      if (result.count > MAX_DISPLAY) {
        console.log(`  ... and ${result.count - MAX_DISPLAY} more`);
      }
      console.log(`  Run 'pnpm mem:inbox' for full list`);
    }
  } catch (err) {
    // WU-1473 AC4: Fail-open - never block claim on memory errors
    console.warn(`${PREFIX} Warning: Could not surface unread signals: ${getErrorMessage(err)}`);
  }
}

/**
 * WU-1047: Format Project Defaults section (agent-only).
 *
 * @param {object} methodology - Methodology defaults config
 * @returns {string} Formatted output or empty string if disabled
 */
export function formatProjectDefaults(methodology: Record<string, unknown> | null | undefined) {
  if (!methodology || methodology.enabled === false) return '';

  const enforcement =
    typeof methodology.enforcement === 'string' ? methodology.enforcement : 'required';
  const principles = Array.isArray(methodology.principles) ? methodology.principles : [];
  const lines = [
    `${PREFIX} 🧭 Project Defaults (agent-only)`,
    `  Enforcement: ${enforcement}`,
    `  Principles: ${principles.length > 0 ? (principles as string[]).join(', ') : 'None'}`,
  ];

  if (typeof methodology.notes === 'string') {
    lines.push(`  Notes: ${methodology.notes}`);
  }

  return `\n${lines.join('\n')}`;
}

/**
 * WU-1047: Print Project Defaults section (agent-only).
 *
 * @param {object} methodology - Methodology defaults config
 */
export function printProjectDefaults(methodology: Record<string, unknown> | null | undefined) {
  const output = formatProjectDefaults(methodology);
  if (output) {
    console.log(output);
  }
}

/**
 * WU-1763: Print a single concise tips line to improve tool adoption.
 * Non-blocking, single-line output to avoid flooding the console.
 *
 * @param {string} _id - WU ID being claimed (unused, kept for future use)
 */
export function printLifecycleNudge(_id: string) {
  // Single line, concise, actionable
  console.log(
    `\n${PREFIX} 💡 Tip: pnpm session:recommend for context tier, mem:ready for pending work, pnpm file:*/git:* for audited wrappers`,
  );
}
