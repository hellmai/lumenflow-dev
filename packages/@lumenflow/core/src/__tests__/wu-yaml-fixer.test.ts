/**
 * WU YAML Auto-Fixer Tests
 *
 * Part of WU-1359: Early YAML validation at wu:claim
 *
 * @see {@link tools/lib/wu-yaml-fixer.mjs} - Implementation
 */

import { describe, it, expect } from 'vitest';
import { detectFixableIssues, applyFixes, FIXABLE_ISSUES } from '../wu-yaml-fixer.js';

describe('wu-yaml-fixer', () => {
  describe('date handling', () => {
    it('detects ISO timestamp in created field', () => {
      const doc = {
        id: 'WU-1359',
        created: '2025-12-02T00:00:00.000Z',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
      expect(issues[0].field).toBe('created');
      expect(issues[0].suggested).toBe('2025-12-02');
    });

    it('detects Date object in created field', () => {
      const doc = {
        id: 'WU-1359',
        created: new Date('2025-12-02T00:00:00.000Z'),
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
      expect(issues[0].field).toBe('created');
      expect(issues[0].suggested).toBe('2025-12-02');
    });

    it('no issue for valid YYYY-MM-DD date', () => {
      const doc = {
        id: 'WU-1359',
        created: '2025-12-02',
      };

      const issues = detectFixableIssues(doc);

      // Should not detect any date issues
      const dateIssues = issues.filter((i) => i.type === FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
      expect(dateIssues.length).toBe(0);
    });
  });

  describe('email handling', () => {
    it('detects username without email domain', () => {
      const doc = {
        id: 'WU-1359',
        assigned_to: 'tom',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.USERNAME_NOT_EMAIL);
      expect(issues[0].field).toBe('assigned_to');
      expect(issues[0].suggested).toBe('tom@exampleapp.co.uk');
    });

    it('no issue for valid email', () => {
      const doc = {
        id: 'WU-1359',
        assigned_to: 'tom@exampleapp.co.uk',
      };

      const issues = detectFixableIssues(doc);

      // Should not detect any email issues
      const emailIssues = issues.filter((i) => i.type === FIXABLE_ISSUES.USERNAME_NOT_EMAIL);
      expect(emailIssues.length).toBe(0);
    });
  });

  describe('type alias handling', () => {
    it('detects docs → documentation type alias', () => {
      const doc = {
        id: 'WU-1359',
        type: 'docs',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.TYPE_ALIAS);
      expect(issues[0].field).toBe('type');
      expect(issues[0].suggested).toBe('documentation');
    });

    it('detects feat → feature type alias', () => {
      const doc = {
        id: 'WU-1359',
        type: 'feat',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.TYPE_ALIAS);
      expect(issues[0].field).toBe('type');
      expect(issues[0].suggested).toBe('feature');
    });
  });

  describe('phase handling', () => {
    it('detects phase string → number', () => {
      const doc = {
        id: 'WU-1359',
        phase: '3',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.PHASE_STRING);
      expect(issues[0].field).toBe('phase');
      expect(issues[0].suggested).toBe(3);
    });

    it('no issue for valid phase number', () => {
      const doc = {
        id: 'WU-1359',
        phase: 3,
      };

      const issues = detectFixableIssues(doc);

      // Should not detect any phase issues
      const phaseIssues = issues.filter((i) => i.type === FIXABLE_ISSUES.PHASE_STRING);
      expect(phaseIssues.length).toBe(0);
    });
  });

  describe('priority handling', () => {
    it('detects lowercase priority', () => {
      const doc = {
        id: 'WU-1359',
        priority: 'p1',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(1);
      expect(issues[0].type).toBe(FIXABLE_ISSUES.PRIORITY_LOWERCASE);
      expect(issues[0].field).toBe('priority');
      expect(issues[0].suggested).toBe('P1');
    });
  });

  describe('applyFixes', () => {
    it('modifies doc in place', () => {
      const doc = {
        id: 'WU-1359',
        created: '2025-12-02T00:00:00.000Z',
        assigned_to: 'tom',
        type: 'docs',
        phase: '3',
        priority: 'p1',
      };

      const issues = detectFixableIssues(doc);
      const fixed = applyFixes(doc, issues);

      expect(fixed).toBe(5);
      expect(doc.created).toBe('2025-12-02');
      expect(doc.assigned_to).toBe('tom@exampleapp.co.uk');
      expect(doc.type).toBe('documentation');
      expect(doc.phase).toBe(3);
      expect(doc.priority).toBe('P1');
    });
  });

  describe('edge cases', () => {
    it('no issues detected for clean doc', () => {
      const doc = {
        id: 'WU-1359',
        title: 'Test WU',
        lane: 'Operations: Tooling',
        type: 'feature',
        status: 'ready',
        priority: 'P1',
        created: '2025-12-02',
        description:
          'This is a test description that is long enough to pass validation requirements.',
        acceptance: ['pnpm gates passes'],
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(0);
    });

    it('detects multiple issues at once', () => {
      const doc = {
        id: 'WU-1359',
        created: '2025-12-02T00:00:00.000Z',
        assigned_to: 'tom',
        type: 'docs',
      };

      const issues = detectFixableIssues(doc);

      expect(issues.length).toBe(3);
      const types = issues.map((i) => i.type);
      expect(types).toContain(FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
      expect(types).toContain(FIXABLE_ISSUES.USERNAME_NOT_EMAIL);
      expect(types).toContain(FIXABLE_ISSUES.TYPE_ALIAS);
    });
  });
});
