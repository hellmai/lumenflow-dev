// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { SHA256_ALGORITHM, UTF8_ENCODING } from './shared-constants.js';

type CanonicalPrimitive = null | boolean | number | string;
type CanonicalValue = CanonicalPrimitive | CanonicalValue[] | { [key: string]: CanonicalValue };

// eslint-disable-next-line sonarjs/function-return-type -- recursive JSON canonicalization requires a union return type.
function toCanonicalValue(value: unknown): CanonicalValue {
  let normalized: CanonicalValue;

  if (value === null) {
    normalized = null;
  } else if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    normalized = value;
  } else if (value instanceof Date) {
    normalized = value.toISOString();
  } else if (Array.isArray(value)) {
    normalized = value.map((item) => toCanonicalValue(item));
  } else if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, toCanonicalValue(objectValue[key])] as const);

    const sorted: { [key: string]: CanonicalValue } = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = entryValue;
    }
    normalized = sorted;
  } else {
    throw new TypeError(`Unsupported value in canonical_json input: ${String(value)}`);
  }

  return normalized;
}

export function canonicalStringify(source: unknown): string {
  const parsed = typeof source === 'string' ? parseYaml(source) : source;
  const canonical = toCanonicalValue(parsed);
  return JSON.stringify(canonical);
}

/**
 * Deterministic hash for YAML/object content:
 * parse -> recursive key sort -> compact JSON -> UTF-8 SHA-256 hex.
 */
export function canonical_json(source: unknown): string {
  const canonical = canonicalStringify(source);
  return createHash(SHA256_ALGORITHM).update(canonical, UTF8_ENCODING).digest('hex');
}
