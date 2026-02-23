// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical client IDs for client-specific integrations and config keys.
 *
 * Kept in a standalone module so config schema can depend on these
 * constants without importing context/hook modules.
 */
export const LUMENFLOW_CLIENT_IDS = {
  CLAUDE_CODE: 'claude-code',
  CODEX_CLI: 'codex-cli',
  CURSOR: 'cursor',
  GEMINI_CLI: 'gemini-cli',
  WINDSURF: 'windsurf',
} as const;

/** Type for supported client IDs with integration support */
export type LumenflowClientId = (typeof LUMENFLOW_CLIENT_IDS)[keyof typeof LUMENFLOW_CLIENT_IDS];
