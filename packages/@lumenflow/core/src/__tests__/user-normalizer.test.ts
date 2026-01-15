/**
 * WU-1333: User normalizer tests (TDD)
 * Test email normalization and domain inference functionality.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeToEmail,
  inferDefaultDomain,
  isValidEmail,
  DEFAULT_DOMAIN,
} from '../user-normalizer.mjs';

describe('user-normalizer (WU-1333)', () => {
  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      assert.equal(isValidEmail('tom@hellm.ai'), true);
      assert.equal(isValidEmail('alice@example.com'), true);
      assert.equal(isValidEmail('user.name@domain.co.uk'), true);
    });

    it('should return false for usernames without @', () => {
      assert.equal(isValidEmail('tom'), false);
      assert.equal(isValidEmail('alice'), false);
    });

    it('should return false for empty/null values', () => {
      assert.equal(isValidEmail(''), false);
      assert.equal(isValidEmail(null), false);
      assert.equal(isValidEmail(undefined), false);
    });
  });

  describe('inferDefaultDomain', () => {
    it('should export DEFAULT_DOMAIN constant', () => {
      assert.ok(typeof DEFAULT_DOMAIN === 'string');
      assert.ok(DEFAULT_DOMAIN.length > 0);
    });

    it('should return a domain string', async () => {
      const domain = await inferDefaultDomain();
      assert.ok(typeof domain === 'string');
      assert.ok(domain.length > 0);
      // Domain should not have @ prefix
      assert.ok(!domain.startsWith('@'));
    });
  });

  describe('normalizeToEmail', () => {
    it('should return email unchanged if already valid', async () => {
      assert.equal(await normalizeToEmail('tom@hellm.ai'), 'tom@hellm.ai');
      assert.equal(await normalizeToEmail('alice@example.com'), 'alice@example.com');
    });

    it('should append default domain to plain username', async () => {
      const result = await normalizeToEmail('tom');
      assert.ok(result.includes('@'), 'Result should contain @');
      assert.ok(result.startsWith('tom@'), 'Result should start with tom@');
    });

    it('should handle usernames with dots', async () => {
      const result = await normalizeToEmail('user.name');
      assert.ok(result.includes('@'));
      assert.ok(result.startsWith('user.name@'));
    });

    it('should normalize case to lowercase', async () => {
      const result = await normalizeToEmail('TOM');
      assert.ok(result.startsWith('tom@'));
    });

    it('should trim whitespace', async () => {
      const result = await normalizeToEmail('  tom  ');
      assert.ok(result.startsWith('tom@'));
      assert.ok(!result.includes(' '));
    });

    it('should return empty string for null/undefined', async () => {
      assert.equal(await normalizeToEmail(null), '');
      assert.equal(await normalizeToEmail(undefined), '');
    });

    it('should return empty string for empty string', async () => {
      assert.equal(await normalizeToEmail(''), '');
    });

    it('should allow custom domain override', async () => {
      const result = await normalizeToEmail('tom', 'custom.org');
      assert.equal(result, 'tom@custom.org');
    });

    it('should roundtrip with normalizeUsername logic', async () => {
      // normalizeToEmail('tom') -> 'tom@domain'
      // normalizeUsername('tom@domain') -> 'tom' (from wu-done.mjs)
      const email = await normalizeToEmail('tom');
      // Extract username part for comparison
      const username = email.split('@')[0];
      assert.equal(username, 'tom');
    });
  });
});
