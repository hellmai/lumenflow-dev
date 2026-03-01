// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { evaluateCoChangeRules, type CoChangeRuleConfig } from '../gates-runners.js';

describe('co-change gate rule evaluation', () => {
  const baseRule: CoChangeRuleConfig = {
    name: 'schema-migration',
    trigger_patterns: ['db/schema/**'],
    require_patterns: ['db/migrations/**'],
    severity: 'error',
  };

  it('reports error when trigger matches without require matches', () => {
    const result = evaluateCoChangeRules({
      changedFiles: ['db/schema/tables.sql'],
      rules: [baseRule],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('passes when trigger and require patterns both match', () => {
    const result = evaluateCoChangeRules({
      changedFiles: ['db/schema/tables.sql', 'db/migrations/20260301_add_table.sql'],
      rules: [baseRule],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('skips rule when no trigger pattern matches', () => {
    const result = evaluateCoChangeRules({
      changedFiles: ['docs/readme.md'],
      rules: [baseRule],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns but does not error when severity is warn', () => {
    const result = evaluateCoChangeRules({
      changedFiles: ['db/schema/tables.sql'],
      rules: [{ ...baseRule, severity: 'warn' }],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it('skips rule when severity is off', () => {
    const result = evaluateCoChangeRules({
      changedFiles: ['db/schema/tables.sql'],
      rules: [{ ...baseRule, severity: 'off' }],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
