import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { join } from 'path';
import simpleGit from 'simple-git';
import { appendIncident } from './agent-incidents.js';
import { PATTERNS, INCIDENT_SEVERITY, BEACON_PATHS, FILE_SYSTEM } from '@lumenflow/core/lib/wu-constants.js';

const SESSION_DIR = BEACON_PATHS.SESSIONS;
const SESSION_FILE = join(SESSION_DIR, 'current.json');

/**
 * Start a new agent session
 * @param {string} wuId - WU ID (e.g., "WU-1234")
 * @param {1|2|3} tier - Context tier from bootloader
 * @param {string} agentType - Agent type (default: "claude-code")
 * @returns {Promise<string>} session_id
 * @throws {Error} if session already active or WU format invalid
 */
export async function startSession(wuId, tier, agentType = 'claude-code') {
  // Check for existing session
  const sessionExists = await access(SESSION_FILE)
    .then(() => true)
    .catch(() => false);
  if (sessionExists) {
    const content = await readFile(SESSION_FILE, FILE_SYSTEM.UTF8);
    const existing = JSON.parse(content);
    throw new Error(
      `Session ${existing.session_id} already active for ${existing.wu_id}. ` +
        `Run 'pnpm agent:session:end' first.`
    );
  }

  // Validate WU ID format
  if (!PATTERNS.WU_ID.test(wuId)) {
    throw new Error(`Invalid WU ID format: ${wuId}. Must match WU-XXX.`);
  }

  // Validate tier
  if (![1, 2, 3].includes(tier)) {
    throw new Error(`Invalid context tier: ${tier}. Must be 1, 2, or 3.`);
  }

  // Auto-detect lane from git branch if possible
  const git = simpleGit();
  let lane = 'Unknown';
  try {
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    // Parse lane from branch name: lane/<lane>/wu-xxx → <lane>
    const match = branch.match(/^lane\/([^/]+)\//);
    if (match) {
      lane = match[1]
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(': ');
    }
  } catch {
    // Fallback: lane stays "Unknown"
  }

  const sessionId = randomUUID();
  const session = {
    session_id: sessionId,
    wu_id: wuId,
    lane,
    started: new Date().toISOString(),
    agent_type: agentType,
    context_tier: tier,
    incidents_logged: 0,
    incidents_major: 0,
  };

  // Ensure directory exists
  const dirExists = await access(SESSION_DIR)
    .then(() => true)
    .catch(() => false);
  if (!dirExists) {
    await mkdir(SESSION_DIR, { recursive: true });
  }

  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
  return sessionId;
}

/**
 * Get the current active session
 * @returns {Promise<object|null>} Session state or null if no active session
 */
export async function getCurrentSession() {
  const sessionExists = await access(SESSION_FILE)
    .then(() => true)
    .catch(() => false);
  if (!sessionExists) return null;
  const content = await readFile(SESSION_FILE, FILE_SYSTEM.UTF8);
  return JSON.parse(content);
}

/**
 * Log an incident and update session counters
 * @param {object} incidentData - Incident data (category, severity, title, description, etc.)
 * @returns {Promise<void>}
 * @throws {Error} if no active session
 */
export async function logIncident(incidentData) {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error('No active session. Run: pnpm agent:session start --wu WU-XXX --tier N');
  }

  // Get current git context
  const git = simpleGit();
  let gitBranch = 'unknown';
  try {
    gitBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
  } catch {
    // Ignore git errors
  }

  // Build full incident record
  const incident = {
    timestamp: new Date().toISOString(),
    session_id: session.session_id,
    wu_id: session.wu_id,
    lane: session.lane,
    ...incidentData,
    context: {
      git_branch: gitBranch,
      ...(incidentData.context || {}),
    },
  };

  // Append to NDJSON (will validate)
  appendIncident(incident);

  // Update session counters
  session.incidents_logged++;
  if (
    incident.severity === INCIDENT_SEVERITY.MAJOR ||
    incident.severity === INCIDENT_SEVERITY.BLOCKER
  ) {
    session.incidents_major++;
  }
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
}

/**
 * End the current session and return summary
 * @returns {Promise<object>} Session summary for appending to WU YAML
 * @throws {Error} if no active session
 */
export async function endSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error('No active session to end.');
  }

  // Finalize session
  session.completed = new Date().toISOString();

  // Clean up session file
  await unlink(SESSION_FILE);

  // Return session object for WU YAML
  return {
    wu_id: session.wu_id,
    lane: session.lane,
    session_id: session.session_id,
    started: session.started,
    completed: session.completed,
    agent_type: session.agent_type,
    context_tier: session.context_tier,
    incidents_logged: session.incidents_logged,
    incidents_major: session.incidents_major,
    // artifacts can be added manually later
  };
}
