/**
 * WU Spawn Skills Tests
 *
 * WU-1900: Tests for classifier-driven skill suggestion, covering:
 * - generateSkillsSelectionSection uses classifyWork output to suggest skills
 *   via capability-to-skill mapping from client config
 * - Regression: non-UI brief generation unchanged
 *
 * @module wu-spawn-skills.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateSkillsSelectionSection,
  generateClientSkillsGuidance,
  resolveClientConfig,
  getByLaneSkills,
} from '../wu-spawn-skills.js';

// Minimal WU doc for skills tests
interface MinimalDoc {
  lane?: string;
  type?: string;
  code_paths?: string[];
  description?: string;
}

describe('generateSkillsSelectionSection', () => {
  describe('WU-1900: classifier-driven skill suggestions', () => {
    it('suggests frontend-design skill for UI-classified work via capabilities_map', () => {
      const doc: MinimalDoc = {
        lane: 'Framework: Core',
        type: 'bug',
        code_paths: ['src/components/Button.tsx'],
        description: 'Fix button styling',
      };
      const config = {
        agents: {
          clients: {
            'claude-code': {
              skills: {
                recommended: ['wu-lifecycle'],
              },
              capabilities_map: {
                'ui-design-awareness': 'frontend-design',
                'component-reuse-check': 'library-first',
              },
            },
          },
        },
      };

      const result = generateSkillsSelectionSection(doc, config, 'claude-code');

      // Should suggest frontend-design because code_paths match UI domain
      // and capabilities_map maps ui-design-awareness -> frontend-design
      expect(result).toContain('frontend-design');
    });

    it('suggests library-first skill for UI-classified work via capabilities_map', () => {
      const doc: MinimalDoc = {
        lane: 'Experience: Frontend',
        type: 'feature',
        code_paths: ['src/components/Header.tsx'],
      };
      const config = {
        agents: {
          clients: {
            'claude-code': {
              capabilities_map: {
                'ui-design-awareness': 'frontend-design',
                'component-reuse-check': 'library-first',
              },
            },
          },
        },
      };

      const result = generateSkillsSelectionSection(doc, config, 'claude-code');

      expect(result).toContain('library-first');
    });

    it('does NOT suggest UI skills for backend-classified work in soft policy', () => {
      const doc: MinimalDoc = {
        lane: 'Framework: Core',
        type: 'feature',
        code_paths: ['packages/@lumenflow/core/src/utils.ts'],
      };
      const config = {
        agents: {
          clients: {
            'claude-code': {
              capabilities_map: {
                'ui-design-awareness': 'frontend-design',
                'component-reuse-check': 'library-first',
              },
            },
          },
        },
      };

      const result = generateSkillsSelectionSection(doc, config, 'claude-code');

      // Backend work should NOT get capability-mapped frontend-design in soft policy.
      // Note: 'frontend-design' still appears in the static Additional Skills table,
      // so we check the Soft Policy section specifically.
      const softPolicySection = result.split('### Soft Policy')[1]?.split('### Additional Skills')[0] ?? '';
      expect(softPolicySection).not.toContain('Suggested by work classifier');
      expect(softPolicySection).not.toContain('`frontend-design`');
      expect(softPolicySection).not.toContain('`library-first`');
    });

    it('still includes standard skills (wu-lifecycle, worktree-discipline) for all WUs', () => {
      const doc: MinimalDoc = {
        lane: 'Framework: Core',
        type: 'feature',
        code_paths: ['packages/@lumenflow/core/src/utils.ts'],
      };
      const config = {};

      const result = generateSkillsSelectionSection(doc, config, 'claude-code');

      expect(result).toContain('wu-lifecycle');
      expect(result).toContain('worktree-discipline');
    });

    it('works without capabilities_map configured (graceful degradation)', () => {
      const doc: MinimalDoc = {
        lane: 'Experience: Frontend',
        type: 'feature',
        code_paths: ['src/components/Button.tsx'],
      };
      const config = {
        agents: {
          clients: {
            'claude-code': {
              skills: {
                recommended: ['wu-lifecycle'],
              },
            },
          },
        },
      };

      // Should not throw, should just not suggest capabilities-based skills
      const result = generateSkillsSelectionSection(doc, config, 'claude-code');

      expect(result).toBeDefined();
      expect(result).toContain('wu-lifecycle');
    });

    it('does not suggest skills for capabilities not in the map', () => {
      const doc: MinimalDoc = {
        lane: 'Content: Documentation',
        type: 'documentation',
        code_paths: ['docs/guide.md'],
      };
      const config = {
        agents: {
          clients: {
            'claude-code': {
              capabilities_map: {
                'ui-design-awareness': 'frontend-design',
              },
            },
          },
        },
      };

      const result = generateSkillsSelectionSection(doc, config, 'claude-code');

      // Docs domain has documentation-structure capability, not ui-design-awareness.
      // 'frontend-design' still appears in the static Additional Skills table,
      // so we check the Soft Policy section specifically for classifier suggestions.
      const softPolicySection = result.split('### Soft Policy')[1]?.split('### Additional Skills')[0] ?? '';
      expect(softPolicySection).not.toContain('Suggested by work classifier');
      expect(softPolicySection).not.toContain('`frontend-design`');
    });
  });

  describe('regression: existing behavior preserved', () => {
    it('includes tdd-workflow hint for feature type', () => {
      const doc: MinimalDoc = {
        lane: 'Framework: Core',
        type: 'feature',
      };
      const config = {};

      const result = generateSkillsSelectionSection(doc, config, undefined);

      expect(result).toContain('tdd-workflow');
    });

    it('includes bug-classification hint for bug type', () => {
      const doc: MinimalDoc = {
        lane: 'Framework: Core',
        type: 'bug',
      };
      const config = {};

      const result = generateSkillsSelectionSection(doc, config, undefined);

      expect(result).toContain('bug-classification');
    });

    it('includes lumenflow-gates for Operations: Tooling lane', () => {
      const doc: MinimalDoc = {
        lane: 'Operations: Tooling',
        type: 'feature',
      };
      const config = {};

      const result = generateSkillsSelectionSection(doc, config, undefined);

      expect(result).toContain('lumenflow-gates');
    });
  });
});
