import { afterEach, describe, expect, it, vi } from 'vitest';
import * as orchestrationRules from '../orchestration-rules.js';

describe('orchestration-rules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates prioritised suggestions sorted by priority', () => {
    const suggestions = orchestrationRules.generateSuggestions([
      {
        wuId: 'WU-1714',
        dodProgress: 8,
        dodTotal: 10,
        agents: {
          'code-reviewer': 'pending',
          'test-engineer': 'pending',
        },
      },
    ]);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      priority: 'medium',
      action: 'Run code-reviewer',
    });
    expect(suggestions[1]).toMatchObject({
      priority: 'low',
      action: 'Run test-engineer',
    });
    expect(suggestions[0]?.id).toBe('sug-001');
    expect(suggestions[1]?.id).toBe('sug-002');
  });

  it('builds a detailed mandatory agent error message', () => {
    const message = orchestrationRules.buildMandatoryAgentsErrorMessage(
      'WU-1714',
      ['security-auditor'],
      ['src/auth/policy.ts', 'src/auth/rls.sql'],
    );

    expect(message).toContain('WU WU-1714');
    expect(message).toContain('security-auditor');
    expect(message).toContain('src/auth/policy.ts');
    expect(message).toContain('--require-agents');
  });

  it('returns blocking compliance details when required agents are missing', () => {
    const result = orchestrationRules.checkMandatoryAgentsComplianceBlocking(
      ['src/auth/policy.ts'],
      'WU-1714',
      { blocking: true },
    );
    expect(result).toEqual({
      compliant: true,
      blocking: false,
      missing: [],
    });
  });
});
