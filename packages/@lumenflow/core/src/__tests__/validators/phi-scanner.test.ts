/**
 * PHI Scanner Tests
 *
 * TDD tests for PHI detection functionality.
 * Tests NHS number validation using nhs-number-validator library
 * and UK postcode detection with medical context using postcode library.
 *
 * Part of WU-1404: PHI Scanner Integration
 * WU-1068: PHI scanning now gated behind PHI_CONFIG.ENABLED
 * WU-1103: Migrated from node:test to Vitest
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { scanForPHI, isPathExcluded } from '../../validators/phi-scanner.js';
import { PHI_TYPES } from '../../validators/phi-constants.js';
import { PHI_CONFIG } from '../../wu-constants.js';

// Store original value to restore after tests
const originalEnabled = PHI_CONFIG.ENABLED;

// Enable PHI scanning for tests (WU-1068)
beforeAll(() => {
  PHI_CONFIG.ENABLED = true;
});

afterAll(() => {
  PHI_CONFIG.ENABLED = originalEnabled;
});

describe('PHI Scanner', () => {
  describe('scanForPHI', () => {
    describe('NHS Number Detection', () => {
      it('should detect valid NHS numbers', () => {
        const content = 'Patient NHS number: 2983396339';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
        expect(result.matches.length).toBe(1);
        expect(result.matches[0].type).toBe(PHI_TYPES.NHS_NUMBER);
        expect(result.matches[0].value).toBe('2983396339');
      });

      it('should detect NHS numbers with spaces', () => {
        const content = 'NHS: 298 339 6339';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
        expect(result.matches.length).toBe(1);
        expect(result.matches[0].type).toBe(PHI_TYPES.NHS_NUMBER);
      });

      it('should detect NHS numbers with dashes', () => {
        const content = 'NHS: 298-339-6339';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
        expect(result.matches.length).toBe(1);
        expect(result.matches[0].type).toBe(PHI_TYPES.NHS_NUMBER);
      });

      it('should NOT detect invalid NHS numbers (fails checksum)', () => {
        // 1234567890 fails the Modulus 11 checksum
        const content = 'Patient NHS number: 1234567890';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should NOT detect test NHS number 4505577104', () => {
        const content = 'Test NHS: 4505577104';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should NOT detect NHS numbers starting with 999 (test range)', () => {
        // 999 prefix is reserved for testing by NHS Digital
        const content = 'NHS: 9990000018'; // Valid checksum but test range
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should detect multiple NHS numbers in content', () => {
        const content = 'Patient 1: 2983396339, Patient 2: 6328797966';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
        expect(result.matches.length).toBe(2);
      });
    });

    describe('UK Postcode Detection with Medical Context', () => {
      it('should detect postcodes in patient context', () => {
        const content = 'The patient lives at SW1A 2AA';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
        expect(result.matches.length).toBe(1);
        expect(result.matches[0].type).toBe(PHI_TYPES.POSTCODE_MEDICAL_CONTEXT);
        expect(result.matches[0].medicalKeyword).toBe('patient');
      });

      it('should detect postcodes near NHS keyword', () => {
        // Use a non-test postcode (EC2A 4BX is not in test list)
        const content = 'NHS registered address: EC2A 4BX';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
        expect(result.matches[0].type).toBe(PHI_TYPES.POSTCODE_MEDICAL_CONTEXT);
      });

      it('should detect postcodes near hospital keyword', () => {
        const content = 'Admitted to hospital from M1 1AA';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
      });

      it('should detect postcodes near medical record keyword', () => {
        const content = 'Medical record shows address LS1 1AA';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(true);
      });

      it('should NOT detect postcodes without medical context', () => {
        // This is a company address, no medical context
        const content = 'Our office is located at EC2A 4BX';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should NOT detect test postcodes (SW1A 1AA)', () => {
        const content = 'Patient address: SW1A 1AA';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should NOT detect test postcodes (EC1A 1BB)', () => {
        const content = 'Patient address: EC1A 1BB';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should NOT detect test postcodes (W1A 1AA)', () => {
        const content = 'Patient address: W1A 1AA';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should use context window correctly', () => {
        // Medical keyword is more than 100 chars away
        const padding = 'x'.repeat(120);
        const content = `patient ${padding} SW1A 2AA`;
        const result = scanForPHI(content);

        // Should NOT detect because medical keyword is outside context window
        expect(result.hasPHI).toBe(false);
      });

      it('should detect postcode with medical context within window', () => {
        const padding = 'x'.repeat(50);
        const content = `patient ${padding} SW1A 2AA`;
        const result = scanForPHI(content);

        // Should detect because medical keyword is within 100 char window
        expect(result.hasPHI).toBe(true);
      });
    });

    describe('Test Data Markers', () => {
      it('should NOT detect PHI when [TEST] marker is present', () => {
        const content = '[TEST] Patient NHS: 2983396339';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
      });

      it('should NOT detect PHI when [EXAMPLE] marker is present', () => {
        const content = '[EXAMPLE] NHS number: 2983396339';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
      });

      it('should NOT detect PHI when [PLACEHOLDER] marker is present', () => {
        const content = '[PLACEHOLDER] 2983396339';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
      });

      it('should NOT detect PHI when // test data comment is present', () => {
        const content = '// test data\nconst nhs = "2983396339";';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
      });

      it('should NOT detect PHI when TEST_DATA constant pattern is present', () => {
        const content = 'const TEST_DATA = { nhs: "2983396339" };';
        const result = scanForPHI(content);

        expect(result.hasPHI).toBe(false);
      });
    });

    describe('Empty and Edge Cases', () => {
      it('should handle empty content', () => {
        const result = scanForPHI('');

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
        expect(result.warnings.length).toBe(0);
      });

      it('should handle null content', () => {
        // @ts-expect-error - Testing null handling for runtime safety
        const result = scanForPHI(null);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should handle undefined content', () => {
        // @ts-expect-error - Testing undefined handling for runtime safety
        const result = scanForPHI(undefined);

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });

      it('should handle content with only whitespace', () => {
        const result = scanForPHI('   \n\t  ');

        expect(result.hasPHI).toBe(false);
        expect(result.matches.length).toBe(0);
      });
    });

    describe('Return Structure', () => {
      it('should return correct structure when PHI found', () => {
        const content = 'NHS: 2983396339';
        const result = scanForPHI(content);

        expect(result).toHaveProperty('hasPHI');
        expect(result).toHaveProperty('matches');
        expect(result).toHaveProperty('warnings');
        expect(Array.isArray(result.matches)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
      });

      it('should include match details with positions', () => {
        const content = 'NHS: 2983396339';
        const result = scanForPHI(content);

        const match = result.matches[0];
        expect(match).toHaveProperty('type');
        expect(match).toHaveProperty('value');
        expect(match).toHaveProperty('startIndex');
        expect(match).toHaveProperty('endIndex');
        expect(typeof match.startIndex).toBe('number');
        expect(typeof match.endIndex).toBe('number');
      });
    });
  });

  describe('isPathExcluded', () => {
    it('should exclude __tests__ directories', () => {
      expect(isPathExcluded('tools/lib/__tests__/file.js')).toBe(true);
    });

    it('should exclude test directories', () => {
      expect(isPathExcluded('src/test/file.js')).toBe(true);
    });

    it('should exclude .test. files', () => {
      expect(isPathExcluded('src/utils.test.js')).toBe(true);
    });

    it('should exclude .spec. files', () => {
      expect(isPathExcluded('src/utils.spec.ts')).toBe(true);
    });

    it('should exclude fixtures directories', () => {
      expect(isPathExcluded('test/fixtures/data.json')).toBe(true);
    });

    it('should exclude mocks directories', () => {
      expect(isPathExcluded('src/__mocks__/api.js')).toBe(true);
    });

    it('should exclude VCR cassettes', () => {
      expect(isPathExcluded('test/VCR/cassettes/response.json')).toBe(true);
    });

    it('should exclude markdown files', () => {
      expect(isPathExcluded('docs/guide.md')).toBe(true);
    });

    it('should NOT exclude regular source files', () => {
      expect(isPathExcluded('src/utils/helper.js')).toBe(false);
    });

    it('should NOT exclude tool files', () => {
      expect(isPathExcluded('tools/file-write.js')).toBe(false);
    });

    it('should handle empty path', () => {
      expect(isPathExcluded('')).toBe(false);
    });

    it('should handle null path', () => {
      expect(isPathExcluded(null)).toBe(false);
    });
  });
});
