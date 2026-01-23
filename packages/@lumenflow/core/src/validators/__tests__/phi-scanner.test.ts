/**
 * PHI Scanner Tests
 *
 * TDD tests for PHI detection functionality.
 * Tests NHS number validation using nhs-number-validator library
 * and UK postcode detection with medical context using postcode library.
 *
 * Part of WU-1404: PHI Scanner Integration
 * WU-1068: PHI scanning now gated behind PHI_CONFIG.ENABLED
 */

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scanForPHI, isPathExcluded } from '../phi-scanner.js';
import { PHI_TYPES } from '../phi-constants.js';
import { PHI_CONFIG } from '../../wu-constants.js';

// Store original value to restore after tests
const originalEnabled = PHI_CONFIG.ENABLED;

// Enable PHI scanning for tests (WU-1068)
before(() => {
  PHI_CONFIG.ENABLED = true;
});

after(() => {
  PHI_CONFIG.ENABLED = originalEnabled;
});

describe('PHI Scanner', () => {
  describe('scanForPHI', () => {
    describe('NHS Number Detection', () => {
      it('should detect valid NHS numbers', () => {
        const content = 'Patient NHS number: 2983396339';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, PHI_TYPES.NHS_NUMBER);
        assert.equal(result.matches[0].value, '2983396339');
      });

      it('should detect NHS numbers with spaces', () => {
        const content = 'NHS: 298 339 6339';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, PHI_TYPES.NHS_NUMBER);
      });

      it('should detect NHS numbers with dashes', () => {
        const content = 'NHS: 298-339-6339';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, PHI_TYPES.NHS_NUMBER);
      });

      it('should NOT detect invalid NHS numbers (fails checksum)', () => {
        // 1234567890 fails the Modulus 11 checksum
        const content = 'Patient NHS number: 1234567890';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test NHS number 4505577104', () => {
        const content = 'Test NHS: 4505577104';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect NHS numbers starting with 999 (test range)', () => {
        // 999 prefix is reserved for testing by NHS Digital
        const content = 'NHS: 9990000018'; // Valid checksum but test range
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should detect multiple NHS numbers in content', () => {
        const content = 'Patient 1: 2983396339, Patient 2: 6328797966';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 2);
      });
    });

    describe('UK Postcode Detection with Medical Context', () => {
      it('should detect postcodes in patient context', () => {
        const content = 'The patient lives at SW1A 2AA';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, PHI_TYPES.POSTCODE_MEDICAL_CONTEXT);
        assert.equal(result.matches[0].medicalKeyword, 'patient');
      });

      it('should detect postcodes near NHS keyword', () => {
        // Use a non-test postcode (EC2A 4BX is not in test list)
        const content = 'NHS registered address: EC2A 4BX';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches[0].type, PHI_TYPES.POSTCODE_MEDICAL_CONTEXT);
      });

      it('should detect postcodes near hospital keyword', () => {
        const content = 'Admitted to hospital from M1 1AA';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
      });

      it('should detect postcodes near medical record keyword', () => {
        const content = 'Medical record shows address LS1 1AA';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, true);
      });

      it('should NOT detect postcodes without medical context', () => {
        // This is a company address, no medical context
        const content = 'Our office is located at EC2A 4BX';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test postcodes (SW1A 1AA)', () => {
        const content = 'Patient address: SW1A 1AA';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test postcodes (EC1A 1BB)', () => {
        const content = 'Patient address: EC1A 1BB';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test postcodes (W1A 1AA)', () => {
        const content = 'Patient address: W1A 1AA';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should use context window correctly', () => {
        // Medical keyword is more than 100 chars away
        const padding = 'x'.repeat(120);
        const content = `patient ${padding} SW1A 2AA`;
        const result = scanForPHI(content);

        // Should NOT detect because medical keyword is outside context window
        assert.equal(result.hasPHI, false);
      });

      it('should detect postcode with medical context within window', () => {
        const padding = 'x'.repeat(50);
        const content = `patient ${padding} SW1A 2AA`;
        const result = scanForPHI(content);

        // Should detect because medical keyword is within 100 char window
        assert.equal(result.hasPHI, true);
      });
    });

    describe('Test Data Markers', () => {
      it('should NOT detect PHI when [TEST] marker is present', () => {
        const content = '[TEST] Patient NHS: 2983396339';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
        assert.ok(result.warnings.length > 0);
      });

      it('should NOT detect PHI when [EXAMPLE] marker is present', () => {
        const content = '[EXAMPLE] NHS number: 2983396339';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
      });

      it('should NOT detect PHI when [PLACEHOLDER] marker is present', () => {
        const content = '[PLACEHOLDER] 2983396339';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
      });

      it('should NOT detect PHI when // test data comment is present', () => {
        const content = '// test data\nconst nhs = "2983396339";';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
      });

      it('should NOT detect PHI when TEST_DATA constant pattern is present', () => {
        const content = 'const TEST_DATA = { nhs: "2983396339" };';
        const result = scanForPHI(content);

        assert.equal(result.hasPHI, false);
      });
    });

    describe('Empty and Edge Cases', () => {
      it('should handle empty content', () => {
        const result = scanForPHI('');

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
        assert.equal(result.warnings.length, 0);
      });

      it('should handle null content', () => {
        const result = scanForPHI(null);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should handle undefined content', () => {
        const result = scanForPHI(undefined);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should handle content with only whitespace', () => {
        const result = scanForPHI('   \n\t  ');

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });
    });

    describe('Return Structure', () => {
      it('should return correct structure when PHI found', () => {
        const content = 'NHS: 2983396339';
        const result = scanForPHI(content);

        assert.ok('hasPHI' in result);
        assert.ok('matches' in result);
        assert.ok('warnings' in result);
        assert.ok(Array.isArray(result.matches));
        assert.ok(Array.isArray(result.warnings));
      });

      it('should include match details with positions', () => {
        const content = 'NHS: 2983396339';
        const result = scanForPHI(content);

        const match = result.matches[0];
        assert.ok('type' in match);
        assert.ok('value' in match);
        assert.ok('startIndex' in match);
        assert.ok('endIndex' in match);
        assert.equal(typeof match.startIndex, 'number');
        assert.equal(typeof match.endIndex, 'number');
      });
    });
  });

  describe('isPathExcluded', () => {
    it('should exclude __tests__ directories', () => {
      assert.equal(isPathExcluded('tools/lib/__tests__/file.js'), true);
    });

    it('should exclude test directories', () => {
      assert.equal(isPathExcluded('src/test/file.js'), true);
    });

    it('should exclude .test. files', () => {
      assert.equal(isPathExcluded('src/utils.test.js'), true);
    });

    it('should exclude .spec. files', () => {
      assert.equal(isPathExcluded('src/utils.spec.ts'), true);
    });

    it('should exclude fixtures directories', () => {
      assert.equal(isPathExcluded('test/fixtures/data.json'), true);
    });

    it('should exclude mocks directories', () => {
      assert.equal(isPathExcluded('src/__mocks__/api.js'), true);
    });

    it('should exclude VCR cassettes', () => {
      assert.equal(isPathExcluded('test/VCR/cassettes/response.json'), true);
    });

    it('should exclude markdown files', () => {
      assert.equal(isPathExcluded('docs/guide.md'), true);
    });

    it('should NOT exclude regular source files', () => {
      assert.equal(isPathExcluded('src/utils/helper.js'), false);
    });

    it('should NOT exclude tool files', () => {
      assert.equal(isPathExcluded('tools/file-write.js'), false);
    });

    it('should handle empty path', () => {
      assert.equal(isPathExcluded(''), false);
    });

    it('should handle null path', () => {
      assert.equal(isPathExcluded(null), false);
    });
  });
});
