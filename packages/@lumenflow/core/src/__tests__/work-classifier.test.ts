// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Work Classifier Tests
 *
 * WU-1899: Signal-based work classifier for code-path-aware
 * UI/backend/docs detection.
 *
 * Tests cover:
 * - Pure code_paths detection (CSS, SCSS, LESS, components, pages, etc.)
 * - Pure lane detection (lane hints like "Experience", "Frontend")
 * - Mixed signals (code_paths + lane)
 * - No-match fallback (returns 'backend' domain)
 * - Config overrides (custom patterns extend defaults)
 * - Confidence boundaries (>= 0.3 threshold, >= 0.5 for smoke-test hint)
 * - Return shape validation (domain, confidence, signals, capabilities, testMethodologyHint)
 */

import { describe, it, expect } from 'vitest';
import {
  classifyWork,
  type WorkClassification,
  type WorkClassificationConfig,
  WORK_DOMAINS,
  SIGNAL_WEIGHTS,
  DEFAULT_UI_CODE_PATH_PATTERNS,
  DEFAULT_UI_LANE_HINTS,
} from '../work-classifier.js';

// Minimal WU doc shape matching what classifyWork needs
interface MinimalWuDoc {
  code_paths?: string[];
  lane?: string;
  type?: string;
  description?: string;
}

