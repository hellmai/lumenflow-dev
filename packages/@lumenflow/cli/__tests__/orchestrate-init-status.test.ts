/**
 * Orchestrate Init Status CLI Wiring Tests (WU-1340)
 *
 * Verifies orchestrate:init-status uses policy-aware lane availability helpers.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const STATUS_PATH = path.join(__dirname, '..', 'src', 'orchestrate-init-status.ts');

describe('orchestrate:init-status wiring (WU-1340)', () => {
  it('uses getLaneAvailability for policy-aware availability', () => {
    const content = fs.readFileSync(STATUS_PATH, 'utf-8');

    expect(content).toContain('getLaneAvailability');
    expect(content).toContain('resolveLaneConfigsFromConfig');
  });

  it('prints lane availability section', () => {
    const content = fs.readFileSync(STATUS_PATH, 'utf-8');

    expect(content).toContain('Lane Availability');
  });

  it('reports lifecycle status from initiative metadata', () => {
    const content = fs.readFileSync(STATUS_PATH, 'utf-8');

    expect(content).toContain('Lifecycle Status');
    expect(content).toContain('initiative.status');
    expect(content).toContain('phase');
  });
});
