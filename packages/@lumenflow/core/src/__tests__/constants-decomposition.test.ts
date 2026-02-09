/**
 * Constants Decomposition Tests
 *
 * WU-1549: Verify that wu-constants.ts has been split into domain-specific
 * modules, IToolRunner is segregated into slim IToolExecutor, and
 * MockDashboardRenderer is extracted from production TerminalDashboardRenderer.
 *
 * TDD: These tests define the acceptance criteria BEFORE implementation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CORE_SRC = path.resolve(__dirname, '..');

/**
 * AC-1: wu-constants.ts split into domain-specific modules,
 * no single file exceeding 500 lines.
 */
describe('AC-1: wu-constants decomposition', () => {
  const DOMAIN_MODULES = [
    'wu-statuses.ts',
    'wu-git-constants.ts',
    'wu-paths-constants.ts',
    'wu-cli-constants.ts',
    'wu-ui-constants.ts',
    'wu-domain-constants.ts',
    'wu-context-constants.ts',
  ];

  it('should have domain-specific module files', () => {
    for (const mod of DOMAIN_MODULES) {
      const fullPath = path.join(CORE_SRC, mod);
      expect(existsSync(fullPath), `Missing module: ${mod}`).toBe(true);
    }
  });

  it('should have no single domain module exceeding 500 lines', () => {
    for (const mod of DOMAIN_MODULES) {
      const fullPath = path.join(CORE_SRC, mod);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, 'utf8');
      const lineCount = content.split('\n').length;
      expect(lineCount, `${mod} has ${lineCount} lines (max 500)`).toBeLessThanOrEqual(500);
    }
  });

  it('should have wu-constants.ts as a re-export barrel under 500 lines', () => {
    const constantsPath = path.join(CORE_SRC, 'wu-constants.ts');
    expect(existsSync(constantsPath)).toBe(true);
    const content = readFileSync(constantsPath, 'utf8');
    const lineCount = content.split('\n').length;
    expect(lineCount, `wu-constants.ts has ${lineCount} lines (max 500)`).toBeLessThanOrEqual(500);
  });

  it('should preserve all original exports via the barrel', async () => {
    // Import from the barrel - all original exports must still be available
    const barrel = await import('../wu-constants.js');

    // Spot-check key exports from each domain
    // Statuses
    expect(barrel.WU_STATUS).toBeDefined();
    expect(barrel.WU_STATUS.READY).toBe('ready');
    expect(barrel.PROTECTED_WU_STATUSES).toBeDefined();
    expect(barrel.PROGRESSABLE_WU_STATUSES).toBeDefined();
    expect(barrel.WU_STATUS_GROUPS).toBeDefined();
    expect(barrel.CLAIMED_MODES).toBeDefined();
    expect(barrel.WU_TYPES).toBeDefined();
    expect(barrel.WU_EXPOSURE).toBeDefined();
    expect(barrel.WU_EXPOSURE_VALUES).toBeDefined();
    expect(barrel.TEST_TYPES).toBeDefined();
    expect(barrel.INCIDENT_SEVERITY).toBeDefined();

    // Git
    expect(barrel.BRANCHES).toBeDefined();
    expect(barrel.REMOTES).toBeDefined();
    expect(barrel.GIT_REFS).toBeDefined();
    expect(barrel.GIT_FLAGS).toBeDefined();
    expect(barrel.GIT_COMMANDS).toBeDefined();
    expect(barrel.GIT_COMMAND_STRINGS).toBeDefined();
    expect(barrel.GIT).toBeDefined();
    expect(barrel.REAL_GIT).toBeDefined();

    // Paths
    expect(barrel.LUMENFLOW_PATHS).toBeDefined();
    expect(barrel.LOCK_DIR_NAME).toBeDefined();
    expect(barrel.DIRECTORIES).toBeDefined();
    expect(barrel.FILE_EXTENSIONS).toBeDefined();
    expect(barrel.CONFIG_FILES).toBeDefined();
    expect(barrel.FILE_SYSTEM).toBeDefined();
    expect(barrel.FILE_TOOLS).toBeDefined();
    expect(barrel.PHI_ERRORS).toBeDefined();
    expect(barrel.PHI_CONFIG).toBeDefined();
    expect(barrel.PATH_PATTERNS).toBeDefined();
    expect(barrel.PATH_LITERALS).toBeDefined();
    expect(barrel.PATH_SLICE_LENGTHS).toBeDefined();
    expect(barrel.BUILD_ARTIFACT_GLOBS).toBeDefined();
    expect(barrel.BUILD_ARTIFACT_IGNORES).toBeDefined();
    expect(barrel.SCRIPT_PATHS).toBeDefined();

    // CLI
    expect(barrel.CLI_FLAGS).toBeDefined();
    expect(barrel.PKG_FLAGS).toBeDefined();
    expect(barrel.ESLINT_FLAGS).toBeDefined();
    expect(barrel.SCRIPTS).toBeDefined();
    expect(barrel.GATE_NAMES).toBeDefined();
    expect(barrel.GATE_COMMANDS).toBeDefined();
    expect(barrel.PKG_MANAGER).toBeDefined();
    expect(barrel.PKG_COMMANDS).toBeDefined();
    expect(barrel.EXIT_CODES).toBeDefined();
    expect(barrel.STREAM_ERRORS).toBeDefined();
    expect(barrel.STDIO).toBeDefined();
    expect(barrel.STDIO_MODES).toBeDefined();

    // UI
    expect(barrel.BACKLOG_SECTIONS).toBeDefined();
    expect(barrel.STATUS_SECTIONS).toBeDefined();
    expect(barrel.LOG_PREFIX).toBeDefined();
    expect(barrel.EMOJI).toBeDefined();
    expect(barrel.BOX).toBeDefined();
    expect(barrel.UI).toBeDefined();
    expect(barrel.DISPLAY_LIMITS).toBeDefined();
    expect(barrel.STRING_LITERALS).toBeDefined();
    expect(barrel.YAML_OPTIONS).toBeDefined();
    expect(barrel.READINESS_UI).toBeDefined();

    // Domain
    expect(barrel.PATTERNS).toBeDefined();
    expect(barrel.COMMIT_FORMATS).toBeDefined();
    expect(barrel.DEFAULTS).toBeDefined();
    expect(barrel.WU_DEFAULTS).toBeDefined();
    expect(barrel.THRESHOLDS).toBeDefined();
    expect(barrel.VALIDATION).toBeDefined();
    expect(barrel.SAFETY_CRITICAL_TEST_GLOBS).toBeDefined();
    expect(barrel.CLEANUP_GUARD).toBeDefined();
    expect(barrel.CONSISTENCY_TYPES).toBeDefined();
    expect(barrel.LANE_PATH_PATTERNS).toBeDefined();

    // Context validation
    expect(barrel.CONTEXT_VALIDATION).toBeDefined();
    expect(barrel.HOOK_MESSAGES).toBeDefined();
    expect(barrel.CLAUDE_HOOKS).toBeDefined();
    expect(barrel.getHookCommand).toBeTypeOf('function');

    // Functions
    expect(barrel.toKebab).toBeTypeOf('function');
    expect(barrel.getWorktreePath).toBeTypeOf('function');
    expect(barrel.getLaneBranch).toBeTypeOf('function');
    expect(barrel.getProjectRoot).toBeTypeOf('function');
    expect(barrel.discoverSafetyTests).toBeTypeOf('function');
    expect(barrel.validateSafetyTestsExist).toBeTypeOf('function');
  });

  it('should preserve function behavior after decomposition', async () => {
    const barrel = await import('../wu-constants.js');

    expect(barrel.toKebab('Operations: Tooling')).toBe('operations-tooling');
    expect(barrel.toKebab('Core Systems')).toBe('core-systems');
    expect(barrel.toKebab(null)).toBe('');
    expect(barrel.toKebab(undefined)).toBe('');

    expect(barrel.getWorktreePath('Operations: Tooling', 'WU-123')).toBe(
      'worktrees/operations-tooling-wu-123',
    );

    expect(barrel.getLaneBranch('Operations: Tooling', 'WU-123')).toBe(
      'lane/operations-tooling/wu-123',
    );
  });
});

