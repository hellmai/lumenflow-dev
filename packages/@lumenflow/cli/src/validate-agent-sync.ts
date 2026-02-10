#!/usr/bin/env node
/**
 * @file validate-agent-sync.ts
 * @description Validates agent sync state (WU-1111)
 *
 * Validates that agent configuration files exist and are properly structured.
 * Checks .claude/agents/ for valid agent definitions.
 *
 * Usage:
 *   validate-agent-sync                # Validate agent configuration
 *
 * Exit codes:
 *   0 - Agent configuration valid
 *   1 - Validation errors found
 *
 * @see {@link .claude/agents/} - Agent definitions
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FILE_SYSTEM, EMOJI } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[validate-agent-sync]';

/**
 * Validation result for agent sync
 */
export interface AgentSyncValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  agents: string[];
}

/**
 * Validate agent sync state
 *
 * @param options - Validation options
 * @param options.cwd - Working directory (default: process.cwd())
 * @returns Validation result
 */
export async function validateAgentSync(
  options: { cwd?: string } = {},
): Promise<AgentSyncValidationResult> {
  const { cwd = process.cwd() } = options;
  const errors: string[] = [];
  const warnings: string[] = [];
  const agents: string[] = [];

  const agentDir = path.join(cwd, '.claude', 'agents');

  // Check if agents directory exists
  if (!existsSync(agentDir)) {
    errors.push(`Agents directory not found: ${agentDir}`);
    return { valid: false, errors, warnings, agents };
  }

  // Read agent definitions
  const files = readdirSync(agentDir).filter((f) => f.endsWith('.json') || f.endsWith('.md'));

  if (files.length === 0) {
    warnings.push('No agent definitions found in .claude/agents/');
    return { valid: true, errors, warnings, agents };
  }

  for (const file of files) {
    const filePath = path.join(agentDir, file);
    const agentName = path.basename(file, path.extname(file));
    agents.push(agentName);

    if (file.endsWith('.json')) {
      // Validate JSON agent definition
      try {
        const content = readFileSync(filePath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
        const agentDef = JSON.parse(content);

        // Check required fields
        if (!agentDef.name) {
          warnings.push(`${agentName}: Missing "name" field`);
        }
        if (!agentDef.description) {
          warnings.push(`${agentName}: Missing "description" field`);
        }
      } catch (e) {
        errors.push(`${agentName}: Failed to parse JSON: ${e.message}`);
      }
    } else if (file.endsWith('.md')) {
      // Validate markdown agent definition
      try {
        const content = readFileSync(filePath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });

        // Check for title
        if (!content.includes('# ')) {
          warnings.push(`${agentName}: Missing title heading`);
        }

        // Check for minimum content
        if (content.length < 50) {
          warnings.push(`${agentName}: Agent definition is very short`);
        }
      } catch (e) {
        errors.push(`${agentName}: Failed to read file: ${e.message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    agents,
  };
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let cwd = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cwd' || arg === '-C') {
      cwd = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validate-agent-sync [options]

Validate agent configuration and sync state.

Options:
  --cwd, -C DIR  Working directory (default: current directory)
  -h, --help     Show this help message

Examples:
  validate-agent-sync
  validate-agent-sync --cwd /path/to/project
`);
      process.exit(0);
    }
  }

  console.log(`${LOG_PREFIX} Validating agent sync...`);

  const result = await validateAgentSync({ cwd });

  if (result.errors.length > 0) {
    console.log(`${EMOJI.FAILURE} Validation errors:`);
    result.errors.forEach((e) => console.log(`  ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log(`${EMOJI.WARNING} Warnings:`);
    result.warnings.forEach((w) => console.log(`  ${w}`));
  }

  if (result.agents.length > 0) {
    console.log(`${LOG_PREFIX} Found ${result.agents.length} agent(s):`);
    result.agents.forEach((a) => console.log(`  - ${a}`));
  }

  if (result.valid) {
    console.log(`${EMOJI.SUCCESS} Agent sync validation passed`);
  } else {
    process.exit(1);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
