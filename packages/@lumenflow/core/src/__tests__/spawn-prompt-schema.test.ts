/**
 * Tests for spawn-prompt-schema.ts (WU-1142)
 *
 * Tests the Zod schema for truncation-resistant spawn prompts.
 * Includes tests for:
 * - YAML envelope with wu_id, version, checksum, content, sentinel fields
 * - SHA256 checksum validation
 * - Truncation detection (head, tail, middle slice)
 * - Schema validation for agent consumers
 */

import { describe, it, expect } from 'vitest';
import {
  SpawnPromptSchema,
  createSpawnPrompt,
  validateSpawnPrompt,
  parseSpawnPrompt,
  computeChecksum,
  serializeSpawnPrompt,
  SPAWN_SENTINEL,
} from '../spawn-prompt-schema.js';

describe('spawn-prompt-schema', () => {
  describe('constants', () => {
    it('exports SPAWN_SENTINEL constant', () => {
      expect(SPAWN_SENTINEL).toBe('LUMENFLOW_SPAWN_COMPLETE');
    });
  });

  describe('SpawnPromptSchema', () => {
    it('validates a valid spawn prompt', () => {
      const content = 'Test content for spawn prompt';
      const checksum = computeChecksum(content);

      const result = SpawnPromptSchema.safeParse({
        wu_id: 'WU-1142',
        version: '1.0.0',
        checksum,
        content,
        sentinel: SPAWN_SENTINEL,
      });

      expect(result.success).toBe(true);
    });

    it('rejects missing wu_id', () => {
      const result = SpawnPromptSchema.safeParse({
        version: '1.0.0',
        checksum: 'abc123',
        content: 'test',
        sentinel: SPAWN_SENTINEL,
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid sentinel value', () => {
      const content = 'Test content';
      const checksum = computeChecksum(content);

      const result = SpawnPromptSchema.safeParse({
        wu_id: 'WU-1142',
        version: '1.0.0',
        checksum,
        content,
        sentinel: 'WRONG_SENTINEL',
      });

      expect(result.success).toBe(false);
    });

    it('requires all mandatory fields', () => {
      const result = SpawnPromptSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('computeChecksum', () => {
    it('computes SHA256 checksum of content', () => {
      const content = 'Hello, World!';
      const checksum = computeChecksum(content);

      // SHA256 produces 64 hex characters
      expect(checksum).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(checksum)).toBe(true);
    });

    it('produces different checksums for different content', () => {
      const checksum1 = computeChecksum('content1');
      const checksum2 = computeChecksum('content2');

      expect(checksum1).not.toBe(checksum2);
    });

    it('produces same checksum for identical content', () => {
      const content = 'identical content';
      const checksum1 = computeChecksum(content);
      const checksum2 = computeChecksum(content);

      expect(checksum1).toBe(checksum2);
    });
  });

  describe('createSpawnPrompt', () => {
    it('creates a valid spawn prompt with computed checksum', () => {
      const content = 'Test spawn prompt content';
      const result = createSpawnPrompt('WU-1142', content);

      expect(result.wu_id).toBe('WU-1142');
      expect(result.version).toBe('1.0.0');
      expect(result.content).toBe(content);
      expect(result.sentinel).toBe(SPAWN_SENTINEL);
      expect(result.checksum).toBe(computeChecksum(content));
    });

    it('validates against schema after creation', () => {
      const content = 'Test content';
      const prompt = createSpawnPrompt('WU-123', content);

      const result = SpawnPromptSchema.safeParse(prompt);
      expect(result.success).toBe(true);
    });
  });

  describe('validateSpawnPrompt', () => {
    it('validates checksum matches content', () => {
      const content = 'Valid content';
      const prompt = createSpawnPrompt('WU-1142', content);

      const result = validateSpawnPrompt(prompt);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('fails when checksum does not match content', () => {
      const content = 'Original content';
      const prompt = createSpawnPrompt('WU-1142', content);

      // Tamper with content
      const tamperedPrompt = {
        ...prompt,
        content: 'Modified content',
      };

      const result = validateSpawnPrompt(tamperedPrompt);
      expect(result.valid).toBe(false);
      // Case-insensitive check for 'checksum' in error message
      expect(result.error?.toLowerCase()).toContain('checksum');
    });

    it('fails when sentinel is wrong', () => {
      const content = 'Test content';
      const checksum = computeChecksum(content);

      const prompt = {
        wu_id: 'WU-1142',
        version: '1.0.0',
        checksum,
        content,
        sentinel: 'WRONG',
      };

      const result = validateSpawnPrompt(prompt);
      expect(result.valid).toBe(false);
    });

    it('returns validation error for missing fields', () => {
      const result = validateSpawnPrompt({});
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('parseSpawnPrompt', () => {
    it('parses valid YAML spawn prompt', () => {
      const content = 'Test content for parsing';
      const prompt = createSpawnPrompt('WU-1142', content);
      const yaml = serializeSpawnPrompt(prompt);

      const result = parseSpawnPrompt(yaml);
      expect(result.success).toBe(true);
      expect(result.data?.wu_id).toBe('WU-1142');
      expect(result.data?.content).toBe(content);
    });

    it('fails on truncated head (missing start)', () => {
      const content = 'Test content';
      const prompt = createSpawnPrompt('WU-1142', content);
      const yaml = serializeSpawnPrompt(prompt);

      // Truncate from the start (remove first 50 characters)
      const truncatedYaml = yaml.slice(50);

      const result = parseSpawnPrompt(truncatedYaml);
      expect(result.success).toBe(false);
      // Should fail YAML parse or checksum validation
    });

    it('fails on truncated tail (missing end)', () => {
      const content = 'Test content with important rules at the end';
      const prompt = createSpawnPrompt('WU-1142', content);
      const yaml = serializeSpawnPrompt(prompt);

      // Truncate from the end (remove last 50 characters)
      const truncatedYaml = yaml.slice(0, -50);

      const result = parseSpawnPrompt(truncatedYaml);
      expect(result.success).toBe(false);
      // Should fail because sentinel is missing
    });

    it('fails on middle slice (content modified)', () => {
      const content = 'Start of content... critical rules in the middle... end of content';
      const prompt = createSpawnPrompt('WU-1142', content);
      const yaml = serializeSpawnPrompt(prompt);

      // Extract middle portion by removing from start and end
      const middleSlice = yaml.slice(30, -30);

      const result = parseSpawnPrompt(middleSlice);
      expect(result.success).toBe(false);
    });

    it('fails on invalid YAML', () => {
      const invalidYaml = 'not: valid: yaml: : :';

      const result = parseSpawnPrompt(invalidYaml);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('validates checksum after successful parse', () => {
      const content = 'Content that will be checksummed';
      const prompt = createSpawnPrompt('WU-1142', content);
      const yaml = serializeSpawnPrompt(prompt);

      // Manually modify content in YAML (simulating corruption)
      const corruptedYaml = yaml.replace('Content that will be checksummed', 'Modified content');

      const result = parseSpawnPrompt(corruptedYaml);
      expect(result.success).toBe(false);
      // Case-insensitive check for 'checksum' in error message
      expect(result.error?.toLowerCase()).toContain('checksum');
    });
  });
});
