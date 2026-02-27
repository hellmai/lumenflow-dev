/**
 * @file state-emit.test.ts
 * Tests for state:emit CLI command (WU-2241)
 *
 * TDD: RED phase - Tests written BEFORE implementation
 *
 * Acceptance criteria:
 * 1. state:emit --type claim --wu WU-XXX appends a corrective claim event
 * 2. state:emit --type release --wu WU-XXX appends a corrective release event
 * 3. All emitted events include reason field and audit trail
 * 4. state:doctor --fix uses state:emit internally for auto-repair
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('state:emit CLI (WU-2241)', () => {
  let tmpDir: string;
  let eventsPath: string;
  let auditLogPath: string;
  let stateDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-emit-test-'));
    stateDir = path.join(tmpDir, '.lumenflow', 'state');
    await fs.mkdir(stateDir, { recursive: true });
    eventsPath = path.join(stateDir, 'wu-events.jsonl');
    auditLogPath = path.join(tmpDir, '.lumenflow', 'audit.log');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('emitCorrectiveEvent (core function)', () => {
    it('appends a corrective claim event to wu-events.jsonl', async () => {
      // Create empty events file
      await fs.writeFile(eventsPath, '', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await emitCorrectiveEvent({
        type: 'claim',
        wuId: 'WU-999',
        reason: 'Manual correction: state was out of sync',
        eventsFilePath: eventsPath,
        auditLogPath,
      });

      const content = await fs.readFile(eventsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);

      const event = JSON.parse(lines[0]);
      expect(event.wuId).toBe('WU-999');
      expect(event.type).toBe('claim');
      expect(event.reason).toBe('Manual correction: state was out of sync');
      expect(event.timestamp).toBeDefined();
      expect(event.source).toBe('state:emit');
    });

    it('appends a corrective release event to wu-events.jsonl', async () => {
      // Create events file with existing claim
      const existingEvent = JSON.stringify({
        wuId: 'WU-999',
        type: 'claim',
        timestamp: '2026-01-01T00:00:00.000Z',
      });
      await fs.writeFile(eventsPath, existingEvent + '\n', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await emitCorrectiveEvent({
        type: 'release',
        wuId: 'WU-999',
        reason: 'Manual correction: releasing orphaned claim',
        eventsFilePath: eventsPath,
        auditLogPath,
      });

      const content = await fs.readFile(eventsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);

      const event = JSON.parse(lines[1]);
      expect(event.wuId).toBe('WU-999');
      expect(event.type).toBe('release');
      expect(event.reason).toBe('Manual correction: releasing orphaned claim');
      expect(event.source).toBe('state:emit');
    });

    it('includes audit trail fields on every emitted event', async () => {
      await fs.writeFile(eventsPath, '', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await emitCorrectiveEvent({
        type: 'claim',
        wuId: 'WU-123',
        reason: 'Test audit trail',
        eventsFilePath: eventsPath,
        auditLogPath,
      });

      const content = await fs.readFile(eventsPath, 'utf-8');
      const event = JSON.parse(content.trim());

      // Audit trail fields
      expect(event.source).toBe('state:emit');
      expect(event.reason).toBe('Test audit trail');
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.corrective).toBe(true);
    });

    it('writes audit log entry for the operation', async () => {
      await fs.writeFile(eventsPath, '', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await emitCorrectiveEvent({
        type: 'release',
        wuId: 'WU-500',
        reason: 'Audit log test',
        eventsFilePath: eventsPath,
        auditLogPath,
      });

      const auditContent = await fs.readFile(auditLogPath, 'utf-8');
      const auditEntry = JSON.parse(auditContent.trim());
      expect(auditEntry.tool).toBe('state:emit');
      expect(auditEntry.input.type).toBe('release');
      expect(auditEntry.input.wuId).toBe('WU-500');
      expect(auditEntry.status).toBe('success');
    });

    it('creates events file if it does not exist', async () => {
      // Remove the events file
      await fs.rm(eventsPath, { force: true });

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await emitCorrectiveEvent({
        type: 'claim',
        wuId: 'WU-100',
        reason: 'Bootstrap correction',
        eventsFilePath: eventsPath,
        auditLogPath,
      });

      const content = await fs.readFile(eventsPath, 'utf-8');
      const event = JSON.parse(content.trim());
      expect(event.wuId).toBe('WU-100');
      expect(event.type).toBe('claim');
    });

    it('rejects invalid event types', async () => {
      await fs.writeFile(eventsPath, '', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await expect(
        emitCorrectiveEvent({
          type: 'invalid' as 'claim',
          wuId: 'WU-100',
          reason: 'Bad type',
          eventsFilePath: eventsPath,
          auditLogPath,
        }),
      ).rejects.toThrow(/invalid event type/i);
    });

    it('rejects missing reason', async () => {
      await fs.writeFile(eventsPath, '', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await expect(
        emitCorrectiveEvent({
          type: 'claim',
          wuId: 'WU-100',
          reason: '',
          eventsFilePath: eventsPath,
          auditLogPath,
        }),
      ).rejects.toThrow(/reason is required/i);
    });

    it('rejects invalid WU ID format', async () => {
      await fs.writeFile(eventsPath, '', 'utf-8');

      const { emitCorrectiveEvent } = await import('../src/state-emit.js');

      await expect(
        emitCorrectiveEvent({
          type: 'claim',
          wuId: 'bad-id',
          reason: 'Bad WU ID',
          eventsFilePath: eventsPath,
          auditLogPath,
        }),
      ).rejects.toThrow(/invalid WU ID/i);
    });
  });

  describe('VALID_EMIT_TYPES', () => {
    it('exports claim and release as valid types', async () => {
      const { VALID_EMIT_TYPES } = await import('../src/state-emit.js');
      expect(VALID_EMIT_TYPES).toContain('claim');
      expect(VALID_EMIT_TYPES).toContain('release');
    });
  });
});
