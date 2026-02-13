import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const STATUS_PATH = path.join(__dirname, '..', 'src', 'initiative-status.ts');

describe('initiative:status lifecycle wiring', () => {
  it('derives lifecycle status with phase coherence guard', () => {
    const content = fs.readFileSync(STATUS_PATH, 'utf-8');

    expect(content).toContain('deriveInitiativeLifecycleStatus');
    expect(content).toContain("normalizedStatus === WU_STATUS.DONE && hasIncompletePhase(phases)");
    expect(content).toContain('return WU_STATUS.IN_PROGRESS');
  });

  it('reports mismatch between metadata status and phase state', () => {
    const content = fs.readFileSync(STATUS_PATH, 'utf-8');

    expect(content).toContain('Lifecycle mismatch');
    expect(content).toContain('metadata status');
  });
});
