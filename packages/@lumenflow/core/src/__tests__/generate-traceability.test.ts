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

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

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

      assert.equal(hazards.length, 1);
      assert.equal(hazards[0].id, 'HAZ-001');
      assert.equal(hazards[0].severity, 4);
      assert.equal(hazards[0].likelihood, 3);
      assert.equal(hazards[0].riskScore, 12);
      assert.equal(hazards[0].residualRiskScore, 6);
      assert.equal(hazards[0].controls.length, 2);
      assert.equal(hazards[0].controls[0].id, 'C-001a');
      assert.equal(hazards[0].controls[0].status, 'Implemented');
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

      assert.equal(hazards.length, 2);
      assert.equal(hazards[0].id, 'HAZ-001');
      assert.equal(hazards[1].id, 'HAZ-002');
    });

    it('should return empty array for invalid content', () => {
      const hazards = parseHazardLog('No hazards here');
      assert.deepEqual(hazards, []);
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

      assert.equal(versions.length, 2);
      // Results are sorted by filename
      assert.equal(versions[0].version, '1.0.0');
      assert.equal(versions[0].fileName, 'red-flag-detection.yaml');
      assert.equal(versions[1].version, '1.32.0');
      assert.equal(versions[1].fileName, 'system-base.yaml');
    });

    it('should skip prompts without version field', () => {
      const prompts = [
        {
          path: 'test.yaml',
          content: 'content: |\n  No version here',
        },
      ];

      const versions = extractPromptVersions(prompts);
      assert.equal(versions.length, 0);
    });

    it('should handle invalid YAML gracefully', () => {
      const prompts = [
        {
          path: 'invalid.yaml',
          content: 'not: valid: yaml: content',
        },
      ];

      const versions = extractPromptVersions(prompts);
      assert.equal(versions.length, 0);
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
      assert.equal(hazardToControl.length, 2);
      assert.equal(hazardToControl[0].source, 'HAZ-001');
      assert.equal(hazardToControl[0].target, 'C-001a');
    });

    it('should track control coverage in tests', () => {
      const hazards = [
        {
          id: 'HAZ-001',
          controls: [{ id: 'C-001a' }],
        },
      ];

      const goldenTests = [
        { file: 'test.yaml', mentionsControls: ['C-001a'] },
      ];

      const refs = buildCrossReferences(hazards, [], goldenTests);

      const controlToTest = refs.filter((r) => r.type === 'control_to_test');
      assert.ok(controlToTest.length > 0);
      assert.equal(controlToTest[0].valid, true);
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
      assert.ok(controlToTest.some((r) => r.valid === false));
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

      assert.ok(markdown.includes('# Prompt Version History'));
      assert.ok(markdown.includes('2025-01-15'));
      assert.ok(markdown.includes('abc1234'));
      assert.ok(markdown.includes('Developer'));
      assert.ok(markdown.includes('update safety rules'));
    });

    it('should group commits by month', () => {
      const commits = [
        { hash: 'a1', date: '2025-01-15', author: 'A', message: 'msg1', files: [] },
        { hash: 'a2', date: '2025-01-20', author: 'B', message: 'msg2', files: [] },
        { hash: 'a3', date: '2025-02-10', author: 'C', message: 'msg3', files: [] },
      ];

      const markdown = generateVersionHistory(commits);

      assert.ok(markdown.includes('2025-01'));
      assert.ok(markdown.includes('2025-02'));
    });

    it('should handle empty commit list', () => {
      const markdown = generateVersionHistory([]);
      assert.ok(markdown.includes('# Prompt Version History'));
    });
  });

  describe('generatePromptInventory', () => {
    it('should list all prompts with versions', () => {
      const prompts = [
        { fileName: 'system-base.yaml', version: '1.32.0', relativePath: 'apps/web/src/lib/prompts/system-base.yaml' },
        { fileName: 'red-flag-detection.yaml', version: '1.0.0', relativePath: 'apps/web/src/lib/prompts/red-flag-detection.yaml' },
      ];

      const markdown = generatePromptInventory(prompts);

      assert.ok(markdown.includes('# Prompt Inventory'));
      assert.ok(markdown.includes('system-base.yaml'));
      assert.ok(markdown.includes('1.32.0'));
      assert.ok(markdown.includes('red-flag-detection.yaml'));
    });

    it('should summarise version distribution', () => {
      const prompts = [
        { fileName: 'a.yaml', version: '1.0.0', relativePath: 'a.yaml' },
        { fileName: 'b.yaml', version: '1.5.0', relativePath: 'b.yaml' },
        { fileName: 'c.yaml', version: '2.0.0', relativePath: 'c.yaml' },
      ];

      const markdown = generatePromptInventory(prompts);

      assert.ok(markdown.includes('Total Prompts'));
      assert.ok(markdown.includes('3'));
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

      assert.ok(markdown.includes('# Hazard Traceability Matrix'));
      assert.ok(markdown.includes('HAZ-001'));
      assert.ok(markdown.includes('C-001a'));
      assert.ok(markdown.includes('Preventive'));
    });

    it('should summarise risk distribution', () => {
      const hazards = [
        { id: 'HAZ-001', acceptability: 'Acceptable', riskScore: 2, residualRiskScore: 2, controls: [] },
        { id: 'HAZ-002', acceptability: 'Medium', riskScore: 8, residualRiskScore: 6, controls: [] },
      ];

      const markdown = generateHazardMatrix(hazards);

      assert.ok(markdown.includes('Risk Distribution'));
    });
  });

  describe('generateValidationReport', () => {
    it('should report valid cross-references', () => {
      const refs = [
        { source: 'HAZ-001', target: 'C-001a', type: 'hazard_to_control', valid: true },
        { source: 'C-001a', target: 'golden-tests', type: 'control_to_test', valid: true },
      ];

      const markdown = generateValidationReport(refs);

      assert.ok(markdown.includes('# Traceability Validation Report'));
      assert.ok(markdown.includes('Valid'));
      assert.ok(markdown.includes('100'));
    });

    it('should list invalid references', () => {
      const refs = [
        { source: 'HAZ-001', target: 'C-001a', type: 'hazard_to_control', valid: true },
        { source: 'C-001a', target: 'golden-tests', type: 'control_to_test', valid: false, error: 'No coverage' },
      ];

      const markdown = generateValidationReport(refs);

      assert.ok(markdown.includes('Issues Found'));
      assert.ok(markdown.includes('No coverage'));
    });
  });

  describe('validateCrossReferences', () => {
    it('should return true when all references valid', () => {
      const refs = [
        { valid: true },
        { valid: true },
      ];

      const result = validateCrossReferences(refs);
      assert.equal(result.valid, true);
      assert.equal(result.invalidCount, 0);
    });

    it('should return false when any reference invalid', () => {
      const refs = [
        { valid: true },
        { valid: false, error: 'Missing coverage' },
      ];

      const result = validateCrossReferences(refs);
      assert.equal(result.valid, false);
      assert.equal(result.invalidCount, 1);
    });

    it('should collect all errors', () => {
      const refs = [
        { valid: false, error: 'Error 1' },
        { valid: false, error: 'Error 2' },
      ];

      const result = validateCrossReferences(refs);
      assert.equal(result.errors.length, 2);
    });
  });
});
