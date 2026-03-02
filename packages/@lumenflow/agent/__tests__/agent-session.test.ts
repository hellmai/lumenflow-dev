import { access } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INCIDENT_SEVERITY } from '@lumenflow/core/wu-constants';

const { revparseMock, appendIncidentMock } = vi.hoisted(() => ({
  revparseMock: vi.fn(),
  appendIncidentMock: vi.fn(),
}));

vi.mock('simple-git', () => ({
  simpleGit: () => ({
    revparse: revparseMock,
  }),
}));

vi.mock('../src/agent-incidents.js', () => ({
  appendIncident: appendIncidentMock,
}));

import { endSession, getCurrentSession, logIncident, startSession } from '../src/agent-session.js';

const SESSION_FILE = join('.lumenflow', 'sessions', 'current.json');

describe.sequential('agent-session', () => {
  let previousCwd = process.cwd();
  let tempCwd = '';

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempCwd = await mkdtemp(join(tmpdir(), 'lumenflow-agent-session-'));
    process.chdir(tempCwd);

    revparseMock.mockReset();
    appendIncidentMock.mockReset();
    revparseMock.mockResolvedValue('lane/operations-runtime/wu-2178');
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempCwd, { recursive: true, force: true });
  });

  it('starts a session, derives lane from branch name, and persists session state', async () => {
    const sessionId = await startSession('WU-2178', 2, 'codex');
    const session = await getCurrentSession();

    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(session).toMatchObject({
      session_id: sessionId,
      wu_id: 'WU-2178',
      lane: 'Operations: Runtime',
      context_tier: 2,
      agent_type: 'codex',
      incidents_logged: 0,
      incidents_major: 0,
    });
  });

  it('falls back to Unknown lane when git branch lookup fails', async () => {
    revparseMock.mockRejectedValueOnce(new Error('not a git repo'));

    await startSession('WU-2178', 2);
    const session = await getCurrentSession();

    expect(session?.lane).toBe('Unknown');
  });

  it('rejects invalid WU IDs', async () => {
    await expect(startSession('INVALID', 2)).rejects.toMatchObject({ code: 'INVALID_WU_ID' });
  });

  it('rejects invalid context tiers', async () => {
    await expect(startSession('WU-2178', 4 as 1 | 2 | 3)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects when a session is already active', async () => {
    await startSession('WU-2178', 2);

    await expect(startSession('WU-2179', 2)).rejects.toMatchObject({ code: 'SESSION_ERROR' });
  });

  it('rejects incident logging when no active session exists', async () => {
    await expect(
      logIncident({
        category: 'workflow',
        severity: INCIDENT_SEVERITY.MINOR,
        title: 'test',
        description: 'test',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_ERROR' });
  });

  it('logs incidents, merges context, and updates incident counters', async () => {
    const sessionId = await startSession('WU-2178', 2);

    await logIncident({
      category: 'tooling',
      severity: INCIDENT_SEVERITY.MAJOR,
      title: 'major issue',
      description: 'major issue description',
      context: {
        tool: 'vitest',
      },
    });

    await logIncident({
      category: 'workflow',
      severity: INCIDENT_SEVERITY.MINOR,
      title: 'minor issue',
      description: 'minor issue description',
    });

    expect(appendIncidentMock).toHaveBeenCalledTimes(2);
    expect(appendIncidentMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        session_id: sessionId,
        wu_id: 'WU-2178',
        lane: 'Operations: Runtime',
        severity: INCIDENT_SEVERITY.MAJOR,
        context: expect.objectContaining({
          git_branch: 'lane/operations-runtime/wu-2178',
          tool: 'vitest',
        }),
      }),
    );

    const session = await getCurrentSession();
    expect(session).toMatchObject({
      incidents_logged: 2,
      incidents_major: 1,
    });
  });

  it('ends active sessions, returns summary, and removes the session file', async () => {
    const sessionId = await startSession('WU-2178', 3);

    const summary = await endSession();

    expect(summary).toMatchObject({
      wu_id: 'WU-2178',
      lane: 'Operations: Runtime',
      session_id: sessionId,
      context_tier: 3,
      incidents_logged: 0,
      incidents_major: 0,
    });
    await expect(access(SESSION_FILE)).rejects.toThrow();
    await expect(getCurrentSession()).resolves.toBeNull();
  });

  it('rejects ending a session when no active session exists', async () => {
    await expect(endSession()).rejects.toMatchObject({ code: 'SESSION_ERROR' });
  });
});
