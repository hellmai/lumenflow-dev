/**
 * Generate Traceability Tests (WU-2035)
 *
 * Tests for traceability documentation generation from:
 * - Hazard log parsing
 * - Prompt version extraction
 * - Git history analysis
 * - Cross-reference validation
 *
 * @see {@link tools/lib/generate-traceability.mjs} - Implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Functions to be implemented
import {
  parseHazardLog,
  extractPromptVersions,
  buildCrossReferences,
  generateVersionHistory,
  generatePromptInventory,
  generateHazardMatrix,
  generateValidationReport,
  validateCrossReferences,
} from '../generate-traceability.js';

describe('generate-traceability', () => {
  describe('parseHazardLog', () => {
    it('should parse hazard definitions from markdown', () => {
      const content = `
# Hazard Log

### HAZ-001: Test Hazard

| Field | Value |
| **Hazard ID** | HAZ-001 |
| **Initial Severity** | 4 |
| **Initial Likelihood** | 3 |
| **Initial Risk Score** | 12 |

**Controls:**

| Control ID | Control Description | Type | Status |
| C-001a | First control | Preventive | Implemented |
| C-001b | Second control | Detective | Planned |

**Residual Assessment:**

| Field | Value |
| Residual Severity | 3 |
| Residual Likelihood | 2 |
| Residual Risk Score | 6 |
| Acceptability | Tolerable (ALARP) |
`;

      const hazards = parseHazardLog(content);

      expect(hazards.length).toBe(1);
      expect(hazards[0].id).toBe('HAZ-001');
      expect(hazards[0].severity).toBe(4);
      expect(hazards[0].likelihood).toBe(3);
      expect(hazards[0].riskScore).toBe(12);
      expect(hazards[0].residualRiskScore).toBe(6);
      expect(hazards[0].controls.length).toBe(2);
      expect(hazards[0].controls[0].id).toBe('C-001a');
      expect(hazards[0].controls[0].status).toBe('Implemented');
    });

    it('should parse multiple hazards', () => {
      const content = `
### HAZ-001: First Hazard

| Field | Value |
| **Hazard ID** | HAZ-001 |
| **Initial Severity** | 5 |
| **Initial Likelihood** | 2 |
| **Initial Risk Score** | 10 |

| Control ID | Control Description | Type | Status |
| C-001a | Control A | Preventive | Implemented |

| Residual Risk Score | 5 |
| Acceptability | Medium |

---

### HAZ-002: Second Hazard

| Field | Value |
| **Hazard ID** | HAZ-002 |
| **Initial Severity** | 3 |
| **Initial Likelihood** | 3 |
| **Initial Risk Score** | 9 |

| Control ID | Control Description | Type | Status |
| C-002a | Control B | Detective | Implemented |

| Residual Risk Score | 4 |
| Acceptability | Low |
`;

      const hazards = parseHazardLog(content);

      expect(hazards.length).toBe(2);
      expect(hazards[0].id).toBe('HAZ-001');
      expect(hazards[1].id).toBe('HAZ-002');
    });

    it('should return empty array for invalid content', () => {
      const hazards = parseHazardLog('No hazards here');
      expect(hazards).toEqual([]);
    });
  });

  describe('extractPromptVersions', () => {
    it('should extract version from prompt YAML content', () => {
      const prompts = [
        {
          path: 'apps/web/src/lib/prompts/system-base.yaml',
          content: "version: '1.32.0'\ncontent: |\n  Prompt content here",
        },
        {
          path: 'apps/web/src/lib/prompts/red-flag-detection.yaml',
          content: "version: '1.0.0'\ncontent: |\n  Safety content",
        },
      ];

      const versions = extractPromptVersions(prompts);

      expect(versions.length).toBe(2);
      // Results are sorted by filename
      expect(versions[0].version).toBe('1.0.0');
      expect(versions[0].fileName).toBe('red-flag-detection.yaml');
      expect(versions[1].version).toBe('1.32.0');
      expect(versions[1].fileName).toBe('system-base.yaml');
    });

    it('should skip prompts without version field', () => {
      const prompts = [
        {
          path: 'test.yaml',
          content: 'content: |\n  No version here',
        },
      ];

      const versions = extractPromptVersions(prompts);
      expect(versions.length).toBe(0);
    });

    it('should handle invalid YAML gracefully', () => {
      const prompts = [
        {
          path: 'invalid.yaml',
          content: 'not: valid: yaml: content',
        },
      ];

      const versions = extractPromptVersions(prompts);
      expect(versions.length).toBe(0);
    });
  });

  describe('buildCrossReferences', () => {
    it('should link hazards to controls', () => {
      const hazards = [
        {
          id: 'HAZ-001',
          controls: [{ id: 'C-001a' }, { id: 'C-001b' }],
        },
      ];

      const refs = buildCrossReferences(hazards, [], []);

      const hazardToControl = refs.filter((r) => r.type === 'hazard_to_control');
      expect(hazardToControl.length).toBe(2);
      expect(hazardToControl[0].source).toBe('HAZ-001');
      expect(hazardToControl[0].target).toBe('C-001a');
    });

    it('should track control coverage in tests', () => {
      const hazards = [
        {
          id: 'HAZ-001',
          controls: [{ id: 'C-001a' }],
        },
      ];

      const goldenTests = [{ file: 'test.yaml', mentionsControls: ['C-001a'] }];

      const refs = buildCrossReferences(hazards, [], goldenTests);

      const controlToTest = refs.filter((r) => r.type === 'control_to_test');
      expect(controlToTest.length > 0).toBeTruthy();
      expect(controlToTest[0].valid).toBe(true);
    });

    it('should mark uncovered controls as invalid', () => {
      const hazards = [
        {
          id: 'HAZ-001',
          controls: [{ id: 'C-001a' }],
        },
      ];

      const refs = buildCrossReferences(hazards, [], []);

      const controlToTest = refs.filter((r) => r.type === 'control_to_test');
      expect(controlToTest.some((r) => r.valid === false)).toBeTruthy();
    });
  });

  describe('generateVersionHistory', () => {
    it('should create markdown table from git commits', () => {
      const commits = [
        {
          hash: 'abc1234567890',
          date: '2025-01-15',
          author: 'Developer',
          message: 'feat(prompts): update safety rules',
          files: ['system-base.yaml'],
        },
      ];

      const markdown = generateVersionHistory(commits);

      expect(markdown).toContain('# Prompt Version History');
      expect(markdown).toContain('2025-01-15');
      expect(markdown).toContain('abc1234');
      expect(markdown).toContain('Developer');
      expect(markdown).toContain('update safety rules');
    });

    it('should group commits by month', () => {
      const commits = [
        { hash: 'a1', date: '2025-01-15', author: 'A', message: 'msg1', files: [] },
        { hash: 'a2', date: '2025-01-20', author: 'B', message: 'msg2', files: [] },
        { hash: 'a3', date: '2025-02-10', author: 'C', message: 'msg3', files: [] },
      ];

      const markdown = generateVersionHistory(commits);

      expect(markdown).toContain('2025-01');
      expect(markdown).toContain('2025-02');
    });

    it('should handle empty commit list', () => {
      const markdown = generateVersionHistory([]);
      expect(markdown).toContain('# Prompt Version History');
    });
  });

  describe('generatePromptInventory', () => {
    it('should list all prompts with versions', () => {
      const prompts = [
        {
          fileName: 'system-base.yaml',
          version: '1.32.0',
          relativePath: 'apps/web/src/lib/prompts/system-base.yaml',
        },
        {
          fileName: 'red-flag-detection.yaml',
          version: '1.0.0',
          relativePath: 'apps/web/src/lib/prompts/red-flag-detection.yaml',
        },
      ];

      const markdown = generatePromptInventory(prompts);

      expect(markdown).toContain('# Prompt Inventory');
      expect(markdown).toContain('system-base.yaml');
      expect(markdown).toContain('1.32.0');
      expect(markdown).toContain('red-flag-detection.yaml');
    });

    it('should summarise version distribution', () => {
      const prompts = [
        { fileName: 'a.yaml', version: '1.0.0', relativePath: 'a.yaml' },
        { fileName: 'b.yaml', version: '1.5.0', relativePath: 'b.yaml' },
        { fileName: 'c.yaml', version: '2.0.0', relativePath: 'c.yaml' },
      ];

      const markdown = generatePromptInventory(prompts);

      expect(markdown).toContain('Total Prompts');
      expect(markdown).toContain('3');
    });
  });

  describe('generateHazardMatrix', () => {
    it('should create traceability matrix from hazards', () => {
      const hazards = [
        {
          id: 'HAZ-001',
          title: 'Test Hazard',
          riskScore: 12,
          residualRiskScore: 6,
          acceptability: 'Tolerable',
          controls: [
            { id: 'C-001a', description: 'Control 1', type: 'Preventive', status: 'Implemented' },
          ],
        },
      ];

      const markdown = generateHazardMatrix(hazards);

      expect(markdown).toContain('# Hazard Traceability Matrix');
      expect(markdown).toContain('HAZ-001');
      expect(markdown).toContain('C-001a');
      expect(markdown).toContain('Preventive');
    });

    it('should summarise risk distribution', () => {
      const hazards = [
        {
          id: 'HAZ-001',
          acceptability: 'Acceptable',
          riskScore: 2,
          residualRiskScore: 2,
          controls: [],
        },
        {
          id: 'HAZ-002',
          acceptability: 'Medium',
          riskScore: 8,
          residualRiskScore: 6,
          controls: [],
        },
      ];

      const markdown = generateHazardMatrix(hazards);

      expect(markdown).toContain('Risk Distribution');
    });
  });

  describe('generateValidationReport', () => {
    it('should report valid cross-references', () => {
      const refs = [
        { source: 'HAZ-001', target: 'C-001a', type: 'hazard_to_control', valid: true },
        { source: 'C-001a', target: 'golden-tests', type: 'control_to_test', valid: true },
      ];

      const markdown = generateValidationReport(refs);

      expect(markdown).toContain('# Traceability Validation Report');
      expect(markdown).toContain('Valid');
      expect(markdown).toContain('100');
    });

    it('should list invalid references', () => {
      const refs = [
        { source: 'HAZ-001', target: 'C-001a', type: 'hazard_to_control', valid: true },
        {
          source: 'C-001a',
          target: 'golden-tests',
          type: 'control_to_test',
          valid: false,
          error: 'No coverage',
        },
      ];

      const markdown = generateValidationReport(refs);

      expect(markdown).toContain('Issues Found');
      expect(markdown).toContain('No coverage');
    });
  });

  describe('validateCrossReferences', () => {
    it('should return true when all references valid', () => {
      const refs = [{ valid: true }, { valid: true }];

      const result = validateCrossReferences(refs);
      expect(result.valid).toBe(true);
      expect(result.invalidCount).toBe(0);
    });

    it('should return false when any reference invalid', () => {
      const refs = [{ valid: true }, { valid: false, error: 'Missing coverage' }];

      const result = validateCrossReferences(refs);
      expect(result.valid).toBe(false);
      expect(result.invalidCount).toBe(1);
    });

    it('should collect all errors', () => {
      const refs = [
        { valid: false, error: 'Error 1' },
        { valid: false, error: 'Error 2' },
      ];

      const result = validateCrossReferences(refs);
      expect(result.errors.length).toBe(2);
    });
  });
});
