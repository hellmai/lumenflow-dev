// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file setup-tools.test.ts
 * @description Tests for setup/LumenFlow MCP tool implementations
 *
 * WU-1812: setup tools migrated from runCliCommand to executeViaPack.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lumenflowInitTool,
  lumenflowDoctorTool,
  lumenflowIntegrateTool,
  lumenflowUpgradeTool,
  lumenflowCommandsTool,
  lumenflowDocsSyncTool,
  lumenflowReleaseTool,
  lumenflowSyncTemplatesTool,
} from '../tools.js';
import * as cliRunner from '../cli-runner.js';
import * as toolsShared from '../tools-shared.js';

vi.mock('../cli-runner.js', () => ({
  runCliCommand: vi.fn(),
}));

vi.mock('../tools-shared.js', async () => {
  const actual = await vi.importActual<typeof import('../tools-shared.js')>('../tools-shared.js');
  return {
    ...actual,
    executeViaPack: vi.fn(actual.executeViaPack),
  };
});

describe('Setup/LumenFlow MCP tools (WU-1812)', () => {
  const mockRunCliCommand = vi.mocked(cliRunner.runCliCommand);
  const mockExecuteViaPack = vi.mocked(toolsShared.executeViaPack);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runtimeSuccess = { success: true, data: { message: 'ok' } };

  describe('lumenflow_init', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowInitTool.execute({ client: 'claude', merge: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'lumenflow',
        expect.objectContaining({ client: 'claude', merge: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'lumenflow',
            args: expect.arrayContaining(['--client', 'claude', '--merge']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_doctor', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowDoctorTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'lumenflow:doctor',
        {},
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'lumenflow:doctor',
            args: [],
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_integrate', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowIntegrateTool.execute({ client: 'claude-code' });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'lumenflow:integrate',
        expect.objectContaining({ client: 'claude-code' }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'lumenflow:integrate',
            args: expect.arrayContaining(['--client', 'claude-code']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });

    it('requires client parameter', async () => {
      const result = await lumenflowIntegrateTool.execute({});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('client');
      expect(mockExecuteViaPack).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_upgrade', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowUpgradeTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'lumenflow:upgrade',
        {},
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'lumenflow:upgrade',
            args: [],
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_commands', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowCommandsTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'lumenflow',
        {},
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'lumenflow',
            args: ['commands'],
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_docs_sync', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowDocsSyncTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'docs:sync',
        {},
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'docs:sync',
            args: [],
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_release', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowReleaseTool.execute({ dry_run: true });

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'lumenflow:release',
        expect.objectContaining({ dry_run: true }),
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'lumenflow:release',
            args: expect.arrayContaining(['--dry-run']),
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  describe('lumenflow_sync_templates', () => {
    it('routes through executeViaPack', async () => {
      mockExecuteViaPack.mockResolvedValue(runtimeSuccess);

      const result = await lumenflowSyncTemplatesTool.execute({});

      expect(result.success).toBe(true);
      expect(mockExecuteViaPack).toHaveBeenCalledWith(
        'sync:templates',
        {},
        expect.objectContaining({
          fallback: expect.objectContaining({
            command: 'sync:templates',
            args: [],
          }),
        }),
      );
      expect(mockRunCliCommand).not.toHaveBeenCalled();
    });
  });

  it('returns execution error payload from executeViaPack failures', async () => {
    mockExecuteViaPack.mockResolvedValue({
      success: false,
      error: { message: 'runtime-failed' },
    });

    const result = await lumenflowDoctorTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('runtime-failed');
    expect(mockRunCliCommand).not.toHaveBeenCalled();
  });
});
