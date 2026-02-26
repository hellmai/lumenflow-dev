// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_FILES } from '@lumenflow/core/wu-constants';
import { KernelEventSchema } from '@lumenflow/kernel';
import {
  buildWuLifecycleKernelEvent,
  flushWuLifecycleSync,
  type FlushWuLifecycleSyncInput,
} from '../wu-lifecycle-sync/service.js';
import {
  WU_LIFECYCLE_COMMANDS,
  WU_LIFECYCLE_EVENT_KINDS,
  WU_LIFECYCLE_SYNC_CONFIG,
  WU_LIFECYCLE_SYNC_SKIPPED_REASONS,
} from '../wu-lifecycle-sync/constants.js';
import type { WuLifecycleEventSink } from '../wu-lifecycle-sync/port.js';

const TEST_TOKEN_ENV = 'LUMENFLOW_CONTROL_PLANE_TOKEN_TEST';
const TEST_ENDPOINT = 'https://cloud.example.com';
const TEST_WORKSPACE_ID = 'workspace-test';
const TEST_WU_ID = 'WU-2224';
const TEST_ORG_ID = 'org-test';
const TEST_PROJECT_ID = 'project-test';
const TEST_SYNC_INTERVAL_SECONDS = 30;
const TEST_POLICY_MODE = 'tighten-only';
const TEST_TIMESTAMP = '2026-02-26T22:30:00.000Z';
const TEST_TOKEN_VALUE = 'token-value';
const TEST_EVENTS_ENDPOINT_PATH = '/api/v1/events';
const TEST_RESPONSE_CONTENT_TYPE = 'application/json';
const TEST_BEARER_PREFIX = 'Bearer';
const TEST_AUTHORIZATION_HEADER = `${TEST_BEARER_PREFIX} ${TEST_TOKEN_VALUE}`;
const TEST_FETCH_ACCEPTED_PAYLOAD = { accepted: 1 };
const TEST_FETCH_ERROR_PAYLOAD = { error: 'boom' };
const TEST_CLAIM_ACTOR = 'tester@example.com';
const TEST_CLAIM_SESSION = 'session-123';
const TEST_EVIDENCE_REF = 'lumenflow://stamps/WU-2224.md';

function createWorkspaceRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'wu-lifecycle-sync-'));
}

function writeWorkspaceYaml(
  root: string,
  options: {
    includeControlPlane?: boolean;
    workspaceId?: string;
    tokenEnv?: string;
  } = {},
): void {
  const workspaceDoc: Record<string, unknown> = {
    [WU_LIFECYCLE_SYNC_CONFIG.WORKSPACE_ID_FIELD]: options.workspaceId ?? TEST_WORKSPACE_ID,
  };

  if (options.includeControlPlane ?? true) {
    workspaceDoc[WU_LIFECYCLE_SYNC_CONFIG.CONTROL_PLANE_FIELD] = {
      endpoint: TEST_ENDPOINT,
      org_id: TEST_ORG_ID,
      project_id: TEST_PROJECT_ID,
      sync_interval: TEST_SYNC_INTERVAL_SECONDS,
      policy_mode: TEST_POLICY_MODE,
      auth: {
        token_env: options.tokenEnv ?? TEST_TOKEN_ENV,
      },
    };
  }

  writeFileSync(
    path.join(root, CONFIG_FILES.WORKSPACE_CONFIG),
    YAML.stringify(workspaceDoc),
    WU_LIFECYCLE_SYNC_CONFIG.TEXT_ENCODING_UTF8,
  );
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': TEST_RESPONSE_CONTENT_TYPE,
    },
  });
}

