/**
 * @file literal-governance.test.ts
 * @description Guardrail ratchet test: blocks new duplicate governance literals in MCP tool modules.
 *
 * Governed families:
 * 1. CLI command names (strings passed to runCliCommand/executeViaPack/fallback.command)
 * 2. Shared CLI flag tokens used in 3+ tool definitions
 * 3. Cross-boundary metadata keys (e.g., 'project_root')
 *
 * Scoping rule: CLI flags appearing in fewer than 3 tool definitions remain as
 * local literals and are NOT governed by this test.
 *
 * Allowlist: Constants definition files (mcp-constants.ts, tools-shared.ts) are
 * excluded from scanning. Test files may assert literal values.
 *
 * WU-1851: Initial implementation of governance ratchet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { CliCommands, MetadataKeys } from '../mcp-constants.js';

const SRC_DIR = path.resolve(import.meta.dirname, '..');

/**
 * Files excluded from governance scanning.
 * Constants definition files define the governed constants themselves.
 */
const EXCLUDED_FILES = new Set([
  'tools/runtime-task-constants.ts',
]);

/**
 * Auto-discovers MCP tool implementation files subject to governance scanning.
 *
 * Discovers all .ts files in tools/ (excluding constants, test, and type-only files)
 * plus the runtime-tool-resolver.ts which contains tool execution logic.
 *
 * This replaces the previous static GOVERNED_FILES list so that new tool files
 * added to tools/ are automatically governed without manual list maintenance.
 */
function discoverGovernedFiles(): string[] {
  const toolsDir = path.join(SRC_DIR, 'tools');
  const files: string[] = [];

  // Auto-discover all tool implementation files in tools/
  if (fs.existsSync(toolsDir)) {
    for (const entry of fs.readdirSync(toolsDir)) {
      if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.d.ts') &&
        !entry.endsWith('.test.ts')
      ) {
        const relPath = `tools/${entry}`;
        if (!EXCLUDED_FILES.has(relPath)) {
          files.push(relPath);
        }
      }
    }
  }

  // Include runtime-tool-resolver.ts (top-level file with tool execution logic)
  const runtimeResolver = 'runtime-tool-resolver.ts';
  if (fs.existsSync(path.join(SRC_DIR, runtimeResolver))) {
    files.push(runtimeResolver);
  }

  return files.sort();
}

const GOVERNED_FILES = discoverGovernedFiles();

/**
 * Regex matching raw CLI command-name strings in execution call sites.
 *
 * Matches patterns like:
 *   runCliCommand('wu:status', ...)
 *   executeViaPack('backlog:prune', ...)
 *   command: 'state:cleanup'
 *   command: 'gates'
 *
 * Does NOT match:
 *   CliCommands.WU_STATUS (constant reference — desired state)
 *   'Some description text' (not in call position)
 */
