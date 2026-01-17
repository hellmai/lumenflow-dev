/**
 * Logs Tool Tests (WU-2064)
 *
 * Tests for the unified log aggregation command.
 * Following TDD discipline: Write tests FIRST, then implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FIXTURE_DIR = path.join(__dirname, '.test-fixtures-logs');

// Test data fixtures
const WEB_LOG_ENTRY = JSON.stringify({
  time: '2025-12-27T10:00:00.000Z',
  level: 'info',
  msg: 'assistant.stream.phase',
  meta: { phase: 'mode_detection', dt: 45 },
});

const COMMANDS_LOG_ENTRY = JSON.stringify({
  time: '2025-12-27T10:01:00.000Z',
  level: 'info',
  msg: 'git.command',
  command: 'git status',
  cwd: '/project',
});

const FLOW_LOG_ENTRY = JSON.stringify({
  time: '2025-12-27T10:02:00.000Z',
  level: 'info',
  event: 'wu.claim',
  wu: 'WU-123',
  lane: 'Operations',
});

const TOOL_AUDIT_ENTRY = JSON.stringify({
  time: '2025-12-27T10:03:00.000Z',
  tool: 'Write',
  file: 'src/index.ts',
  result: 'success',
});

describe('logs tool', () => {
  beforeEach(() => {
    // Create test fixture directory
    mkdirSync(TEST_FIXTURE_DIR, { recursive: true });
    mkdirSync(path.join(TEST_FIXTURE_DIR, '.logs'), { recursive: true });
    mkdirSync(path.join(TEST_FIXTURE_DIR, '.beacon'), { recursive: true });
  });

  afterEach(() => {
    // Cleanup test fixtures
    rmSync(TEST_FIXTURE_DIR, { recursive: true, force: true });
  });

  describe('parseLogLine', () => {
    // Import will be lazy to avoid issues before implementation exists
    let parseLogLine;

    beforeEach(async () => {
      const mod = await import('../logs-lib.js');
      parseLogLine = mod.parseLogLine;
    });

    it('should parse JSON log line with time and level', () => {
      const result = parseLogLine(WEB_LOG_ENTRY);
      expect(result.time).toBe('2025-12-27T10:00:00.000Z');
      expect(result.level).toBe('info');
      expect(result.msg).toBe('assistant.stream.phase');
    });

    it('should return null for invalid JSON', () => {
      const result = parseLogLine('not valid json');
      expect(result).toBe(null);
    });

    it('should handle log lines without time field', () => {
      const result = parseLogLine(JSON.stringify({ msg: 'test' }));
      expect(result !== null).toBeTruthy();
      expect(result.msg).toBe('test');
    });
  });

  describe('filterLogs', () => {
    let filterLogs;

    beforeEach(async () => {
      const mod = await import('../logs-lib.js');
      filterLogs = mod.filterLogs;
    });

    it('should filter by level', () => {
      const logs = [
        { level: 'info', msg: 'info message' },
        { level: 'error', msg: 'error message' },
        { level: 'warn', msg: 'warn message' },
      ];
      const result = filterLogs(logs, { level: 'error' });
      expect(result.length).toBe(1);
      expect(result[0].msg).toBe('error message');
    });

    it('should filter by service pattern', () => {
      const logs = [
        { msg: 'assistant.stream.start', level: 'info' },
        { msg: 'git.command', level: 'info' },
        { msg: 'assistant.stream.end', level: 'info' },
      ];
      const result = filterLogs(logs, { service: 'assistant' });
      expect(result.length).toBe(2);
    });

    it('should filter by arbitrary text pattern', () => {
      const logs = [
        { msg: 'wu.claim', wu: 'WU-123', level: 'info' },
        { msg: 'wu.done', wu: 'WU-456', level: 'info' },
        { msg: 'git.status', level: 'info' },
      ];
      const result = filterLogs(logs, { filter: 'WU-123' });
      expect(result.length).toBe(1);
      expect(result[0].wu).toBe('WU-123');
    });

    it('should limit results with --last flag', () => {
      const logs = [
        { msg: 'message1', level: 'info' },
        { msg: 'message2', level: 'info' },
        { msg: 'message3', level: 'info' },
        { msg: 'message4', level: 'info' },
        { msg: 'message5', level: 'info' },
      ];
      const result = filterLogs(logs, { last: 2 });
      expect(result.length).toBe(2);
      expect(result[0].msg).toBe('message4');
      expect(result[1].msg).toBe('message5');
    });
  });

  describe('aggregateLogs', () => {
    let aggregateLogs;

    beforeEach(async () => {
      const mod = await import('../logs-lib.js');
      aggregateLogs = mod.aggregateLogs;

      // Create test log files
      writeFileSync(
        path.join(TEST_FIXTURE_DIR, '.logs', 'web.log'),
        WEB_LOG_ENTRY + '\n'
      );
      writeFileSync(
        path.join(TEST_FIXTURE_DIR, '.beacon', 'commands.log'),
        COMMANDS_LOG_ENTRY + '\n'
      );
      writeFileSync(
        path.join(TEST_FIXTURE_DIR, '.beacon', 'flow.log'),
        FLOW_LOG_ENTRY + '\n'
      );
      writeFileSync(
        path.join(TEST_FIXTURE_DIR, '.logs', 'tool-audit.ndjson'),
        TOOL_AUDIT_ENTRY + '\n'
      );
    });

    it('should aggregate logs from all sources', async () => {
      const result = await aggregateLogs({ cwd: TEST_FIXTURE_DIR });
      assert.ok(result.length >= 4, `Expected at least 4 logs, got ${result.length}`);
    });

    it('should include source field in aggregated logs', async () => {
      const result = await aggregateLogs({ cwd: TEST_FIXTURE_DIR });
      const sources = new Set(result.map((log) => log._source));
      assert.ok(sources.has('web.log'), 'Should include web.log source');
    });

    it('should sort logs by time', async () => {
      const result = await aggregateLogs({ cwd: TEST_FIXTURE_DIR });
      for (let i = 1; i < result.length; i++) {
        const prevTime = new Date(result[i - 1].time || 0).getTime();
        const currTime = new Date(result[i].time || 0).getTime();
        assert.ok(prevTime <= currTime, 'Logs should be sorted by time');
      }
    });
  });

  describe('parseArgs', () => {
    let parseLogsArgs;

    beforeEach(async () => {
      const mod = await import('../logs-lib.js');
      parseLogsArgs = mod.parseLogsArgs;
    });

    it('should parse --last flag', () => {
      const result = parseLogsArgs(['--last', '10']);
      expect(result.last).toBe(10);
    });

    it('should parse --level flag', () => {
      const result = parseLogsArgs(['--level', 'error']);
      expect(result.level).toBe('error');
    });

    it('should parse --service flag', () => {
      const result = parseLogsArgs(['--service', 'assistant']);
      expect(result.service).toBe('assistant');
    });

    it('should parse --filter flag', () => {
      const result = parseLogsArgs(['--filter', 'WU-123']);
      expect(result.filter).toBe('WU-123');
    });

    it('should parse --json flag', () => {
      const result = parseLogsArgs(['--json']);
      expect(result.json).toBe(true);
    });

    it('should parse multiple flags', () => {
      const result = parseLogsArgs(['--last', '5', '--level', 'warn', '--json']);
      expect(result.last).toBe(5);
      expect(result.level).toBe('warn');
      expect(result.json).toBe(true);
    });
  });
});
