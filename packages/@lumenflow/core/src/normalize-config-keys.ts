/**
 * Config Key Normalization (WU-1765)
 *
 * Transforms snake_case YAML keys to camelCase before Zod parsing.
 *
 * Root cause: .lumenflow.config.yaml conventionally uses snake_case keys
 * (e.g., agent_branch_patterns), but the Zod schema expects camelCase
 * (e.g., agentBranchPatterns). yaml.parse() returns keys as-is, and Zod
 * silently drops unrecognized keys via its default strip mode.
 *
 * This module provides a focused normalization for the git config section
 * where the mismatch causes real bugs (agent branch detection fails).
 *
 * @module normalize-config-keys
 */

/** Known snake_case → camelCase mappings for the git config section */
const GIT_KEY_MAP: Record<string, string> = {
  agent_branch_patterns: 'agentBranchPatterns',
  agent_branch_patterns_override: 'agentBranchPatternsOverride',
  disable_agent_pattern_registry: 'disableAgentPatternRegistry',
  main_branch: 'mainBranch',
  default_remote: 'defaultRemote',
  require_remote: 'requireRemote',
  lane_branch_prefix: 'laneBranchPrefix',
  max_branch_drift: 'maxBranchDrift',
};

/**
 * Normalize a single config section's keys using a key map.
 *
 * camelCase keys take precedence over snake_case when both exist,
 * since the camelCase form is the canonical schema form.
 */
function normalizeSection(
  section: Record<string, unknown>,
  keyMap: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(section)) {
    const camelKey = keyMap[key];
    if (camelKey) {
      // Only set from snake_case if camelCase form is not already present
      if (!(camelKey in section)) {
        result[camelKey] = value;
      }
      // Don't copy the snake_case key to output
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Normalize config keys from snake_case YAML convention to camelCase schema convention.
 *
 * Currently normalizes the `git` section. Other sections can be added as needed.
 *
 * @param raw - Raw parsed YAML config object
 * @returns Config with normalized keys, ready for Zod parsing
 */
export function normalizeConfigKeys(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return raw ?? {};
  }

  const result = { ...raw };

  if (result.git && typeof result.git === 'object' && !Array.isArray(result.git)) {
    result.git = normalizeSection(result.git as Record<string, unknown>, GIT_KEY_MAP);
  }

  return result;
}
