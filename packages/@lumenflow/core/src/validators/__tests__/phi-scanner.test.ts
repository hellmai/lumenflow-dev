/**
 * PIIScanner Tests
 *
 * TDD tests for PIIdetection functionality.
 * Tests national ID number validation using id-number-validator library
 * and UK postcode detection with medical context using postcode library.
 *
 * Part of WU-1404: PIIScanner Integration
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scanForSensitiveData, isPathExcluded } from '../pii-scanner.mjs';
import { SENSITIVE_DATA_TYPES } from '../phi-constants.mjs';

describe('PIIScanner', () => {
  describe('scanForSensitiveData', () => {
    describe('regulatory authority Number Detection', () => {
      it('should detect valid national ID numbers', () => {
        const content = 'Usernational ID number: 2983396339';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, SENSITIVE_DATA_TYPES.regulatory authority_NUMBER);
        assert.equal(result.matches[0].value, '2983396339');
      });

      it('should detect national ID numbers with spaces', () => {
        const content = 'regulatory authority: 298 339 6339';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, SENSITIVE_DATA_TYPES.regulatory authority_NUMBER);
      });

      it('should detect national ID numbers with dashes', () => {
        const content = 'regulatory authority: 298-339-6339';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, SENSITIVE_DATA_TYPES.regulatory authority_NUMBER);
      });

      it('should NOT detect invalid national ID numbers (fails checksum)', () => {
        // 1234567890 fails the Modulus 11 checksum
        const content = 'Usernational ID number: 1234567890';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test national ID number 4505577104', () => {
        const content = 'Test regulatory authority: 4505577104';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect national ID numbers starting with 999 (test range)', () => {
        // 999 prefix is reserved for testing by regulatory authority Digital
        const content = 'regulatory authority: 9990000018'; // Valid checksum but test range
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should detect multiple national ID numbers in content', () => {
        const content = 'User1: 2983396339, User2: 6328797966';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 2);
      });
    });

    describe('UK Postcode Detection with Medical Context', () => {
      it('should detect postcodes in end-usercontext', () => {
        const content = 'The end-userlives at SW1A 2AA';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches.length, 1);
        assert.equal(result.matches[0].type, SENSITIVE_DATA_TYPES.POSTCODE_MEDICAL_CONTEXT);
        assert.equal(result.matches[0].medicalKeyword, 'user');
      });

      it('should detect postcodes near regulatory authority keyword', () => {
        // Use a non-test postcode (EC2A 4BX is not in test list)
        const content = 'regulatory authority registered address: EC2A 4BX';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
        assert.equal(result.matches[0].type, SENSITIVE_DATA_TYPES.POSTCODE_MEDICAL_CONTEXT);
      });

      it('should detect postcodes near hospital keyword', () => {
        const content = 'Admitted to hospital from M1 1AA';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
      });

      it('should detect postcodes near medical record keyword', () => {
        const content = 'Medical record shows address LS1 1AA';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, true);
      });

      it('should NOT detect postcodes without medical context', () => {
        // This is a company address, no medical context
        const content = 'Our office is located at EC2A 4BX';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test postcodes (SW1A 1AA)', () => {
        const content = 'Useraddress: SW1A 1AA';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test postcodes (EC1A 1BB)', () => {
        const content = 'Useraddress: EC1A 1BB';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should NOT detect test postcodes (W1A 1AA)', () => {
        const content = 'Useraddress: W1A 1AA';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should use context window correctly', () => {
        // Medical keyword is more than 100 chars away
        const padding = 'x'.repeat(120);
        const content = `end-user${padding} SW1A 2AA`;
        const result = scanForSensitiveData(content);

        // Should NOT detect because medical keyword is outside context window
        assert.equal(result.hasPHI, false);
      });

      it('should detect postcode with medical context within window', () => {
        const padding = 'x'.repeat(50);
        const content = `end-user${padding} SW1A 2AA`;
        const result = scanForSensitiveData(content);

        // Should detect because medical keyword is within 100 char window
        assert.equal(result.hasPHI, true);
      });
    });

    describe('Test Data Markers', () => {
      it('should NOT detect PIIwhen [TEST] marker is present', () => {
        const content = '[TEST] Userregulatory authority: 2983396339';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
        assert.ok(result.warnings.length > 0);
      });

      it('should NOT detect PIIwhen [EXAMPLE] marker is present', () => {
        const content = '[EXAMPLE] national ID number: 2983396339';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
      });

      it('should NOT detect PIIwhen [PLACEHOLDER] marker is present', () => {
        const content = '[PLACEHOLDER] 2983396339';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
      });

      it('should NOT detect PIIwhen // test data comment is present', () => {
        const content = '// test data\nconst id= "2983396339";';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
      });

      it('should NOT detect PIIwhen TEST_DATA constant pattern is present', () => {
        const content = 'const TEST_DATA = { id: "2983396339" };';
        const result = scanForSensitiveData(content);

        assert.equal(result.hasPHI, false);
      });
    });

    describe('Empty and Edge Cases', () => {
      it('should handle empty content', () => {
        const result = scanForSensitiveData('');

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
        assert.equal(result.warnings.length, 0);
      });

      it('should handle null content', () => {
        const result = scanForSensitiveData(null);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should handle undefined content', () => {
        const result = scanForSensitiveData(undefined);

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });

      it('should handle content with only whitespace', () => {
        const result = scanForSensitiveData('   \n\t  ');

        assert.equal(result.hasPHI, false);
        assert.equal(result.matches.length, 0);
      });
    });

    describe('Return Structure', () => {
      it('should return correct structure when PIIfound', () => {
        const content = 'regulatory authority: 2983396339';
        const result = scanForSensitiveData(content);

        assert.ok('hasPHI' in result);
        assert.ok('matches' in result);
        assert.ok('warnings' in result);
        assert.ok(Array.isArray(result.matches));
        assert.ok(Array.isArray(result.warnings));
      });

      it('should include match details with positions', () => {
        const content = 'regulatory authority: 2983396339';
        const result = scanForSensitiveData(content);

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
      assert.equal(isPathExcluded('tools/lib/__tests__/file.mjs'), true);
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
      assert.equal(isPathExcluded('tools/file-write.mjs'), false);
    });

    it('should handle empty path', () => {
      assert.equal(isPathExcluded(''), false);
    });

    it('should handle null path', () => {
      assert.equal(isPathExcluded(null), false);
    });
  });
});
