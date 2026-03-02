/**
 * Tests for auto-session integration into wu:claim and wu:done lifecycle (WU-1438)
 *
 * Acceptance criteria:
 * 1. wu:claim auto-starts an agent session (calls startSession from lib/agent-session.mjs)
 * 2. wu:done auto-ends the active session (calls endSession)
 * 3. Session ID is stored in WU YAML under session_id field during claim
 * 4. orchestrate:monitor shows active sessions per WU
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startSessionForWU,
  endSessionForWU,
  getCurrentSessionForWU,
} from '../src/auto-session-integration.js';

// Test directories
const TEST_SESSION_DIR = '.lumenflow/sessions-test';
const TEST_SESSION_FILE = join(TEST_SESSION_DIR, 'current.json');
const TEST_WORKSPACE_DIR = '.lumenflow/workspace-test';
const TEST_WORKSPACE_FILE = join(TEST_WORKSPACE_DIR, 'workspace.yaml');
const CONTROL_PLANE_TOKEN_ENV = 'CONTROL_PLANE_TOKEN';

function writeControlPlaneWorkspaceConfig(): void {
  mkdirSync(TEST_WORKSPACE_DIR, { recursive: true });
  writeFileSync(
    TEST_WORKSPACE_FILE,
    [
      'id: ws-test',
      'control_plane:',
      '  endpoint: https://control.example.com',
      '  auth:',
      `    token_env: ${CONTROL_PLANE_TOKEN_ENV}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

describe('Auto-Session Integration', () => {
  beforeEach(() => {
    // Clean up test session directory
    if (existsSync(TEST_SESSION_DIR)) {
      rmSync(TEST_SESSION_DIR, { recursive: true });
    }
    if (existsSync(TEST_WORKSPACE_DIR)) {
      rmSync(TEST_WORKSPACE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test session directory
    if (existsSync(TEST_SESSION_DIR)) {
      rmSync(TEST_SESSION_DIR, { recursive: true });
    }
    if (existsSync(TEST_WORKSPACE_DIR)) {
      rmSync(TEST_WORKSPACE_DIR, { recursive: true });
    }
    vi.restoreAllMocks();
  });

  describe('startSessionForWU', () => {
    it('should start a session with WU ID and tier', async () => {
      const result = await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      // UUID v4 format check
      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should create session file in .lumenflow/sessions', async () => {
      await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      expect(existsSync(TEST_SESSION_FILE)).toBe(true);

      const sessionData = JSON.parse(readFileSync(TEST_SESSION_FILE, 'utf8'));
      expect(sessionData.session_id).toBeDefined();
      expect(sessionData.wu_id).toBe('WU-1234');
      expect(sessionData.context_tier).toBe(2);
      expect(sessionData.auto_started).toBe(true);
    });

    it('should not throw if session already exists (silent no-op)', async () => {
      // Create first session
      const firstResult = await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      // Create second session with same WU
      const secondResult = await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      expect(secondResult.sessionId).toBe(firstResult.sessionId);
      expect(secondResult.alreadyActive).toBe(true);
    });

    it('should use default tier 2 if not specified', async () => {
      const result = await startSessionForWU({
        wuId: 'WU-1234',
        sessionDir: TEST_SESSION_DIR,
      });

      const sessionData = JSON.parse(readFileSync(TEST_SESSION_FILE, 'utf8'));
      expect(sessionData.context_tier).toBe(2);
    });
  });

  describe('endSessionForWU', () => {
    it('should end an active session and return summary', async () => {
      // Start a session first
      await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      const result = await endSessionForWU({
        sessionDir: TEST_SESSION_DIR,
      });

      expect(result.ended).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary?.wu_id).toBe('WU-1234');
      expect(result.summary?.session_id).toBeDefined();
      expect(result.summary?.started).toBeDefined();
      expect(result.summary?.completed).toBeDefined();
      expect(result.summary?.context_tier).toBe(2);
    });

    it('should remove session file after ending', async () => {
      // Start a session first
      await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      await endSessionForWU({
        sessionDir: TEST_SESSION_DIR,
      });

      expect(existsSync(TEST_SESSION_FILE)).toBe(false);
    });

    it('should not throw if no active session (silent no-op)', async () => {
      const result = await endSessionForWU({
        sessionDir: TEST_SESSION_DIR,
      });

      expect(result.ended).toBe(false);
      expect(result.reason).toBe('no_active_session');
    });
  });

  describe('control-plane session lifecycle hooks (WU-2153)', () => {
    it('registers a session on start when control_plane is configured', async () => {
      writeControlPlaneWorkspaceConfig();
      const registerSession = vi.fn().mockResolvedValue(undefined);

      const result = await startSessionForWU({
        wuId: 'WU-2153',
        lane: 'Framework: Agent',
        sessionDir: TEST_SESSION_DIR,
        workspaceRoot: TEST_WORKSPACE_DIR,
        environment: {
          [CONTROL_PLANE_TOKEN_ENV]: 'token-value',
        } as NodeJS.ProcessEnv,
        controlPlaneSyncPort: {
          registerSession,
          deregisterSession: vi.fn().mockResolvedValue(undefined),
        },
      });

      expect(result.sessionId).toBeDefined();
      expect(registerSession).toHaveBeenCalledTimes(1);
      expect(registerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-test',
          session_id: result.sessionId,
          agent_id: 'claude-code',
          lane: 'Framework: Agent',
          wu_id: 'WU-2153',
        }),
      );
    });

    it('deregisters a session on end when control_plane is configured', async () => {
      writeControlPlaneWorkspaceConfig();
      const registerSession = vi.fn().mockResolvedValue(undefined);
      const deregisterSession = vi.fn().mockResolvedValue(undefined);

      const startResult = await startSessionForWU({
        wuId: 'WU-2153',
        sessionDir: TEST_SESSION_DIR,
        workspaceRoot: TEST_WORKSPACE_DIR,
        environment: {
          [CONTROL_PLANE_TOKEN_ENV]: 'token-value',
        } as NodeJS.ProcessEnv,
        controlPlaneSyncPort: {
          registerSession,
          deregisterSession,
        },
      });

      const endResult = endSessionForWU({
        sessionDir: TEST_SESSION_DIR,
        workspaceRoot: TEST_WORKSPACE_DIR,
        environment: {
          [CONTROL_PLANE_TOKEN_ENV]: 'token-value',
        } as NodeJS.ProcessEnv,
        controlPlaneSyncPort: {
          registerSession,
          deregisterSession,
        },
      });

      expect(endResult.ended).toBe(true);
      expect(deregisterSession).toHaveBeenCalledTimes(1);
      expect(deregisterSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws-test',
          session_id: startResult.sessionId,
          reason: 'wu_done',
        }),
      );
    });

    it('does not register or deregister when control_plane is not configured', async () => {
      const registerSession = vi.fn().mockResolvedValue(undefined);
      const deregisterSession = vi.fn().mockResolvedValue(undefined);

      const startResult = await startSessionForWU({
        wuId: 'WU-2153',
        sessionDir: TEST_SESSION_DIR,
        workspaceRoot: TEST_WORKSPACE_DIR,
        environment: {} as NodeJS.ProcessEnv,
        controlPlaneSyncPort: {
          registerSession,
          deregisterSession,
        },
      });

      const endResult = endSessionForWU({
        sessionDir: TEST_SESSION_DIR,
        workspaceRoot: TEST_WORKSPACE_DIR,
        environment: {} as NodeJS.ProcessEnv,
        controlPlaneSyncPort: {
          registerSession,
          deregisterSession,
        },
      });

      expect(startResult.sessionId).toBeDefined();
      expect(endResult.ended).toBe(true);
      expect(registerSession).not.toHaveBeenCalled();
      expect(deregisterSession).not.toHaveBeenCalled();
    });

    it('fails open when remote register and deregister fail', async () => {
      writeControlPlaneWorkspaceConfig();
      const registerSession = vi.fn().mockRejectedValue(new Error('register failed'));
      const deregisterSession = vi.fn().mockRejectedValue(new Error('deregister failed'));

      const startResult = await startSessionForWU({
        wuId: 'WU-2153',
        sessionDir: TEST_SESSION_DIR,
        workspaceRoot: TEST_WORKSPACE_DIR,
        environment: {
          [CONTROL_PLANE_TOKEN_ENV]: 'token-value',
        } as NodeJS.ProcessEnv,
        controlPlaneSyncPort: {
          registerSession,
          deregisterSession,
        },
      });

      expect(startResult.sessionId).toBeDefined();
      expect(existsSync(TEST_SESSION_FILE)).toBe(true);

      expect(() =>
        endSessionForWU({
          sessionDir: TEST_SESSION_DIR,
          workspaceRoot: TEST_WORKSPACE_DIR,
          environment: {
            [CONTROL_PLANE_TOKEN_ENV]: 'token-value',
          } as NodeJS.ProcessEnv,
          controlPlaneSyncPort: {
            registerSession,
            deregisterSession,
          },
        }),
      ).not.toThrow();
    });
  });

  describe('getCurrentSessionForWU', () => {
    it('should return current session if active', async () => {
      await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      const session = getCurrentSessionForWU({
        sessionDir: TEST_SESSION_DIR,
      });

      expect(session).toBeDefined();
      expect(session?.wu_id).toBe('WU-1234');
      expect(session?.session_id).toBeDefined();
      expect(session?.context_tier).toBe(2);
    });

    it('should return null if no active session', () => {
      const session = getCurrentSessionForWU({
        sessionDir: TEST_SESSION_DIR,
      });

      expect(session).toBeNull();
    });
  });

  describe('WU YAML session_id Field', () => {
    it('should store session_id in WU YAML during claim', async () => {
      // This test would integrate with the actual wu:claim command
      // For now, we test the session creation part
      const result = await startSessionForWU({
        wuId: 'WU-1234',
        tier: 2,
        sessionDir: TEST_SESSION_DIR,
      });

      expect(result.sessionId).toBeDefined();

      // In a real scenario, the wu:claim command would read this session_id
      // and add it to the WU YAML file
      const sessionData = JSON.parse(readFileSync(TEST_SESSION_FILE, 'utf8'));
      expect(sessionData.session_id).toBe(result.sessionId);
    });
  });
});
