/**
 * WU-1333: User normalizer utilities
 *
 * Provides email normalization and domain inference for WU ownership.
 * Converts plain usernames (e.g., "tom") to email format (e.g., "tom@hellm.ai")
 * using domain from git config or .lumenflow.config.yaml.
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { getGitForCwd } from './git-adapter.js';
import { FILE_SYSTEM } from './wu-constants.js';

/**
 * Default domain fallback when git config and lumenflow config unavailable
 */
export const DEFAULT_DOMAIN = 'exampleapp.co.uk';

/**
 * Minimum length for a valid email local part
 */
const MIN_LOCAL_PART_LENGTH = 1;

/**
 * Check if a value is a valid email address (simple check)
 *
 * @param {string|null|undefined} value - Value to check
 * @returns {boolean} True if value is a valid email
 */
export function isValidEmail(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const str = value.trim();
  // Simple email validation: must have @ with content before and after
  const atIndex = str.indexOf('@');
  return atIndex > 0 && atIndex < str.length - 1;
}

/**
 * Extract domain from an email address
 *
 * @param {string} email - Email address
 * @returns {string|null} Domain part or null if invalid
 */
function extractDomain(email) {
  if (!isValidEmail(email)) {
    return null;
  }
  const atIndex = email.indexOf('@');
  return email.slice(atIndex + 1);
}

/**
 * Try to get domain from git config user.email
 *
 * @returns {Promise<string|null>} Domain from git config or null
 */
async function getDomainFromGitConfig() {
  try {
    const git = getGitForCwd();
    const email = await git.getConfigValue('user.email');
    return extractDomain(email?.trim() || '');
  } catch {
    return null;
  }
}

/**
 * Try to get domain from .lumenflow.config.yaml OWNER_EMAIL
 *
 * @param {string} [cwd] - Working directory to search from
 * @returns {Promise<string|null>} Domain from config or null
 */
async function getDomainFromLumenflowConfig(cwd = process.cwd()) {
  const configPath = join(cwd, '.lumenflow.config.yaml');

  try {
    await access(configPath);
  } catch {
    return null;
  }

  try {
    const content = await readFile(configPath, FILE_SYSTEM.UTF8);
    // Simple pattern match for OWNER_EMAIL (avoid full YAML parse for performance)
    // Looking for: OWNER_EMAIL: "email@domain"
    const match = content.match(/OWNER_EMAIL:\s*["']?([^"'\s]+)["']?/i);
    if (match && match[1]) {
      return extractDomain(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Infer the default email domain from available sources
 *
 * Priority:
 * 1. Git config user.email domain
 * 2. .lumenflow.config.yaml OWNER_EMAIL domain
 * 3. DEFAULT_DOMAIN constant
 *
 * @param {string} [cwd] - Working directory for config lookup
 * @returns {Promise<string>} Inferred domain (never null/undefined)
 */
export async function inferDefaultDomain(cwd = process.cwd()) {
  // Try git config first
  const gitDomain = await getDomainFromGitConfig();
  if (gitDomain) {
    return gitDomain;
  }

  // Try lumenflow config
  const configDomain = await getDomainFromLumenflowConfig(cwd);
  if (configDomain) {
    return configDomain;
  }

  // Fallback to default
  return DEFAULT_DOMAIN;
}

/**
 * Normalize a username or email to full email format
 *
 * If value is already a valid email, returns it unchanged (with normalization).
 * If value is a plain username, appends the default domain.
 *
 * @param {string|null|undefined} value - Username or email
 * @param {string} [domain] - Optional domain override
 * @returns {Promise<string>} Normalized email address, or empty string for null/undefined
 */
export async function normalizeToEmail(value, domain) {
  // Handle null/undefined/empty
  if (!value) {
    return '';
  }

  const str = String(value).trim().toLowerCase();
  if (str.length < MIN_LOCAL_PART_LENGTH) {
    return '';
  }

  // Already a valid email - return as-is (normalized)
  if (isValidEmail(str)) {
    return str;
  }

  // Plain username - append domain
  const effectiveDomain = domain || (await inferDefaultDomain());
  return `${str}@${effectiveDomain}`;
}
