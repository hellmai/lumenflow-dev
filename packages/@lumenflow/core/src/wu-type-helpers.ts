#!/usr/bin/env node
/**
 * WU type/test helper predicates (WU-1444)
 *
 * Purpose: avoid duplicating policy via string literals across CLI/MCP.
 */

import { TEST_TYPES, WU_TYPES } from './wu-constants.js';

export type WUTypeLike = unknown;

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

export function isDocumentationType(type: WUTypeLike): boolean {
  return typeof type === 'string' && type === WU_TYPES.DOCUMENTATION;
}

export function isProcessType(type: WUTypeLike): boolean {
  return typeof type === 'string' && type === WU_TYPES.PROCESS;
}

export function isDocsOrProcessType(type: WUTypeLike): boolean {
  return isDocumentationType(type) || isProcessType(type);
}

export type TestsLike =
  | {
      manual?: unknown;
      unit?: unknown;
      e2e?: unknown;
      integration?: unknown;
    }
  | undefined;

/**
 * True when any supported test array has at least one item.
 * Supports the canonical tests object shape from WU YAML.
 */
export function hasAnyTests(tests: TestsLike): boolean {
  if (!tests || typeof tests !== 'object') return false;

  const t = tests as Record<string, unknown>;
  return (
    isNonEmptyArray(t[TEST_TYPES.MANUAL]) ||
    isNonEmptyArray(t[TEST_TYPES.UNIT]) ||
    isNonEmptyArray(t[TEST_TYPES.E2E]) ||
    isNonEmptyArray(t[TEST_TYPES.INTEGRATION])
  );
}