describe('wu-lifecycle-sync (WU-2224)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips when workspace.yaml is missing', async () => {
    const root = createWorkspaceRoot();
    tempDirs.push(root);

    const result = await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.CREATE,
        wuId: TEST_WU_ID,
      },
      {
        workspaceRoot: root,
      },
    );

    expect(result.sent).toBe(false);
    expect(result.skippedReason).toBe(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.WORKSPACE_CONFIG_MISSING);
  });

  it('skips when control_plane config is missing', async () => {
    const root = createWorkspaceRoot();
    tempDirs.push(root);
    writeWorkspaceYaml(root, { includeControlPlane: false });

    const result = await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.CREATE,
        wuId: TEST_WU_ID,
      },
      {
        workspaceRoot: root,
      },
    );

    expect(result.sent).toBe(false);
    expect(result.skippedReason).toBe(
      WU_LIFECYCLE_SYNC_SKIPPED_REASONS.CONTROL_PLANE_NOT_CONFIGURED,
    );
  });

  it('skips when token env var is missing', async () => {
    const root = createWorkspaceRoot();
    tempDirs.push(root);
    writeWorkspaceYaml(root);

    const result = await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.CREATE,
        wuId: TEST_WU_ID,
      },
      {
        workspaceRoot: root,
        environment: {},
      },
    );

    expect(result.sent).toBe(false);
    expect(result.skippedReason).toBe(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.MISSING_TOKEN_ENV);
  });

  it('pushes lifecycle events to /api/v1/events when cloud config is valid', async () => {
    const root = createWorkspaceRoot();
    tempDirs.push(root);
    writeWorkspaceYaml(root);

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse(TEST_FETCH_ACCEPTED_PAYLOAD));

    const result = await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.CREATE,
        wuId: TEST_WU_ID,
      },
      {
        workspaceRoot: root,
        fetchFn,
        environment: {
          [TEST_TOKEN_ENV]: TEST_TOKEN_VALUE,
        },
      },
    );

    expect(result.sent).toBe(true);
    expect(result.accepted).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`${TEST_ENDPOINT}${TEST_EVENTS_ENDPOINT_PATH}`);

    const requestInit = fetchFn.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(TEST_AUTHORIZATION_HEADER);
    expect(headers.get('content-type')).toBe(TEST_RESPONSE_CONTENT_TYPE);

    const body = JSON.parse(String(requestInit?.body)) as {
      workspace_id: string;
      events: Array<Record<string, unknown>>;
    };

    expect(body.workspace_id).toBe(TEST_WORKSPACE_ID);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.kind).toBe(WU_LIFECYCLE_EVENT_KINDS.CREATE);
    expect(body.events[0]?.task_id).toBe(TEST_WU_ID);
  });

  it('fails open when endpoint returns HTTP 500', async () => {
    const root = createWorkspaceRoot();
    tempDirs.push(root);
    writeWorkspaceYaml(root);

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse(TEST_FETCH_ERROR_PAYLOAD, 500));

    const result = await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.DONE,
        wuId: TEST_WU_ID,
      },
      {
        workspaceRoot: root,
        fetchFn,
        environment: {
          [TEST_TOKEN_ENV]: TEST_TOKEN_VALUE,
        },
      },
    );

    expect(result.sent).toBe(false);
    expect(result.accepted).toBe(0);
    expect(result.skippedReason).toBe(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.PUSH_FAILED);
  });

  it('fails open when sink throws unexpectedly', async () => {
    const logger = { warn: vi.fn<(message: string) => void>() };

    const throwingSink: WuLifecycleEventSink = {
      push: vi.fn().mockRejectedValue(new Error('sink boom')),
    };

    const result = await flushWuLifecycleSync(
      {
        command: WU_LIFECYCLE_COMMANDS.CLAIM,
        wuId: TEST_WU_ID,
      },
      {
        sink: throwingSink,
        logger,
      },
    );

    expect(result.sent).toBe(false);
    expect(result.accepted).toBe(0);
    expect(result.skippedReason).toBe(WU_LIFECYCLE_SYNC_SKIPPED_REASONS.PUSH_FAILED);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('emits KernelEventSchema-valid payloads for create/claim/done mappings', () => {
    const createEvent = buildWuLifecycleKernelEvent({
      command: WU_LIFECYCLE_COMMANDS.CREATE,
      wuId: TEST_WU_ID,
      specHash: 'a'.repeat(64),
      timestamp: TEST_TIMESTAMP,
    });

    const claimEvent = buildWuLifecycleKernelEvent({
      command: WU_LIFECYCLE_COMMANDS.CLAIM,
      wuId: TEST_WU_ID,
      by: TEST_CLAIM_ACTOR,
      sessionId: TEST_CLAIM_SESSION,
      timestamp: TEST_TIMESTAMP,
    });

    const doneEvent = buildWuLifecycleKernelEvent({
      command: WU_LIFECYCLE_COMMANDS.DONE,
      wuId: TEST_WU_ID,
      evidenceRefs: [TEST_EVIDENCE_REF],
      timestamp: TEST_TIMESTAMP,
    });

    expect(KernelEventSchema.safeParse(createEvent).success).toBe(true);
    expect(KernelEventSchema.safeParse(claimEvent).success).toBe(true);
    expect(KernelEventSchema.safeParse(doneEvent).success).toBe(true);
  });

  it('normalizes empty claim actor/session to schema-safe defaults', () => {
    const claimEvent = buildWuLifecycleKernelEvent({
      command: WU_LIFECYCLE_COMMANDS.CLAIM,
      wuId: TEST_WU_ID,
      by: '   ',
      sessionId: '',
    } satisfies FlushWuLifecycleSyncInput);

    expect(KernelEventSchema.safeParse(claimEvent).success).toBe(true);
    expect(claimEvent.kind).toBe(WU_LIFECYCLE_EVENT_KINDS.CLAIM);
    if (claimEvent.kind === WU_LIFECYCLE_EVENT_KINDS.CLAIM) {
      expect(claimEvent.by.length).toBeGreaterThan(0);
      expect(claimEvent.session_id.length).toBeGreaterThan(0);
    }
  });
});
