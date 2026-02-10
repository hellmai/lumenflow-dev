#!/usr/bin/env node
/**
 * @file validate-agent-skills.ts
 * @description Validates agent skill definitions (WU-1111)
 *
 * Validates that skill files in .claude/skills/ follow the expected format
 * and contain required sections.
 *
 * Usage:
 *   validate-agent-skills                    # Validate all skills
 *   validate-agent-skills --skill wu-lifecycle  # Validate specific skill
 *
 * Exit codes:
 *   0 - All skills valid
 *   1 - Validation errors found
 *
 * @see {@link .claude/skills/} - Skill definitions
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { FILE_SYSTEM, EMOJI } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[validate-agent-skills]';

/**
 * Required sections in a skill file
 */
const REQUIRED_SECTIONS = ['When to Use'];

/**
 * Recommended sections (produce warnings if missing)
 */
const RECOMMENDED_SECTIONS = ['Examples', 'Key Concepts', 'Core Concepts'];

/**
 * Validation result for a skill
 */
export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validation summary for all skills
 */
export interface SkillValidationSummary {
  totalValid: number;
  totalInvalid: number;
  results: Array<{ skillName: string } & SkillValidationResult>;
}

/**
 * Validate a single skill file
 *
 * @param skillPath - Path to SKILL.md file
 * @returns Validation result
 */
export function validateSkillFile(skillPath: string): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(skillPath)) {
    errors.push(`Skill file not found: ${skillPath}`);
    return { valid: false, errors, warnings };
  }

  const content = readFileSync(skillPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split('\n');

  // Check for title heading
  const hasTitle = lines.some((line) => line.startsWith('# '));
  if (!hasTitle) {
    errors.push('Missing title heading (# Skill Name)');
  }

  // Check for required sections
  for (const section of REQUIRED_SECTIONS) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- section name from internal constant array, not user input
    const sectionPattern = new RegExp(`^##\\s+${section}`, 'im');
    if (!sectionPattern.test(content)) {
      errors.push(`Missing required section: "## ${section}"`);
    }
  }

  // Check for recommended sections
  for (const section of RECOMMENDED_SECTIONS) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- section name from internal constant array, not user input
    const sectionPattern = new RegExp(`^##\\s+${section}`, 'im');
    if (!sectionPattern.test(content)) {
      warnings.push(`Missing recommended section: "## ${section}"`);
    }
  }

  // Check for minimum content
  if (content.length < 100) {
    warnings.push('Skill content is very short (< 100 characters)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all skills in a directory
 *
 * @param skillsDir - Path to skills directory
 * @returns Validation summary
 */
export function validateAllSkills(skillsDir: string): SkillValidationSummary {
  const results: Array<{ skillName: string } & SkillValidationResult> = [];
  let totalValid = 0;
  let totalInvalid = 0;

  if (!existsSync(skillsDir)) {
    return {
      totalValid: 0,
      totalInvalid: 1,
      results: [
        {
          skillName: 'DIRECTORY',
          valid: false,
          errors: [`Skills directory not found: ${skillsDir}`],
          warnings: [],
        },
      ],
    };
  }

  const entries = readdirSync(skillsDir);

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry);
    const stat = statSync(entryPath);

    if (!stat.isDirectory()) {
      continue;
    }

    // Check for SKILL.md in the skill directory
    const skillFile = path.join(entryPath, 'SKILL.md');
    if (!existsSync(skillFile)) {
      results.push({
        skillName: entry,
        valid: false,
        errors: [`Missing SKILL.md in ${entry}/`],
        warnings: [],
      });
      totalInvalid++;
      continue;
    }

    const result = validateSkillFile(skillFile);
    results.push({ skillName: entry, ...result });

    if (result.valid) {
      totalValid++;
    } else {
      totalInvalid++;
    }
  }

  return { totalValid, totalInvalid, results };
}

/**
 * Get default skills directory based on cwd
 */
function getDefaultSkillsDir(): string {
  return path.join(process.cwd(), '.claude', 'skills');
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let skillName: string | undefined;
  let skillsDir = getDefaultSkillsDir();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--skill' || arg === '-s') {
      skillName = args[++i];
    } else if (arg === '--dir' || arg === '-d') {
      skillsDir = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validate-agent-skills [options]

Validate agent skill definitions.

Options:
  --skill, -s NAME  Validate specific skill
  --dir, -d DIR     Skills directory (default: .claude/skills)
  -h, --help        Show this help message

Examples:
  validate-agent-skills                    # Validate all skills
  validate-agent-skills --skill wu-lifecycle  # Validate specific skill
`);
      process.exit(0);
    }
  }

  if (skillName) {
    // Validate specific skill
    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
    console.log(`${LOG_PREFIX} Validating skill: ${skillName}...`);

    const result = validateSkillFile(skillPath);

    if (result.errors.length > 0) {
      console.log(`${EMOJI.FAILURE} Validation failed:`);
      result.errors.forEach((e) => console.log(`  ${e}`));
    }

    if (result.warnings.length > 0) {
      console.log(`${EMOJI.WARNING} Warnings:`);
      result.warnings.forEach((w) => console.log(`  ${w}`));
    }

    if (result.valid) {
      console.log(`${EMOJI.SUCCESS} ${skillName} is valid`);
    } else {
      process.exit(1);
    }
  } else {
    // Validate all skills
    console.log(`${LOG_PREFIX} Validating all skills in ${skillsDir}...`);

    const { totalValid, totalInvalid, results } = validateAllSkills(skillsDir);

    // Print results
    for (const result of results) {
      if (result.errors.length > 0) {
        console.log(`${EMOJI.FAILURE} ${result.skillName}:`);
        result.errors.forEach((e) => console.log(`    ${e}`));
      }
      if (result.warnings.length > 0) {
        console.log(`${EMOJI.WARNING} ${result.skillName}: ${result.warnings.length} warning(s)`);
      }
    }

    console.log('');
    console.log(`${LOG_PREFIX} Summary:`);
    console.log(`  ${EMOJI.SUCCESS} Valid: ${totalValid}`);
    console.log(`  ${EMOJI.FAILURE} Invalid: ${totalInvalid}`);

    if (totalInvalid > 0) {
      process.exit(1);
    }
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
