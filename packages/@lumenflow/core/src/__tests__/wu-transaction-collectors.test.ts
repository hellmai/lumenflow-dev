import { describe, expect, it } from 'vitest';

import { computeWUYAMLContent } from '../wu-transaction-collectors.js';
import { parseYAML } from '../wu-yaml.js';

describe('computeWUYAMLContent completion normalization', () => {
  it('writes completed_at and normalized completed date together', () => {
    const doc = {
      id: 'WU-7777',
      title: 'Normalization test',
      status: 'in_progress',
      created: '2026-02-10',
    };

    const content = computeWUYAMLContent(doc);
    const parsed = parseYAML(content) as {
      status?: string;
      locked?: boolean;
      completed_at?: string;
      completed?: string;
    };

    expect(parsed.status).toBe('done');
    expect(parsed.locked).toBe(true);
    expect(parsed.completed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(parsed.completed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.completed).toBe(String(parsed.completed_at).slice(0, 10));
  });
});
