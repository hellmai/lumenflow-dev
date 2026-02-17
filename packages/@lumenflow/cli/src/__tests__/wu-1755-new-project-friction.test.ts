/**
 * @file wu-1755-new-project-friction.test.ts
 * Tests for new-project friction fixes (WU-1755)
 *
 * F4: .gitignore template completeness
 * F9: Plan template auto-population from description
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GITIGNORE_TEMPLATE, PRETTIERIGNORE_TEMPLATE } from '../init-templates.js';

const TURBO_CACHE_ENTRY = '.turbo/';
const LUMENFLOW_FLOW_LOG = '.lumenflow/flow.log';
const LUMENFLOW_COMMANDS_LOG = '.lumenflow/commands.log';
const LUMENFLOW_SESSIONS = '.lumenflow/sessions/';
const LUMENFLOW_MEMORY = '.lumenflow/memory/';

describe('WU-1755: .gitignore template completeness (F4)', () => {
  it('should include .turbo/ in gitignore', () => {
    expect(GITIGNORE_TEMPLATE).toContain(TURBO_CACHE_ENTRY);
  });

  it('should include .lumenflow runtime files in gitignore', () => {
    expect(GITIGNORE_TEMPLATE).toContain(LUMENFLOW_FLOW_LOG);
    expect(GITIGNORE_TEMPLATE).toContain(LUMENFLOW_COMMANDS_LOG);
    expect(GITIGNORE_TEMPLATE).toContain(LUMENFLOW_SESSIONS);
    expect(GITIGNORE_TEMPLATE).toContain(LUMENFLOW_MEMORY);
  });

  it('should include .turbo/ in prettierignore', () => {
    expect(PRETTIERIGNORE_TEMPLATE).toContain(TURBO_CACHE_ENTRY);
  });
});

describe('WU-1755: Plan template auto-population from description (F9)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wu-1755-plan-test-'));
    // Set LUMENFLOW_HOME so createPlanTemplate writes to temp dir
    process.env.LUMENFLOW_HOME = tempDir;
  });

  afterEach(() => {
    delete process.env.LUMENFLOW_HOME;
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should populate Goal section from description when provided', async () => {
    const { createPlanTemplate } = await import('../wu-create-content.js');

    const planPath = createPlanTemplate('WU-TEST-1', 'Test Plan', {
      description: 'Context: test context. Problem: test problem. Solution: test solution.',
    });

    const content = readFileSync(planPath, 'utf-8');
    expect(content).toContain('test context');
    expect(content).toContain('test problem');
    expect(content).toContain('test solution');
  });

  it('should populate Success Criteria from acceptance when provided', async () => {
    const { createPlanTemplate } = await import('../wu-create-content.js');

    const planPath = createPlanTemplate('WU-TEST-2', 'Test Plan', {
      acceptance: ['Criterion A is met', 'Criterion B is validated'],
    });

    const content = readFileSync(planPath, 'utf-8');
    expect(content).toContain('Criterion A is met');
    expect(content).toContain('Criterion B is validated');
  });

  it('should still create empty template when no description/acceptance provided', async () => {
    const { createPlanTemplate } = await import('../wu-create-content.js');

    const planPath = createPlanTemplate('WU-TEST-3', 'Test Plan');

    const content = readFileSync(planPath, 'utf-8');
    expect(content).toContain('## Goal');
    expect(content).toContain('## Scope');
  });
});
