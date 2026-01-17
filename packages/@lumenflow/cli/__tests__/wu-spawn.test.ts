/**
 * @file wu-spawn.test.ts
 * Test suite for wu:spawn Completion Workflow section (WU-2682)
 * Synced from exampleapp tools/__tests__/wu-spawn.test.mjs
 *
 * Tests generateCompletionWorkflowSection:
 * - Section header and content
 * - WU ID substitution
 * - "Do not ask" instruction
 */

import { describe, it, expect } from 'vitest';

describe('generateCompletionWorkflowSection function (WU-2682)', () => {
  it('should be exported and generate section with WU ID', async () => {
    const { generateCompletionWorkflowSection } = await import('../src/wu-spawn.js');
    const section = generateCompletionWorkflowSection('WU-TEST');

    expect(section).toContain('Completion Workflow');
    expect(section).toContain('WU-TEST');
    expect(section).toContain('pnpm wu:done');
  });

  it('should contain "do not ask" instruction', async () => {
    const { generateCompletionWorkflowSection } = await import('../src/wu-spawn.js');
    const section = generateCompletionWorkflowSection('WU-123');

    expect(section).toMatch(/do\s+not\s+ask/i);
  });

  it('should include numbered steps for completion workflow', async () => {
    const { generateCompletionWorkflowSection } = await import('../src/wu-spawn.js');
    const section = generateCompletionWorkflowSection('WU-456');

    expect(section).toContain('1.');
    expect(section).toContain('2.');
    expect(section).toContain('3.');
    expect(section).toContain('pnpm gates');
  });

  it('should include bash code block with wu:done command', async () => {
    const { generateCompletionWorkflowSection } = await import('../src/wu-spawn.js');
    const section = generateCompletionWorkflowSection('WU-789');

    expect(section).toContain('```bash');
    expect(section).toContain('pnpm wu:done --id WU-789');
    expect(section).toContain('```');
  });

  it('should emphasize autonomous completion', async () => {
    const { generateCompletionWorkflowSection } = await import('../src/wu-spawn.js');
    const section = generateCompletionWorkflowSection('WU-AUTO');

    expect(section).toContain('CRITICAL');
    expect(section).toContain('autonomously');
    expect(section).toMatch(/do\s+not\s+ask.*permission/i);
  });
});
