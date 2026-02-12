/**
 * Orchestrate Initiative CLI Wiring Tests (WU-1340)
 *
 * Verifies orchestrate-initiative uses policy-aware scheduling helpers.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ORCHESTRATE_PATH = path.join(__dirname, '..', 'src', 'orchestrate-initiative.ts');

describe('orchestrate-initiative wiring (WU-1340)', () => {
  it('uses buildExecutionPlanWithLockPolicy for policy-aware scheduling', () => {
    const content = fs.readFileSync(ORCHESTRATE_PATH, 'utf-8');

    expect(content).toContain('buildExecutionPlanWithLockPolicy');
    expect(content).not.toContain('buildExecutionPlanAsync(');
  });

  it('derives lane configs from config', () => {
    const content = fs.readFileSync(ORCHESTRATE_PATH, 'utf-8');

    expect(content).toContain('resolveLaneConfigsFromConfig');
    expect(content).toContain('getConfig(');
  });

  it('guides manual execution with explicit brief/delegate semantics', () => {
    const content = fs.readFileSync(ORCHESTRATE_PATH, 'utf-8');

    expect(content).toContain('pnpm wu:brief --id <WU-ID> --client claude-code');
    expect(content).toContain(
      'pnpm wu:delegate --id <WU-ID> --parent-wu <PARENT-WU-ID> --client claude-code',
    );
  });
});
