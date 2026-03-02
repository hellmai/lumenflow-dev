// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auto-Session Integration for wu:claim and wu:done lifecycle (WU-1438, WU-1466)
 *
 * Provides wrapper functions around agent-session.ts that:
 * 1. Auto-start sessions on wu:claim with silent no-op if already active
 * 2. Auto-end sessions on wu:done with silent no-op if not active
 * 3. Store session_id in WU YAML for tracking
 * 4. Create memory layer session nodes for context restoration (WU-1466)
 *
 * Design principles:
 * - Composition over modification (wraps existing agent-session.ts)
 * - Silent failures for idempotent operations (no throw on duplicate start/end)
 * - Configurable session directory for testing
 */
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { startSession as startMemorySession } from '@lumenflow/memory/start';
import { LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';
import { parseYAML } from '@lumenflow/core/wu-yaml';

const SESSION_FILENAME = 'current.json';
const WORKSPACE_CONFIG_FILE = 'workspace.yaml';
const CONTROL_PLANE_REGISTER_PATH = '/api/v1/sessions/register';
const CONTROL_PLANE_DEREGISTER_PATH = '/api/v1/sessions/deregister';

// Default context tier for auto-started sessions
const DEFAULT_TIER: 1 | 2 | 3 = 2;

// Agent type for auto-started sessions
const DEFAULT_AGENT_TYPE = 'claude-code';

/**
 * Map numeric tier values to string names for memory layer (WU-1466)
 */
const CONTEXT_TIER_MAP: Record<number, string> = {
  1: 'minimal',
  2: 'core',
  3: 'full',
};

/**
 * Session data stored in current.json
 */
interface SessionFileData {
  session_id: string;
  wu_id: string;
  started: string;
  completed?: string;
  agent_type: string;
  context_tier: number;
  incidents_logged: number;
  incidents_major: number;
  auto_started?: boolean;
}

interface RegisterSessionInput {
  workspace_id: string;
  session_id: string;
  agent_id: string;
  started_at: string;
  lane?: string;
  wu_id?: string;
}

interface DeregisterSessionInput {
  workspace_id: string;
  session_id: string;
  ended_at?: string;
  reason?: string;
}

interface ControlPlaneSessionSyncPort {
  registerSession(input: RegisterSessionInput): Promise<unknown>;
  deregisterSession(input: DeregisterSessionInput): Promise<unknown>;
}

interface ResolvedControlPlaneSyncConfig {
  workspaceId: string;
  endpoint: string;
  token: string;
}

interface WorkspaceControlPlaneDocument {
  id?: unknown;
  control_plane?: {
    endpoint?: unknown;
    auth?: {
      token_env?: unknown;
    };
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, endpoint.length - 1) : endpoint;
}

function resolveControlPlaneSessionSyncConfig(
  workspaceRoot: string,
  environment: NodeJS.ProcessEnv,
): ResolvedControlPlaneSyncConfig | null {
  const workspacePath = join(workspaceRoot, WORKSPACE_CONFIG_FILE);
  if (!existsSync(workspacePath)) {
    return null;
  }

  let parsedWorkspace: WorkspaceControlPlaneDocument | null;
  try {
    parsedWorkspace = parseYAML(
      readFileSync(workspacePath, { encoding: 'utf-8' }),
    ) as WorkspaceControlPlaneDocument | null;
  } catch {
    return null;
  }

  const workspaceId = asNonEmptyString(parsedWorkspace?.id);
  const endpoint = asNonEmptyString(parsedWorkspace?.control_plane?.endpoint);
  const tokenEnv = asNonEmptyString(parsedWorkspace?.control_plane?.auth?.token_env);
  if (!workspaceId || !endpoint || !tokenEnv) {
    return null;
  }

  const token = asNonEmptyString(environment[tokenEnv]);
  if (!token) {
    return null;
  }

  try {
    // Validate endpoint before creating outbound requests.
    void new URL(endpoint);
  } catch {
    return null;
  }

  return {
    workspaceId,
    endpoint: normalizeEndpoint(endpoint),
    token,
  };
}

async function postControlPlaneSessionHook(
  endpoint: string,
  token: string,
  path: string,
  payload: object,
  fetchFn: typeof fetch,
): Promise<void> {
  const response = await fetchFn(`${endpoint}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

/**
 * Get the session file path for a given session directory
 * @param sessionDir - Session directory path
 * @returns Full path to current.json
 */
function getSessionFilePath(sessionDir: string): string {
  return join(sessionDir, SESSION_FILENAME);
}

/**
 * Options for starting a session for a WU
 */
interface StartSessionOptions {
  wuId: string;
  tier?: 1 | 2 | 3;
  agentType?: string;
  lane?: string;
  sessionDir?: string;
  workspaceRoot?: string;
  environment?: NodeJS.ProcessEnv;
  controlPlaneSyncPort?: ControlPlaneSessionSyncPort;
  fetchFn?: typeof fetch;
  baseDir?: string;
}

/**
 * Result of starting a session
 */
interface StartSessionResult {
  sessionId: string;
  alreadyActive?: boolean;
  memoryNodeId?: string | null;
}

/**
 * Start a session for a WU (called by wu:claim)
 *
 * Unlike startSession in agent-session.ts, this function:
 * - Does NOT throw if a session already exists (returns existing session)
 * - Uses default tier 2 if not specified
 * - Supports custom session directory for testing
 * - Creates memory layer session node for context restoration (WU-1466)
 *
 * @param options - Session options
 * @returns Session result
 */
export async function startSessionForWU(options: StartSessionOptions): Promise<StartSessionResult> {
  const {
    wuId,
    tier = DEFAULT_TIER,
    agentType = DEFAULT_AGENT_TYPE,
    lane,
    sessionDir,
    workspaceRoot = process.cwd(),
    environment = process.env,
    controlPlaneSyncPort,
    fetchFn = fetch,
    baseDir = process.cwd(),
  } = options;

  const sessDir = sessionDir ?? LUMENFLOW_PATHS.SESSIONS;
  const sessionFile = getSessionFilePath(sessDir);

  // Check for existing session - return it instead of throwing
  if (existsSync(sessionFile)) {
    const existing = JSON.parse(
      readFileSync(sessionFile, { encoding: 'utf-8' }),
    ) as SessionFileData;
    return {
      sessionId: existing.session_id,
      alreadyActive: true,
    };
  }

  // Create session directory if needed
  if (!existsSync(sessDir)) {
    mkdirSync(sessDir, { recursive: true });
  }

  // Create new session
  const sessionId = randomUUID();
  const session: SessionFileData = {
    session_id: sessionId,
    wu_id: wuId,
    started: new Date().toISOString(),
    agent_type: agentType,
    context_tier: tier,
    incidents_logged: 0,
    incidents_major: 0,
    auto_started: true, // Mark as auto-started by wu:claim
  };

  writeFileSync(sessionFile, JSON.stringify(session, null, 2), { encoding: 'utf-8' });

  // WU-1466: Create memory layer session node for context restoration
  // This enables context restoration after /clear by persisting session info to memory.jsonl
  let memoryNodeId: string | null = null;
  try {
    const memResult = await startMemorySession(baseDir, {
      wuId,
      agentType,
      contextTier: CONTEXT_TIER_MAP[tier] ?? 'full',
    });
    memoryNodeId = memResult.session?.id ?? null;
  } catch {
    // Memory layer creation is non-blocking - log but don't fail
    // Session file was already created, so the session is functional
  }

  // WU-2153: Optional control-plane session registration.
  // Fail-open by design: session lifecycle must not be blocked by remote errors.
  const controlPlaneConfig = resolveControlPlaneSessionSyncConfig(workspaceRoot, environment);
  if (controlPlaneConfig) {
    const registerInput: RegisterSessionInput = {
      workspace_id: controlPlaneConfig.workspaceId,
      session_id: sessionId,
      agent_id: agentType,
      started_at: session.started,
      lane,
      wu_id: wuId,
    };

    try {
      if (controlPlaneSyncPort) {
        await controlPlaneSyncPort.registerSession(registerInput);
      } else {
        await postControlPlaneSessionHook(
          controlPlaneConfig.endpoint,
          controlPlaneConfig.token,
          CONTROL_PLANE_REGISTER_PATH,
          registerInput,
          fetchFn,
        );
      }
    } catch {
      // Fail-open: remote registration must not block wu:claim.
    }
  }

  return {
    sessionId,
    alreadyActive: false,
    memoryNodeId,
  };
}

/**
 * Options for ending a session
 */
interface EndSessionOptions {
  sessionDir?: string;
  workspaceRoot?: string;
  environment?: NodeJS.ProcessEnv;
  controlPlaneSyncPort?: ControlPlaneSessionSyncPort;
  fetchFn?: typeof fetch;
}

/**
 * Session summary
 */
interface SessionSummary {
  wu_id: string;
  session_id: string;
  started: string;
  completed: string;
  agent_type: string;
  context_tier: number;
  incidents_logged: number;
  incidents_major: number;
}

/**
 * Result of ending a session
 */
interface EndSessionResult {
  ended: boolean;
  summary?: SessionSummary;
  reason?: string;
}

/**
 * End the current session (called by wu:done)
 *
 * Unlike endSession in agent-session.ts, this function:
 * - Does NOT throw if no active session (returns { ended: false })
 * - Returns structured result with summary
 * - Supports custom session directory for testing
 *
 * @param options - Session options
 * @returns Session end result
 */
export function endSessionForWU(options: EndSessionOptions = {}): EndSessionResult {
  const {
    sessionDir,
    workspaceRoot = process.cwd(),
    environment = process.env,
    controlPlaneSyncPort,
    fetchFn = fetch,
  } = options;

  const sessDir = sessionDir ?? LUMENFLOW_PATHS.SESSIONS;
  const sessionFile = getSessionFilePath(sessDir);

  // Check for active session - return early if none
  if (!existsSync(sessionFile)) {
    return {
      ended: false,
      reason: 'no_active_session',
    };
  }

  // Read session data
  const session = JSON.parse(readFileSync(sessionFile, { encoding: 'utf-8' })) as SessionFileData;

  // Finalize session
  session.completed = new Date().toISOString();

  // Build summary for WU YAML
  const summary: SessionSummary = {
    wu_id: session.wu_id,
    session_id: session.session_id,
    started: session.started,
    completed: session.completed,
    agent_type: session.agent_type,
    context_tier: session.context_tier,
    incidents_logged: session.incidents_logged,
    incidents_major: session.incidents_major,
  };

  // Remove session file
  unlinkSync(sessionFile);

  // WU-2153: Optional control-plane session deregistration.
  // Fail-open by design: completion path must not block on remote errors.
  const controlPlaneConfig = resolveControlPlaneSessionSyncConfig(workspaceRoot, environment);
  if (controlPlaneConfig) {
    const deregisterInput: DeregisterSessionInput = {
      workspace_id: controlPlaneConfig.workspaceId,
      session_id: session.session_id,
      ended_at: session.completed,
      reason: 'wu_done',
    };

    if (controlPlaneSyncPort) {
      void controlPlaneSyncPort.deregisterSession(deregisterInput).catch(() => {});
    } else {
      void postControlPlaneSessionHook(
        controlPlaneConfig.endpoint,
        controlPlaneConfig.token,
        CONTROL_PLANE_DEREGISTER_PATH,
        deregisterInput,
        fetchFn,
      ).catch(() => {});
    }
  }

  return {
    ended: true,
    summary,
  };
}

/**
 * Options for getting current session
 */
interface GetSessionOptions {
  sessionDir?: string;
}

/**
 * Get the current active session
 *
 * @param options - Session options
 * @returns Session object or null if no active session
 */
export function getCurrentSessionForWU(options: GetSessionOptions = {}): SessionFileData | null {
  const { sessionDir } = options;

  const sessDir = sessionDir ?? LUMENFLOW_PATHS.SESSIONS;
  const sessionFile = getSessionFilePath(sessDir);

  if (!existsSync(sessionFile)) {
    return null;
  }

  return JSON.parse(readFileSync(sessionFile, { encoding: 'utf-8' })) as SessionFileData;
}

/**
 * Check if there's an active session for a specific WU
 *
 * @param wuId - WU ID to check
 * @param options - Session options
 * @returns True if session exists and matches WU ID
 */
export function hasActiveSessionForWU(wuId: string, options: GetSessionOptions = {}): boolean {
  const session = getCurrentSessionForWU(options);
  return session !== null && session.wu_id === wuId;
}