const COMMAND_CALL_PATTERN =
  /(?:runCliCommand|executeViaPack)\(\s*['"]([a-z][a-z0-9]*(?::[a-z-]+)?)['"]/g;
const FALLBACK_COMMAND_PATTERN = /command:\s*['"]([a-z][a-z0-9]*(?::[a-z-]+)?)['"]/g;
const DECLARATION_ASSIGNMENT_PATTERN =
  /(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*['"]([^'"]+)['"]/g;
const CONST_MAP_VALUE_PATTERN = /^\s*[A-Z][A-Z0-9_]*:\s*['"]([^'"]+)['"](?:\s*,)?/g;

/**
 * Shared flag tokens governed by the 3+ tool threshold rule.
 * Any raw occurrence of these strings as `args.push('--xxx')` in tool files
 * should use a constant from CliArgs or CliFlags instead.
 *
 * Flags NOT in this list are tool-local and remain as raw literals.
 */
const GOVERNED_FLAGS = [
  '--json',
  '--force',
  '--verbose',
  '--quiet',
  '--execute',
  '--id',
  '--lane',
  '--reason',
  '--path',
  '--format',
  '--since',
  '--status',
] as const;

/**
 * Regex matching raw governed flag literals in args.push() or array literal positions.
 * Matches: args.push('--json') or ['--id', ...]
 * Does NOT match: CliArgs.JSON or CliFlags.FORCE
 */
function buildFlagPattern(flags: readonly string[]): RegExp {
  const escaped = flags.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`['"](?:${escaped.join('|')})['"]`, 'g');
}

const FLAG_PATTERN = buildFlagPattern(GOVERNED_FLAGS);

/**
 * Metadata key literals that cross module boundaries and must be centralized.
 */
const GOVERNED_METADATA_KEYS = [MetadataKeys.PROJECT_ROOT, MetadataKeys.INVOCATION_MODE] as const;
const GOVERNED_COMMANDS = Object.values(CliCommands);

function buildMetadataPattern(keys: readonly string[]): RegExp {
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`['"](?:${escaped.join('|')})['"]`, 'g');
}

const METADATA_PATTERN = buildMetadataPattern(GOVERNED_METADATA_KEYS);

/**
 * Explicit allowlist for legitimate raw-literal exceptions.
 * Each entry maps a file path (relative to src/) to an array of allowed literal values.
 * Keep this list minimal — every entry should have a documented justification.
 */
const ALLOWLIST: Record<string, Record<string, string>> = {};

interface Violation {
  file: string;
  line: number;
  literal: string;
  family: 'command' | 'flag' | 'metadata-key';
}

function scanFile(
  relPath: string,
  content: string,
  allowlist: Record<string, Record<string, string>> = ALLOWLIST,
): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');
  const allowedLiterals = allowlist[relPath] ?? {};
  const isAllowed = (literal: string) => Object.hasOwn(allowedLiterals, literal);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments and JSDoc
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Skip .describe() strings (Zod schema descriptions)
    if (line.includes('.describe(')) {
      continue;
    }

    // Scan for raw command names in execution calls
    for (const match of line.matchAll(COMMAND_CALL_PATTERN)) {
      const literal = match[1];
      if (GOVERNED_COMMANDS.includes(literal) && !isAllowed(literal)) {
        violations.push({ file: relPath, line: lineNum, literal, family: 'command' });
      }
    }

    // Scan for raw command names in fallback.command properties
    for (const match of line.matchAll(FALLBACK_COMMAND_PATTERN)) {
      const literal = match[1];
      if (GOVERNED_COMMANDS.includes(literal) && !isAllowed(literal)) {
        violations.push({ file: relPath, line: lineNum, literal, family: 'command' });
      }
    }

    // Scan for raw command names in const declarations
    for (const match of line.matchAll(DECLARATION_ASSIGNMENT_PATTERN)) {
      const literal = match[1];
      if (GOVERNED_COMMANDS.includes(literal) && !isAllowed(literal)) {
        violations.push({ file: relPath, line: lineNum, literal, family: 'command' });
      }
    }

    // Scan for raw command names in uppercase const-map values (e.g., FOO: 'wu:status')
    for (const match of line.matchAll(CONST_MAP_VALUE_PATTERN)) {
      const literal = match[1];
      if (GOVERNED_COMMANDS.includes(literal) && !isAllowed(literal)) {
        violations.push({ file: relPath, line: lineNum, literal, family: 'command' });
      }
    }

    // Scan for raw governed flag literals
    for (const match of line.matchAll(FLAG_PATTERN)) {
      const literal = match[0].slice(1, -1); // Remove quotes
      // Skip if this is already using a constant (CliArgs.XXX or CliFlags.XXX)
      if (line.includes('CliArgs.') || line.includes('CliFlags.')) {
        continue;
      }
      if (!isAllowed(literal)) {
        violations.push({ file: relPath, line: lineNum, literal, family: 'flag' });
      }
    }

    // Scan for raw metadata key literals
    for (const match of line.matchAll(METADATA_PATTERN)) {
      const literal = match[0].slice(1, -1);
      // Skip if already using a constant reference
      if (line.includes('MetadataKeys.')) {
        continue;
      }
      if (!isAllowed(literal)) {
        violations.push({ file: relPath, line: lineNum, literal, family: 'metadata-key' });
      }
    }
  }

  return violations;
}

