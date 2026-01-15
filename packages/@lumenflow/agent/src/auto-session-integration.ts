/**
 * Auto-Session Integration for wu:claim and wu:done lifecycle (WU-1438, WU-1466)
 *
 * Provides wrapper functions around agent-session.mjs that:
 * 1. Auto-start sessions on wu:claim with silent no-op if already active
 * 2. Auto-end sessions on wu:done with silent no-op if not active
 * 3. Store session_id in WU YAML for tracking
 * 4. Create memory layer session nodes for context restoration (WU-1466)
 *
 * Design principles:
 * - Composition over modification (wraps existing agent-session.mjs)
 * - Silent failures for idempotent operations (no throw on duplicate start/end)
 * - Configurable session directory for testing
 */
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FILE_SYSTEM } from '@lumenflow/core/lib/wu-constants.js';
import { startSession as startMemorySession } from '@lumenflow/memory/lib/mem-start-core.js';

// Default session directory (same as agent-session.mjs)
const DEFAULT_SESSION_DIR = '.beacon/sessions';
const SESSION_FILENAME = 'current.json';

// Default context tier for auto-started sessions
const DEFAULT_TIER = 2;

// Agent type for auto-started sessions
const DEFAULT_AGENT_TYPE = 'claude-code';

/**
 * Map numeric tier values to string names for memory layer (WU-1466)
 */
const CONTEXT_TIER_MAP = {
  1: 'minimal',
  2: 'core',
  3: 'full',
};

/**
 * Get the session file path for a given session directory
 * @param {string} sessionDir - Session directory path
 * @returns {string} Full path to current.json
 */
function getSessionFilePath(sessionDir) {
  return join(sessionDir, SESSION_FILENAME);
}

/**
 * Start a session for a WU (called by wu:claim)
 *
 * Unlike startSession in agent-session.mjs, this function:
 * - Does NOT throw if a session already exists (returns existing session)
 * - Uses default tier 2 if not specified
 * - Supports custom session directory for testing
 * - Creates memory layer session node for context restoration (WU-1466)
 *
 * @param {object} options - Options
 * @param {string} options.wuId - WU ID (e.g., "WU-1234")
 * @param {1|2|3} [options.tier=2] - Context tier
 * @param {string} [options.agentType='claude-code'] - Agent type
 * @param {string} [options.sessionDir] - Custom session directory (for testing)
 * @param {string} [options.baseDir] - Base directory for memory layer (defaults to cwd)
 * @returns {Promise<{sessionId: string, alreadyActive?: boolean, memoryNodeId?: string}>}
 */
export async function startSessionForWU(options) {
  const {
    wuId,
    tier = DEFAULT_TIER,
    agentType = DEFAULT_AGENT_TYPE,
    sessionDir,
    baseDir = process.cwd(),
  } = options;

  const sessDir = sessionDir || DEFAULT_SESSION_DIR;
  const sessionFile = getSessionFilePath(sessDir);

  // Check for existing session - return it instead of throwing
  if (existsSync(sessionFile)) {
    const existing = JSON.parse(readFileSync(sessionFile, FILE_SYSTEM.UTF8));
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
  const session = {
    session_id: sessionId,
    wu_id: wuId,
    started: new Date().toISOString(),
    agent_type: agentType,
    context_tier: tier,
    incidents_logged: 0,
    incidents_major: 0,
    auto_started: true, // Mark as auto-started by wu:claim
  };

  writeFileSync(sessionFile, JSON.stringify(session, null, 2), FILE_SYSTEM.UTF8);

  // WU-1466: Create memory layer session node for context restoration
  // This enables context restoration after /clear by persisting session info to memory.jsonl
  let memoryNodeId = null;
  try {
    const memResult = await startMemorySession(baseDir, {
      wuId,
      agentType,
      contextTier: CONTEXT_TIER_MAP[tier] || 'full',
    });
    memoryNodeId = memResult.session?.id;
  } catch {
    // Memory layer creation is non-blocking - log but don't fail
    // Session file was already created, so the session is functional
  }

  return {
    sessionId,
    alreadyActive: false,
    memoryNodeId,
  };
}

/**
 * End the current session (called by wu:done)
 *
 * Unlike endSession in agent-session.mjs, this function:
 * - Does NOT throw if no active session (returns { ended: false })
 * - Returns structured result with summary
 * - Supports custom session directory for testing
 *
 * @param {object} options - Options
 * @param {string} [options.sessionDir] - Custom session directory (for testing)
 * @returns {{ended: boolean, summary?: object, reason?: string}}
 */
export function endSessionForWU(options = {}) {
  const { sessionDir } = options;

  const sessDir = sessionDir || DEFAULT_SESSION_DIR;
  const sessionFile = getSessionFilePath(sessDir);

  // Check for active session - return early if none
  if (!existsSync(sessionFile)) {
    return {
      ended: false,
      reason: 'no_active_session',
    };
  }

  // Read session data
  const session = JSON.parse(readFileSync(sessionFile, FILE_SYSTEM.UTF8));

  // Finalize session
  session.completed = new Date().toISOString();

  // Build summary for WU YAML
  const summary = {
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

  return {
    ended: true,
    summary,
  };
}

/**
 * Get the current active session
 *
 * @param {object} options - Options
 * @param {string} [options.sessionDir] - Custom session directory (for testing)
 * @returns {object|null} Session object or null if no active session
 */
export function getCurrentSessionForWU(options = {}) {
  const { sessionDir } = options;

  const sessDir = sessionDir || DEFAULT_SESSION_DIR;
  const sessionFile = getSessionFilePath(sessDir);

  if (!existsSync(sessionFile)) {
    return null;
  }

  return JSON.parse(readFileSync(sessionFile, FILE_SYSTEM.UTF8));
}

/**
 * Check if there's an active session for a specific WU
 *
 * @param {string} wuId - WU ID to check
 * @param {object} options - Options
 * @param {string} [options.sessionDir] - Custom session directory (for testing)
 * @returns {boolean} True if session exists and matches WU ID
 */
export function hasActiveSessionForWU(wuId, options = {}) {
  const session = getCurrentSessionForWU(options);
  return session !== null && session.wu_id === wuId;
}
