#!/usr/bin/env node
/**
 * @file validate-skills-spec.ts
 * @description Validates skills spec format (WU-1111)
 *
 * Validates that skill specification files follow the required format
 * with proper sections and structure.
 *
 * Usage:
 *   validate-skills-spec SKILL.md          # Validate specific file
 *   validate-skills-spec --dir ./skills    # Validate all in directory
 *
 * Exit codes:
 *   0 - Validation passed
 *   1 - Validation errors found
 *
 * @see {@link .claude/skills/} - Skill definitions
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { FILE_SYSTEM, EMOJI } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';

const LOG_PREFIX = '[validate-skills-spec]';

/**
 * Required sections for a valid skill spec
 */
const REQUIRED_SECTIONS = ['When to Use'];

/**
 * Recommended sections (produce warnings if missing)
 */
const RECOMMENDED_SECTIONS = ['Examples'];

/**
 * Validation result for a skill spec
 */
export interface SkillsSpecResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a skill specification file
 *
 * @param skillPath - Path to skill spec file
 * @returns Validation result
 */
export function validateSkillsSpec(skillPath: string): SkillsSpecResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(skillPath)) {
    errors.push(`Skill file not found: ${skillPath}`);
    return { valid: false, errors, warnings };
  }

  const content = readFileSync(skillPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  const lines = content.split('\n');

  // Check for title heading (# Title)
  const hasTitle = lines.some((line) => /^#\s+\S/.test(line));
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

  // Check "When to Use" section has content
  const whenToUseMatch = content.match(/##\s+When to Use\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (whenToUseMatch) {
    const sectionContent = whenToUseMatch[1].trim();
    if (sectionContent.length < 20) {
      warnings.push('"When to Use" section has minimal content');
    }
  }

  // Check for minimum overall content
  if (content.length < 100) {
    warnings.push('Skill spec is very short (< 100 characters)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all skill specs in a directory
 *
 * @param dir - Directory to scan
 * @returns Map of file path to validation result
 */
export function validateSkillsSpecDir(dir: string): Map<string, SkillsSpecResult> {
  const results = new Map<string, SkillsSpecResult>();

  if (!existsSync(dir)) {
    results.set(dir, {
      valid: false,
      errors: [`Directory not found: ${dir}`],
      warnings: [],
    });
    return results;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      // Check for SKILL.md in subdirectory
      const skillFile = path.join(entryPath, 'SKILL.md');
      if (existsSync(skillFile)) {
        results.set(entry, validateSkillsSpec(skillFile));
      }
    } else if (entry.endsWith('.md')) {
      results.set(entry, validateSkillsSpec(entryPath));
    }
  }

  return results;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let skillPath: string | undefined;
  let dir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir' || arg === '-d') {
      dir = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: validate-skills-spec [file.md] [options]

Validate skill specification format.

Options:
  --dir, -d DIR  Validate all specs in directory
  -h, --help     Show this help message

Examples:
  validate-skills-spec SKILL.md
  validate-skills-spec --dir .claude/skills
`);
      process.exit(0);
    } else if (!skillPath) {
      skillPath = arg;
    }
  }

  if (!skillPath && !dir) {
    console.error(`${LOG_PREFIX} Error: Provide a skill file or --dir option`);
    process.exit(1);
  }

  if (skillPath) {
    // Validate single file
    console.log(`${LOG_PREFIX} Validating ${skillPath}...`);

    const result = validateSkillsSpec(skillPath);

    if (result.errors.length > 0) {
      console.log(`${EMOJI.FAILURE} Validation failed:`);
      result.errors.forEach((e) => console.log(`  ${e}`));
    }

    if (result.warnings.length > 0) {
      console.log(`${EMOJI.WARNING} Warnings:`);
      result.warnings.forEach((w) => console.log(`  ${w}`));
    }

    if (result.valid) {
      console.log(`${EMOJI.SUCCESS} Skill spec is valid`);
    } else {
      process.exit(1);
    }
  } else if (dir) {
    // Validate directory
    console.log(`${LOG_PREFIX} Validating skills in ${dir}...`);

    const results = validateSkillsSpecDir(dir);
    let totalValid = 0;
    let totalInvalid = 0;

    for (const [name, result] of results) {
      if (result.errors.length > 0) {
        console.log(`${EMOJI.FAILURE} ${name}:`);
        result.errors.forEach((e) => console.log(`    ${e}`));
        totalInvalid++;
      } else {
        totalValid++;
      }

      if (result.warnings.length > 0) {
        console.log(`${EMOJI.WARNING} ${name}: ${result.warnings.length} warning(s)`);
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
  runCLI(main);
}
