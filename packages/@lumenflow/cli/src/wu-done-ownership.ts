// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

export interface ClaimSessionOwnershipInput {
  wuId: string;
  claimedSessionId?: string | null;
  activeSessionId?: string | null;
  force: boolean;
}

export interface ClaimSessionOwnershipResult {
  valid: boolean;
  auditRequired: boolean;
  error: string | null;
}

export function validateClaimSessionOwnership({
  wuId,
  claimedSessionId,
  activeSessionId,
  force,
}: ClaimSessionOwnershipInput): ClaimSessionOwnershipResult {
  // Legacy WUs without claim-session metadata remain supported.
  if (!claimedSessionId) {
    return { valid: true, auditRequired: false, error: null };
  }

  if (claimedSessionId === activeSessionId) {
    return { valid: true, auditRequired: false, error: null };
  }

  if (force) {
    return { valid: true, auditRequired: true, error: null };
  }

  const activeDisplay = activeSessionId || 'none';
  return {
    valid: false,
    auditRequired: false,
    error:
      `\n❌ CLAIM OWNERSHIP VIOLATION: ${wuId} was claimed by a different session.\n\n` +
      `   Claimed session: ${claimedSessionId}\n` +
      `   Active session: ${activeDisplay}\n\n` +
      `   WIP limits are stop signals. Do not complete another agent's WU.\n` +
      `   If this is orphan recovery, rerun with --force and provide --reason.\n`,
  };
}