describe('classifyWork', () => {
  describe('return shape', () => {
    it('returns domain, confidence, signals, capabilities, and testMethodologyHint', () => {
      const doc: MinimalWuDoc = { code_paths: ['packages/core/src/utils.ts'] };
      const result = classifyWork(doc);

      expect(result).toHaveProperty('domain');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('signals');
      expect(result).toHaveProperty('capabilities');
      expect(result).toHaveProperty('testMethodologyHint');
      expect(typeof result.domain).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.signals)).toBe(true);
      expect(Array.isArray(result.capabilities)).toBe(true);
    });
  });

  describe('pure code_paths detection', () => {
    it('detects CSS files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['apps/web/src/styles/main.css'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.signals).toContainEqual(
        expect.objectContaining({ source: 'code_paths', weight: SIGNAL_WEIGHTS.CODE_PATHS }),
      );
    });

    it('detects SCSS files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['apps/web/src/styles/theme.scss'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects LESS files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['apps/web/src/styles/variables.less'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects components directory as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.tsx'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects pages directory as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/pages/Home.tsx'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects app page files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['app/dashboard/page.tsx'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects app layout files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['app/layout.tsx'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects module CSS files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.module.css'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects styled-components files as ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.styled.ts'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects CSS code_paths regardless of lane name', () => {
      const doc: MinimalWuDoc = {
        code_paths: ['apps/web/src/styles/main.css'],
        lane: 'Framework: Core',
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects docs paths as docs domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['docs/getting-started.md'] };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.DOCS);
    });
  });

  describe('pure lane detection', () => {
    it('detects Experience lane as ui domain', () => {
      const doc: MinimalWuDoc = {
        lane: 'Experience: Frontend',
        code_paths: [],
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
      expect(result.confidence).toBe(SIGNAL_WEIGHTS.LANE);
      expect(result.signals).toContainEqual(
        expect.objectContaining({ source: 'lane', weight: SIGNAL_WEIGHTS.LANE }),
      );
    });

    it('detects Frontend lane hint as ui domain', () => {
      const doc: MinimalWuDoc = {
        lane: 'Product: Frontend',
        code_paths: [],
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('detects Content: Documentation lane as docs domain', () => {
      const doc: MinimalWuDoc = {
        lane: 'Content: Documentation',
        code_paths: [],
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.DOCS);
    });

    it('detects Operations: Infrastructure lane as infra domain', () => {
      const doc: MinimalWuDoc = {
        lane: 'Operations: Infrastructure',
        code_paths: [],
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.INFRA);
    });
  });

  describe('mixed signals', () => {
    it('code_paths signal wins over lane hint when both match ui', () => {
      const doc: MinimalWuDoc = {
        code_paths: ['src/components/Header.tsx'],
        lane: 'Experience: Frontend',
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
      // code_paths weight is highest
      expect(result.confidence).toBe(SIGNAL_WEIGHTS.CODE_PATHS);
    });

    it('code_paths signal (ui) takes precedence over lane (backend)', () => {
      const doc: MinimalWuDoc = {
        code_paths: ['src/components/Header.tsx'],
        lane: 'Framework: Core',
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
      expect(result.confidence).toBe(SIGNAL_WEIGHTS.CODE_PATHS);
    });

    it('returns mixed domain when code_paths match multiple domain patterns', () => {
      const doc: MinimalWuDoc = {
        code_paths: ['src/components/Header.tsx', 'docs/getting-started.md'],
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.MIXED);
    });

    it('description keywords provide weak signal for ui', () => {
      const doc: MinimalWuDoc = {
        description: 'Add responsive CSS grid layout for dashboard',
        code_paths: [],
      };
      const result = classifyWork(doc);

      // Description weight is 0.2, which is below the 0.3 threshold
      // So domain should fall back to backend
      expect(result.domain).toBe(WORK_DOMAINS.BACKEND);
    });

    it('type signal provides weak signal for docs', () => {
      const doc: MinimalWuDoc = {
        type: 'documentation',
        code_paths: [],
      };
      const result = classifyWork(doc);

      // type weight is 0.3, exactly at threshold
      expect(result.domain).toBe(WORK_DOMAINS.DOCS);
    });
  });

  describe('no-match fallback', () => {
    it('returns backend domain when no signals match', () => {
      const doc: MinimalWuDoc = {
        code_paths: ['packages/core/src/utils.ts'],
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.BACKEND);
      expect(result.confidence).toBe(0);
      expect(result.signals).toEqual([]);
    });

    it('returns backend domain for empty doc', () => {
      const result = classifyWork({});

      expect(result.domain).toBe(WORK_DOMAINS.BACKEND);
      expect(result.confidence).toBe(0);
    });

    it('returns backend domain for undefined code_paths', () => {
      const doc: MinimalWuDoc = { code_paths: undefined };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.BACKEND);
    });
  });

  describe('confidence boundaries', () => {
    it('does not assign domain when combined signal weight < 0.3', () => {
      // description keyword alone has weight 0.2 < 0.3 threshold
      const doc: MinimalWuDoc = {
        description: 'Update the CSS styling of the button',
        code_paths: ['packages/core/src/something.ts'],
      };
      const result = classifyWork(doc);

      // The description signal matches UI (0.2), but code_paths don't match UI
      // So the UI confidence is 0.2 < 0.3, falls back to backend
      expect(result.domain).toBe(WORK_DOMAINS.BACKEND);
    });

    it('assigns domain when signal weight >= 0.3 (type = documentation)', () => {
      const doc: MinimalWuDoc = {
        type: 'documentation',
        code_paths: [],
      };
      const result = classifyWork(doc);

      // type weight 0.3 >= 0.3 threshold
      expect(result.domain).toBe(WORK_DOMAINS.DOCS);
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });

    it('assigns domain when signal weight >= 0.3 (lane hint)', () => {
      const doc: MinimalWuDoc = {
        lane: 'Experience: Frontend',
        code_paths: [],
      };
      const result = classifyWork(doc);

      // lane weight 0.6 >= 0.3 threshold
      expect(result.domain).toBe(WORK_DOMAINS.UI);
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });
  });

  describe('capabilities', () => {
    it('returns ui-design-awareness capability for ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.tsx'] };
      const result = classifyWork(doc);

      expect(result.capabilities).toContain('ui-design-awareness');
    });

    it('returns component-reuse-check capability for ui domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.tsx'] };
      const result = classifyWork(doc);

      expect(result.capabilities).toContain('component-reuse-check');
    });

    it('does NOT return client skill names like frontend-design', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.tsx'] };
      const result = classifyWork(doc);

      // Capabilities must be abstract, not client-specific skill names
      expect(result.capabilities).not.toContain('frontend-design');
    });

    it('returns empty capabilities for backend domain', () => {
      const doc: MinimalWuDoc = { code_paths: ['packages/core/src/utils.ts'] };
      const result = classifyWork(doc);

      expect(result.capabilities).toEqual([]);
    });
  });

  describe('testMethodologyHint', () => {
    it('returns smoke-test hint when domain is ui with confidence >= 0.5', () => {
      const doc: MinimalWuDoc = {
        code_paths: ['src/components/Button.tsx'],
        lane: 'Experience: Frontend',
      };
      const result = classifyWork(doc);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.testMethodologyHint).toBe('smoke-test');
    });

    it('returns smoke-test for code_paths ui detection (weight 1.0 >= 0.5)', () => {
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.tsx'] };
      const result = classifyWork(doc);

      expect(result.testMethodologyHint).toBe('smoke-test');
    });

    it('does not return smoke-test when domain is not ui', () => {
      const doc: MinimalWuDoc = { code_paths: ['packages/core/src/utils.ts'] };
      const result = classifyWork(doc);

      expect(result.testMethodologyHint).toBeUndefined();
    });

    it('does not return smoke-test when ui confidence < 0.5', () => {
      // type 'feature' with description that matches UI keywords
      // description weight is 0.2 and type weight is 0.3
      // Neither alone reaches 0.5 for UI
      const doc: MinimalWuDoc = {
        type: 'feature',
        description: 'Add a CSS grid layout',
        code_paths: [],
      };
      const result = classifyWork(doc);

      // Even if domain ended up as something, the UI confidence would be at most 0.2
      expect(result.testMethodologyHint).toBeUndefined();
    });
  });

  describe('config overrides', () => {
    it('extends default ui patterns with custom code_path_patterns', () => {
      const config: WorkClassificationConfig = {
        ui: {
          code_path_patterns: ['**/widgets/**'],
        },
      };
      const doc: MinimalWuDoc = { code_paths: ['src/widgets/Calendar.tsx'] };
      const result = classifyWork(doc, config);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('still matches default patterns when config adds custom ones', () => {
      const config: WorkClassificationConfig = {
        ui: {
          code_path_patterns: ['**/widgets/**'],
        },
      };
      const doc: MinimalWuDoc = { code_paths: ['src/components/Button.tsx'] };
      const result = classifyWork(doc, config);

      // Default components pattern still works
      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('extends default lane hints with custom lane_hints', () => {
      const config: WorkClassificationConfig = {
        ui: {
          lane_hints: ['Design'],
        },
      };
      const doc: MinimalWuDoc = {
        lane: 'Design: Components',
        code_paths: [],
      };
      const result = classifyWork(doc, config);

      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });

    it('still matches default lane hints when config adds custom ones', () => {
      const config: WorkClassificationConfig = {
        ui: {
          lane_hints: ['Design'],
        },
      };
      const doc: MinimalWuDoc = {
        lane: 'Experience: Frontend',
        code_paths: [],
      };
      const result = classifyWork(doc, config);

      // Default Experience hint still works
      expect(result.domain).toBe(WORK_DOMAINS.UI);
    });
  });

  describe('exported constants', () => {
    it('exports WORK_DOMAINS with expected values', () => {
      expect(WORK_DOMAINS.UI).toBe('ui');
      expect(WORK_DOMAINS.BACKEND).toBe('backend');
      expect(WORK_DOMAINS.DOCS).toBe('docs');
      expect(WORK_DOMAINS.INFRA).toBe('infra');
      expect(WORK_DOMAINS.MIXED).toBe('mixed');
    });

    it('exports SIGNAL_WEIGHTS with expected values', () => {
      expect(SIGNAL_WEIGHTS.CODE_PATHS).toBe(1.0);
      expect(SIGNAL_WEIGHTS.LANE).toBe(0.6);
      expect(SIGNAL_WEIGHTS.TYPE).toBe(0.3);
      expect(SIGNAL_WEIGHTS.DESCRIPTION).toBe(0.2);
    });

    it('exports DEFAULT_UI_CODE_PATH_PATTERNS as a non-empty array', () => {
      expect(Array.isArray(DEFAULT_UI_CODE_PATH_PATTERNS)).toBe(true);
      expect(DEFAULT_UI_CODE_PATH_PATTERNS.length).toBeGreaterThan(0);
    });

    it('exports DEFAULT_UI_LANE_HINTS as a non-empty array', () => {
      expect(Array.isArray(DEFAULT_UI_LANE_HINTS)).toBe(true);
      expect(DEFAULT_UI_LANE_HINTS.length).toBeGreaterThan(0);
    });
  });
});
