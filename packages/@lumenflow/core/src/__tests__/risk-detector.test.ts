#!/usr/bin/env node
/**
 * Risk Detector Tests
 *
 * WU-2062: Implement tiered test execution for faster wu:done
 *
 * TDD: Tests written BEFORE implementation (RED phase).
 *
 * Risk tiers:
 * - docs-only: Markdown/YAML files only, no code changes
 * - standard: Normal code changes, incremental tests
 * - safety-critical: Tests for red-flag, PHI, escalation (always run)
 * - high-risk: Auth, PHI, RLS code changes (run integration tests)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectRiskTier,
  RISK_TIERS,
  SAFETY_CRITICAL_TEST_PATTERNS,
  HIGH_RISK_PATH_PATTERNS,
  isSafetyCriticalTest,
  isHighRiskPath,
  isHighRiskMigration,
} from '../risk-detector.js';

describe('RISK_TIERS', () => {
  it('should define all risk tier constants', () => {
    expect(RISK_TIERS.DOCS_ONLY).toBe('docs-only');
    expect(RISK_TIERS.STANDARD).toBe('standard');
    expect(RISK_TIERS.SAFETY_CRITICAL).toBe('safety-critical');
    expect(RISK_TIERS.HIGH_RISK).toBe('high-risk');
  });
});

describe('SAFETY_CRITICAL_TEST_PATTERNS', () => {
  it('should include red-flag patterns', () => {
    const hasRedFlag = SAFETY_CRITICAL_TEST_PATTERNS.some(
      (p) => p.includes('red-flag') || p.includes('redflag')
    );
    assert.ok(hasRedFlag, 'Should include red-flag test patterns');
  });

  it('should include PHI patterns', () => {
    const hasPhi = SAFETY_CRITICAL_TEST_PATTERNS.some(
      (p) => p.toLowerCase().includes('phi')
    );
    assert.ok(hasPhi, 'Should include PHI test patterns');
  });

  it('should include escalation patterns', () => {
    const hasEscalation = SAFETY_CRITICAL_TEST_PATTERNS.some(
      (p) => p.includes('escalation')
    );
    assert.ok(hasEscalation, 'Should include escalation test patterns');
  });

  it('should include privacy patterns', () => {
    const hasPrivacy = SAFETY_CRITICAL_TEST_PATTERNS.some(
      (p) => p.includes('privacy')
    );
    assert.ok(hasPrivacy, 'Should include privacy test patterns');
  });

  it('should include constitutional enforcer patterns', () => {
    const hasConstitutional = SAFETY_CRITICAL_TEST_PATTERNS.some(
      (p) => p.includes('constitutional')
    );
    assert.ok(hasConstitutional, 'Should include constitutional enforcer test patterns');
  });
});

describe('HIGH_RISK_PATH_PATTERNS', () => {
  it('should include auth paths', () => {
    const hasAuth = HIGH_RISK_PATH_PATTERNS.some(
      (p) => p.includes('auth')
    );
    assert.ok(hasAuth, 'Should include auth path patterns');
  });

  it('should include PHI paths', () => {
    const hasPhi = HIGH_RISK_PATH_PATTERNS.some(
      (p) => p.toLowerCase().includes('phi')
    );
    assert.ok(hasPhi, 'Should include PHI path patterns');
  });

  it('should avoid generic migration path patterns', () => {
    const hasGenericMigration = HIGH_RISK_PATH_PATTERNS.some(
      (p) => p.includes('/migrations/')
    );
    expect(hasGenericMigration).toBe(false);
  });

  it('should include RLS paths', () => {
    const hasRls = HIGH_RISK_PATH_PATTERNS.some(
      (p) => p.toLowerCase().includes('rls')
    );
    assert.ok(hasRls, 'Should include RLS path patterns');
  });
});

describe('isSafetyCriticalTest', () => {
  it('should identify red-flag tests', () => {
    expect(isSafetyCriticalTest('src/lib/__tests__/red-flag.test.ts')).toBe(true);
    expect(isSafetyCriticalTest('src/components/__tests__/RedFlagAlert.test.tsx')).toBe(true);
  });

  it('should identify PHI tests', () => {
    expect(isSafetyCriticalTest('src/lib/phi/__tests__/patterns.test.ts')).toBe(true);
    expect(isSafetyCriticalTest('src/components/ui/__tests__/PHIGuard.test.tsx')).toBe(true);
    expect(isSafetyCriticalTest('src/components/ui/__tests__/Composer.phi.test.tsx')).toBe(true);
  });

  it('should identify escalation tests', () => {
    expect(isSafetyCriticalTest('src/lib/llm/__tests__/escalationTrigger.test.ts')).toBe(true);
    expect(isSafetyCriticalTest('src/components/escalation/__tests__/EscalationHistory.test.tsx')).toBe(true);
  });

  it('should identify privacy detector tests', () => {
    expect(isSafetyCriticalTest('src/lib/llm/__tests__/privacyDetector.test.ts')).toBe(true);
    expect(isSafetyCriticalTest('src/lib/llm/__tests__/privacyDetector.golden.test.ts')).toBe(true);
  });

  it('should identify constitutional enforcer tests', () => {
    expect(isSafetyCriticalTest('src/lib/llm/__tests__/constitutionalEnforcer.test.ts')).toBe(true);
  });

  it('should identify safe prompt wrapper tests', () => {
    expect(isSafetyCriticalTest('src/lib/llm/__tests__/safePromptWrapper.test.ts')).toBe(true);
  });

  it('should return false for non-safety-critical tests', () => {
    expect(isSafetyCriticalTest('src/lib/__tests__/utils.test.ts')).toBe(false);
    expect(isSafetyCriticalTest('src/components/__tests__/Button.test.tsx')).toBe(false);
    expect(isSafetyCriticalTest('src/lib/llm/__tests__/orchestrator.test.ts')).toBe(false);
  });
});

describe('isHighRiskPath', () => {
  it('should identify auth paths', () => {
    expect(isHighRiskPath('src/lib/auth/getUser.ts')).toBe(true);
    expect(isHighRiskPath('src/lib/auth/__tests__/getUser.test.ts')).toBe(true);
    expect(isHighRiskPath('apps/web/src/lib/auth/session.ts')).toBe(true);
  });

  it('should identify PHI paths', () => {
    expect(isHighRiskPath('src/lib/phi/patterns.ts')).toBe(true);
    expect(isHighRiskPath('packages/@exampleapp/infrastructure/src/phi/detector.ts')).toBe(true);
  });

  it('should not treat migrations as high-risk by path alone', () => {
    expect(isHighRiskPath('supabase/supabase/migrations/20240101_init.sql')).toBe(false);
    expect(isHighRiskPath('supabase/supabase/migrations/20240102_add_rls.sql')).toBe(false);
  });

  it('should identify RLS paths', () => {
    expect(isHighRiskPath('supabase/rls/policies.sql')).toBe(true);
    expect(isHighRiskPath('src/lib/rls/helpers.ts')).toBe(true);
  });

  it('should identify policy paths', () => {
    expect(isHighRiskPath('src/lib/policy/engine.ts')).toBe(true);
    expect(isHighRiskPath('apps/web/src/lib/policy/referee.ts')).toBe(true);
  });

  it('should return false for non-high-risk paths', () => {
    expect(isHighRiskPath('src/lib/utils.ts')).toBe(false);
    expect(isHighRiskPath('src/components/Button.tsx')).toBe(false);
    expect(isHighRiskPath('tools/lib/gates.js')).toBe(false);
  });
});

describe('isHighRiskMigration', () => {
  it('should detect policy and RLS keywords in migration filenames', () => {
    assert.equal(
      isHighRiskMigration('supabase/supabase/migrations/20240101_policy.sql'),
      true
    );
    assert.equal(
      isHighRiskMigration('supabase/supabase/migrations/20240102_enable_rls.sql'),
      true
    );
    assert.equal(
      isHighRiskMigration('supabase/supabase/migrations/20240103_row_level_security.sql'),
      true
    );
  });

  it('should return false for schema-only migration filenames', () => {
    assert.equal(
      isHighRiskMigration('supabase/supabase/migrations/20240101_init_core.sql'),
      false
    );
  });

  it('should return false for non-migration paths', () => {
    expect(isHighRiskMigration('supabase/supabase/tests/001-rls.sql')).toBe(false);
  });
});

describe('detectRiskTier', () => {
  describe('docs-only tier', () => {
    it('should detect docs-only when all files are markdown', () => {
      const changedFiles = ['README.md', 'docs/guide.md', 'CLAUDE.md'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.DOCS_ONLY);
    });

    it('should detect docs-only when all files are in docs/ directory', () => {
      const changedFiles = [
        'docs/04-operations/tasks/wu/WU-2062.yaml',
        'docs/README.md',
      ];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.DOCS_ONLY);
    });

    it('should detect docs-only for ai/ directory changes', () => {
      const changedFiles = ['ai/onboarding/guide.md', 'ai/prompts/safety.txt'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.DOCS_ONLY);
    });

    it('should detect docs-only for .claude/ directory changes', () => {
      const changedFiles = ['.claude/skills/SKILL.md', '.claude/rules/git-safety.md'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.DOCS_ONLY);
    });
  });

  describe('high-risk tier', () => {
    it('should detect high-risk when auth files are changed', () => {
      const changedFiles = ['src/lib/auth/getUser.ts', 'src/lib/utils.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.HIGH_RISK);
      expect(result.highRiskPaths.length > 0).toBeTruthy();
    });

    it('should detect high-risk when PHI files are changed', () => {
      const changedFiles = ['src/lib/phi/detector.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.HIGH_RISK);
    });

    it('should detect high-risk when migrations include policy keywords', () => {
      const changedFiles = ['supabase/supabase/migrations/20240101_policy.sql'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.HIGH_RISK);
    });

    it('should keep schema-only migrations in the standard tier', () => {
      const changedFiles = ['supabase/supabase/migrations/20240101_init.sql'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.STANDARD);
    });

    it('should detect high-risk when RLS files are changed', () => {
      const changedFiles = ['src/lib/rls/policies.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.HIGH_RISK);
    });
  });

  describe('standard tier', () => {
    it('should detect standard for regular code changes', () => {
      const changedFiles = ['src/lib/utils.ts', 'src/components/Button.tsx'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.STANDARD);
    });

    it('should detect standard when code and docs are mixed but no high-risk', () => {
      const changedFiles = ['src/lib/utils.ts', 'docs/guide.md'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.STANDARD);
    });
  });

  describe('safety-critical detection', () => {
    it('should always include safety-critical test patterns regardless of tier', () => {
      const changedFiles = ['src/lib/utils.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(Array.isArray(result.safetyCriticalPatterns)).toBeTruthy();
      expect(result.safetyCriticalPatterns.length > 0).toBeTruthy();
    });

    it('should include the safety-critical patterns for filtering tests', () => {
      const result = detectRiskTier({ changedFiles: ['src/lib/utils.ts'] });
      // Should have patterns that can be used to filter tests
      expect(result.safetyCriticalPatterns.some((p) => p.includes('phi') || p.includes('PHI'))).toBeTruthy();
      expect(result.safetyCriticalPatterns.some((p) => p.includes('escalation'))).toBeTruthy();
    });
  });

  describe('result structure', () => {
    it('should return complete result object', () => {
      const changedFiles = ['src/lib/auth/getUser.ts'];
      const result = detectRiskTier({ changedFiles });

      expect('tier' in result).toBeTruthy();
      expect('safetyCriticalPatterns' in result).toBeTruthy();
      expect('highRiskPaths' in result).toBeTruthy();
      expect('isDocsOnly' in result).toBeTruthy();
      expect('shouldRunIntegration' in result).toBeTruthy();
    });

    it('should set shouldRunIntegration true for high-risk tier', () => {
      const changedFiles = ['src/lib/auth/getUser.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.shouldRunIntegration).toBe(true);
    });

    it('should set shouldRunIntegration false for standard tier', () => {
      const changedFiles = ['src/lib/utils.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.shouldRunIntegration).toBe(false);
    });

    it('should set isDocsOnly true for docs-only tier', () => {
      const changedFiles = ['docs/guide.md'];
      const result = detectRiskTier({ changedFiles });
      expect(result.isDocsOnly).toBe(true);
    });

    it('should set isDocsOnly false for code changes', () => {
      const changedFiles = ['src/lib/utils.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.isDocsOnly).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty file list as docs-only', () => {
      const result = detectRiskTier({ changedFiles: [] });
      expect(result.tier).toBe(RISK_TIERS.DOCS_ONLY);
    });

    it('should handle undefined changedFiles as docs-only', () => {
      const result = detectRiskTier({});
      expect(result.tier).toBe(RISK_TIERS.DOCS_ONLY);
    });

    it('should normalise Windows paths', () => {
      const changedFiles = ['src\\lib\\auth\\getUser.ts'];
      const result = detectRiskTier({ changedFiles });
      expect(result.tier).toBe(RISK_TIERS.HIGH_RISK);
    });
  });
});
