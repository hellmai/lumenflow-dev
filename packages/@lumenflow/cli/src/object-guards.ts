// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

const TYPEOF_OBJECT = 'object' as const;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === TYPEOF_OBJECT && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
