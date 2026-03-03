// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { randomBytes } from 'node:crypto';
import type { AuditEvent } from './storage.js';

export interface ToolContextLike {
  tool_name?: string;
  receipt_id?: string;
  workspace_id?: string;
}

export interface ToolOutput {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
}

export function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: string[] = [];
  for (const entry of value) {
    const normalized = asNonEmptyString(entry);
    if (normalized) {
      items.push(normalized);
    }
  }
  return [...new Set(items)];
}

export function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isDryRun(input: Record<string, unknown>): boolean {
  return input.dry_run === true;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export function failure(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ToolOutput {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

export function success(data: Record<string, unknown>): ToolOutput {
  return {
    success: true,
    data,
  };
}

export function matchesTags(requiredTags: string[], candidateTags: string[]): boolean {
  if (requiredTags.length === 0) {
    return true;
  }
  const candidateSet = new Set(candidateTags.map((tag) => tag.toLowerCase()));
  return requiredTags.every((tag) => candidateSet.has(tag.toLowerCase()));
}

export function includesText(haystack: string, needle: string | null): boolean {
  if (!needle) {
    return true;
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function buildAuditEvent(input: {
  tool: string;
  op: AuditEvent['op'];
  context?: ToolContextLike;
  ids?: string[];
  details?: Record<string, unknown>;
}): AuditEvent {
  return {
    id: createId('evt'),
    ts: nowIso(),
    tool: input.tool,
    op: input.op,
    actor: input.context?.receipt_id,
    ids: input.ids,
    details: input.details,
  };
}