describe('MCP literal governance', () => {
  it('detects declaration-level command literal violations', () => {
    const content = "const TOOL = 'wu:status';\nconst other = 'not-governed';\n";
    const violations = scanFile('synthetic.ts', content);
    expect(
      violations.some((entry) => entry.family === 'command' && entry.literal === 'wu:status'),
    ).toBe(true);
  });

  it('respects explicit allowlist exceptions with rationale', () => {
    const content = "const TOOL = 'wu:status';\n";
    const allowlist = {
      'synthetic.ts': {
        'wu:status': 'Allowed for this test to verify allowlist behavior',
      },
    };
    const violations = scanFile('synthetic.ts', content, allowlist);
    expect(violations).toEqual([]);
  });

  it('should not contain raw CLI command-name literals in governed tool files', () => {
    const allViolations: Violation[] = [];

    for (const relPath of GOVERNED_FILES) {
      const absPath = path.join(SRC_DIR, relPath);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf-8');
      const violations = scanFile(relPath, content).filter((v) => v.family === 'command');
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .map((v) => `  ${v.file}:${v.line} — raw command literal '${v.literal}'`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} raw command-name literal(s) in governed files.\n` +
          `Use CliCommands.XXX constants from mcp-constants.ts instead.\n\n${summary}`,
      );
    }
  });

  it('should not contain raw governed flag literals in tool files', () => {
    const allViolations: Violation[] = [];

    for (const relPath of GOVERNED_FILES) {
      const absPath = path.join(SRC_DIR, relPath);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf-8');
      const violations = scanFile(relPath, content).filter((v) => v.family === 'flag');
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .map((v) => `  ${v.file}:${v.line} — raw flag literal '${v.literal}'`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} raw governed flag literal(s) in governed files.\n` +
          `Use CliArgs.XXX or CliFlags.XXX constants from tools-shared.ts instead.\n` +
          `(Only flags in 3+ tool definitions are governed; tool-local flags are allowed.)\n\n${summary}`,
      );
    }
  });

  it('should not contain raw metadata-key literals in tool files', () => {
    const allViolations: Violation[] = [];

    for (const relPath of GOVERNED_FILES) {
      const absPath = path.join(SRC_DIR, relPath);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf-8');
      const violations = scanFile(relPath, content).filter((v) => v.family === 'metadata-key');
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .map((v) => `  ${v.file}:${v.line} — raw metadata-key literal '${v.literal}'`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} raw metadata-key literal(s) in governed files.\n` +
          `Use MetadataKeys.XXX constants from mcp-constants.ts instead.\n\n${summary}`,
      );
    }
  });

  it('should have all governed files present on disk', () => {
    const missing: string[] = [];
    for (const relPath of GOVERNED_FILES) {
      const absPath = path.join(SRC_DIR, relPath);
      if (!fs.existsSync(absPath)) {
        missing.push(relPath);
      }
    }
    expect(missing).toEqual([]);
  });

  it('auto-discovers new tool files without needing a static list update', () => {
    // Verify that auto-discovery found a reasonable number of files.
    // The previous static list had 11 files; discovery should find at least that many.
    expect(GOVERNED_FILES.length).toBeGreaterThanOrEqual(11);

    // Verify all files actually exist
    for (const relPath of GOVERNED_FILES) {
      const absPath = path.join(SRC_DIR, relPath);
      expect(fs.existsSync(absPath)).toBe(true);
    }
  });
});