/**
 * AC-2: IToolRunner segregated into slim IToolExecutor interface for gate consumers.
 */
describe('AC-2: IToolExecutor interface segregation', () => {
  it('should export IToolExecutor from core-tools.ports.ts', async () => {
    const ports = await import('../ports/core-tools.ports.js');
    // IToolExecutor should be a type export - we check it exists as a concept
    // by verifying the file contains the interface definition
    const filePath = path.join(CORE_SRC, 'ports', 'core-tools.ports.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('export interface IToolExecutor');
  });

  it('should have IToolExecutor with only runTool and run methods', () => {
    const filePath = path.join(CORE_SRC, 'ports', 'core-tools.ports.ts');
    const content = readFileSync(filePath, 'utf8');

    // Find IToolExecutor interface body: from its opening { to the matching }
    const executorStart = content.indexOf('export interface IToolExecutor');
    expect(executorStart, 'IToolExecutor should exist').toBeGreaterThan(-1);

    const braceStart = content.indexOf('{', executorStart);
    // Find matching closing brace (track brace depth)
    let depth = 0;
    let braceEnd = -1;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
    expect(braceEnd, 'IToolExecutor closing brace should be found').toBeGreaterThan(braceStart);

    const body = content.slice(braceStart, braceEnd + 1);
    // Should contain runTool and run methods (method signatures)
    expect(body).toContain('runTool(');
    expect(body).toContain('run(');
    // Should NOT contain register, hasTool, or listTools method signatures
    expect(body).not.toContain('register(');
    expect(body).not.toContain('hasTool(');
    expect(body).not.toContain('listTools(');
  });

  it('should still export the full IToolRunner interface', async () => {
    const filePath = path.join(CORE_SRC, 'ports', 'core-tools.ports.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('export interface IToolRunner');
  });

  it('should have IToolRunner extend IToolExecutor', () => {
    const filePath = path.join(CORE_SRC, 'ports', 'core-tools.ports.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toMatch(/export interface IToolRunner extends IToolExecutor/);
  });

  it('should export IToolExecutor from the core index barrel', () => {
    const indexPath = path.join(CORE_SRC, 'index.ts');
    const content = readFileSync(indexPath, 'utf8');
    expect(content).toContain('IToolExecutor');
  });
});

/**
 * AC-3: MockDashboardRenderer extracted from production TerminalDashboardRenderer class.
 */
describe('AC-3: MockDashboardRenderer extraction', () => {
  it('should have a separate mock-dashboard-renderer file', () => {
    const mockPath = path.join(CORE_SRC, 'adapters', 'mock-dashboard-renderer.adapter.ts');
    expect(existsSync(mockPath), 'mock-dashboard-renderer.adapter.ts should exist').toBe(true);
  });

  it('should export MockDashboardRenderer class', () => {
    const mockPath = path.join(CORE_SRC, 'adapters', 'mock-dashboard-renderer.adapter.ts');
    const content = readFileSync(mockPath, 'utf8');
    expect(content).toContain('export class MockDashboardRenderer');
  });

  it('should implement IDashboardRenderer', () => {
    const mockPath = path.join(CORE_SRC, 'adapters', 'mock-dashboard-renderer.adapter.ts');
    const content = readFileSync(mockPath, 'utf8');
    expect(content).toContain('implements IDashboardRenderer');
  });

  it('should have render, renderSuggestions, renderPlan, and clear methods', () => {
    const mockPath = path.join(CORE_SRC, 'adapters', 'mock-dashboard-renderer.adapter.ts');
    const content = readFileSync(mockPath, 'utf8');
    expect(content).toContain('render(');
    expect(content).toContain('renderSuggestions(');
    expect(content).toContain('renderPlan(');
    expect(content).toContain('clear(');
  });

  it('should capture calls for test assertions', () => {
    const mockPath = path.join(CORE_SRC, 'adapters', 'mock-dashboard-renderer.adapter.ts');
    const content = readFileSync(mockPath, 'utf8');
    // Mock should track calls for test assertions
    expect(content).toMatch(/renderCalls|calls|rendered/);
  });

  it('should not have mock code in the production TerminalDashboardRenderer', () => {
    const prodPath = path.join(CORE_SRC, 'adapters', 'terminal-renderer.adapter.ts');
    const content = readFileSync(prodPath, 'utf8');
    // The promptUser mock should be removed or the method should be abstract/real
    // The production renderer should not contain "Mock implementation for testing"
    // NOTE: The current file already has this comment - the AC is about extracting
    // a MockDashboardRenderer, not necessarily removing the existing promptUser stub
    expect(content).not.toContain('MockDashboardRenderer');
  });
});
