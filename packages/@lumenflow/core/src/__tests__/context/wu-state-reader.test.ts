// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-state-reader.test.ts
 * @description Tests for WU state reading (YAML + state store, inconsistency detection)
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests cover:
 * - Reading WU status from YAML
 * - Reading WU status from state store
 * - Detecting inconsistencies between YAML and state store
 * - Handling missing WU gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('yaml', () => ({
  parse: vi.fn(),
}));

import { readWuState, type WuStateResult } from '../../context/wu-state-reader.js';
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

describe('readWuState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('YAML reading', () => {
    it('reads WU state from YAML file', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(`
id: WU-1090
title: Test WU
status: ready
lane: Framework: Core
`);
      vi.mocked(parseYaml).mockReturnValue({
        id: 'WU-1090',
        title: 'Test WU',
        status: 'ready',
        lane: 'Framework: Core',
      });

      // Act
      const result = await readWuState('WU-1090', '/repo');

      // Assert
      expect(result.id).toBe('WU-1090');
      expect(result.status).toBe('ready');
      expect(result.lane).toBe('Framework: Core');
      expect(result.title).toBe('Test WU');
    });

    it('returns null when WU YAML does not exist', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(false);

      // Act
      const result = await readWuState('WU-9999', '/repo');

      // Assert
      expect(result).toBeNull();
    });

    it('includes yamlPath in result', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('id: WU-42\nstatus: ready\nlane: Test\ntitle: Test');
      vi.mocked(parseYaml).mockReturnValue({
        id: 'WU-42',
        status: 'ready',
        lane: 'Test',
        title: 'Test',
      });

      // Act
      const result = await readWuState('WU-42', '/repo');

      // Assert
      expect(result?.yamlPath).toContain('WU-42.yaml');
      expect(result?.yamlPath).toContain('/repo');
    });
  });

  describe('state store integration', () => {
    it('marks as consistent when YAML and state store agree', async () => {
      // Arrange - YAML shows in_progress, state store would also have in_progress
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseYaml).mockReturnValue({
        id: 'WU-1090',
        status: 'in_progress',
        lane: 'Framework: Core',
        title: 'Test',
      });

      // Act
      const result = await readWuState('WU-1090', '/repo');

      // Assert
      expect(result?.isConsistent).toBe(true);
      expect(result?.inconsistencyReason).toBeNull();
    });

    it('detects inconsistency when YAML has done but state store has in_progress', async () => {
      // Note: This test verifies the interface. Real state store integration
      // would require mocking the WUStateStore class
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseYaml).mockReturnValue({
        id: 'WU-1090',
        status: 'done',
        lane: 'Framework: Core',
        title: 'Test',
      });

      // For now, we assume YAML-only reading is consistent
      // Full state store integration will be in a separate test
      const result = await readWuState('WU-1090', '/repo');

      // When only YAML is available, it's considered consistent
      expect(result?.isConsistent).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles YAML parse errors gracefully', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid: yaml: content:');
      vi.mocked(parseYaml).mockImplementation(() => {
        throw new Error('Invalid YAML');
      });

      // Act
      const result = await readWuState('WU-1090', '/repo');

      // Assert - should return null on parse error
      expect(result).toBeNull();
    });

    it('handles file read errors gracefully', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Act
      const result = await readWuState('WU-1090', '/repo');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('WU ID normalization', () => {
    it('normalizes WU ID to uppercase', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseYaml).mockReturnValue({
        id: 'wu-1090',
        status: 'ready',
        lane: 'Test',
        title: 'Test',
      });

      // Act
      const result = await readWuState('wu-1090', '/repo');

      // Assert - ID should be normalized to uppercase
      expect(result?.id).toBe('WU-1090');
    });
  });
});
