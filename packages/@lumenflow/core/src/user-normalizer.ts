// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1333: User normalizer utilities
 *
 * Provides email normalization and domain inference for WU ownership.
 * Converts plain usernames (e.g., "tom") to email format (e.g., "tom@hellm.ai")
 * using domain from git config or workspace.yaml software_delivery.
 *
 * WU-1068: Removed hardcoded exampleapp.co.uk domain. Domain is now inferred
 * from git config user.email or workspace.yaml software_delivery.owner_email.
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { WORKSPACE_CONFIG_FILE_NAME, WORKSPACE_V2_KEYS } from './config-contract.js';
import { getGitForCwd } from './git-adapter.js';
import { DEFAULTS } from './wu-constants.js';

/**
 * Default domain fallback when git config and lumenflow config unavailable
 * WU-1068: Changed from hardcoded 'exampleapp.co.uk' to generic default
 */
export const DEFAULT_DOMAIN = DEFAULTS.EMAIL_DOMAIN;

/**
 * Minimum length for a valid email local part
 */
const MIN_LOCAL_PART_LENGTH = 1;
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
const OWNER_EMAIL_KEYS = ['owner_email', 'ownerEmail'] as const;

/**
 * Check if a value is a valid email address (simple check)
 *
 * @param {string|null|undefined} value - Value to check
 * @returns {boolean} True if value is a valid email
 */
export function isValidEmail(value: string | null | undefined) {
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
function extractDomain(email: string | null | undefined) {
  if (!email || !isValidEmail(email)) {
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
 * Cast unknown data to a record when possible.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Try to get owner email from software_delivery config.
 */
function readOwnerEmail(softwareDelivery: Record<string, unknown>): string | null {
  for (const key of OWNER_EMAIL_KEYS) {
    const value = softwareDelivery[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

/**
 * Try to get domain from workspace.yaml software_delivery owner email.
 *
 * @param {string} [cwd] - Working directory to search from
 * @returns {Promise<string|null>} Domain from config or null
 */
async function getDomainFromWorkspaceConfig(cwd = process.cwd()) {
  const configPath = join(cwd, WORKSPACE_CONFIG_FILE_NAME);

  try {
    await access(configPath);
  } catch {
    return null;
  }

  try {
    const content = await readFile(configPath, { encoding: 'utf-8' });
    const workspaceDoc = asRecord(parseYaml(content));
    if (!workspaceDoc) {
      return null;
    }

    const softwareDelivery = asRecord(workspaceDoc[SOFTWARE_DELIVERY_KEY]);
    if (!softwareDelivery) {
      return null;
    }

    const ownerEmail = readOwnerEmail(softwareDelivery);
    return ownerEmail ? extractDomain(ownerEmail) : null;
  } catch {
    return null;
  }
}

/**
 * Infer the default email domain from available sources
 *
 * Priority:
 * 1. Git config user.email domain
 * 2. workspace.yaml software_delivery.owner_email domain
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
  const configDomain = await getDomainFromWorkspaceConfig(cwd);
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
export async function normalizeToEmail(value: string | null | undefined, domain?: string) {
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
