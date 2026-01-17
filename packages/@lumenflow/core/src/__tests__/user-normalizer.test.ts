/**
 * WU-1333: User normalizer tests (TDD)
 * Test email normalization and domain inference functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeToEmail,
  inferDefaultDomain,
  isValidEmail,
  DEFAULT_DOMAIN,
} from '../user-normalizer.js';

describe('user-normalizer (WU-1333)', () => {
  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      expect(isValidEmail('tom@hellm.ai')).toBe(true);
      expect(isValidEmail('alice@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
    });

    it('should return false for usernames without @', () => {
      expect(isValidEmail('tom')).toBe(false);
      expect(isValidEmail('alice')).toBe(false);
    });

    it('should return false for empty/null values', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
    });
  });

  describe('inferDefaultDomain', () => {
    it('should export DEFAULT_DOMAIN constant', () => {
      expect(typeof DEFAULT_DOMAIN === 'string').toBeTruthy();
      expect(DEFAULT_DOMAIN.length > 0).toBeTruthy();
    });

    it('should return a domain string', async () => {
      const domain = await inferDefaultDomain();
      expect(typeof domain === 'string').toBeTruthy();
      expect(domain.length > 0).toBeTruthy();
      // Domain should not have @ prefix
      expect(!domain.startsWith('@')).toBeTruthy();
    });
  });

  describe('normalizeToEmail', () => {
    it('should return email unchanged if already valid', async () => {
      expect(await normalizeToEmail('tom@hellm.ai')).toBe('tom@hellm.ai');
      expect(await normalizeToEmail('alice@example.com')).toBe('alice@example.com');
    });

    it('should append default domain to plain username', async () => {
      const result = await normalizeToEmail('tom');
      expect(result.includes('@')).toBe(true);
      expect(result.startsWith('tom@')).toBe(true);
    });

    it('should handle usernames with dots', async () => {
      const result = await normalizeToEmail('user.name');
      expect(result).toContain('@');
      expect(result.startsWith('user.name@')).toBeTruthy();
    });

    it('should normalize case to lowercase', async () => {
      const result = await normalizeToEmail('TOM');
      expect(result.startsWith('tom@')).toBeTruthy();
    });

    it('should trim whitespace', async () => {
      const result = await normalizeToEmail('  tom  ');
      expect(result.startsWith('tom@')).toBeTruthy();
      expect(result).not.toContain(' ');
    });

    it('should return empty string for null/undefined', async () => {
      expect(await normalizeToEmail(null)).toBe('');
      expect(await normalizeToEmail(undefined)).toBe('');
    });

    it('should return empty string for empty string', async () => {
      expect(await normalizeToEmail('')).toBe('');
    });

    it('should allow custom domain override', async () => {
      const result = await normalizeToEmail('tom', 'custom.org');
      expect(result).toBe('tom@custom.org');
    });

    it('should roundtrip with normalizeUsername logic', async () => {
      // normalizeToEmail('tom') -> 'tom@domain'
      // normalizeUsername('tom@domain') -> 'tom' (from wu-done.mjs)
      const email = await normalizeToEmail('tom');
      // Extract username part for comparison
      const username = email.split('@')[0];
      expect(username).toBe('tom');
    });
  });
});
