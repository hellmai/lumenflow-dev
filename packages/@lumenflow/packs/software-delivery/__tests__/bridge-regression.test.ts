// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TOOL_IMPL_DIR = path.resolve(
  process.cwd(),
  'packages/@lumenflow/packs/software-delivery/tool-impl',
);

const BRIDGE_PATTERNS = [
  'spawnSync',
  'packages/@lumenflow/cli/dist/',
] as const;

describe('software-delivery bridge regression guard', () => {
  it('contains no CLI dist bridge patterns in tool implementations', () => {
    const entries = new Set<string>();
    const stack = [TOOL_IMPL_DIR];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const children = readdirSync(current, { withFileTypes: true }) as Array<{
        isDirectory: () => boolean;
        isFile: () => boolean;
        name: string;
      }>;
      for (const child of children) {
        const childPath = path.join(current, child.name);
        if (child.isDirectory()) {
          stack.push(childPath);
          continue;
        }
        if (child.isFile() && child.name.endsWith('.ts')) {
          entries.add(childPath);
        }
      }
    }

    const violations: string[] = [];
    for (const filePath of [...entries].sort((left, right) => left.localeCompare(right))) {
      const content = readFileSync(filePath, 'utf8');
      for (const pattern of BRIDGE_PATTERNS) {
        if (content.includes(pattern)) {
          const rel = path.relative(process.cwd(), filePath);
          violations.push(`${rel}: contains "${pattern}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
