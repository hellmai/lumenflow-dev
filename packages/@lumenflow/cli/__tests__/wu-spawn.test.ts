import { describe, it, expect } from 'vitest';
import { generateTaskInvocation, generateCodexPrompt } from '../dist/wu-spawn.js';
import { GenericStrategy } from '@lumenflow/core/dist/spawn-strategy.js';

describe('wu-spawn client guidance injection', () => {
  const mockDoc = {
    title: 'Test WU',
    lane: 'Operations: Tooling',
    type: 'feature',
    status: 'in_progress',
    code_paths: ['src/foo.ts'],
    acceptance: ['Criteria 1'],
    description: 'Description',
    worktree_path: 'worktrees/test',
  };

  const id = 'WU-TEST';

  it('injects client blocks and skills guidance in task invocation', () => {
    const strategy = new GenericStrategy();
    const output = generateTaskInvocation(mockDoc, id, strategy, {
      client: {
        name: 'claude-code',
        config: {
          blocks: [
            {
              title: 'Claude Code Notes',
              content: 'Use agent skills for frontend tasks.',
            },
          ],
          skills: {
            instructions: 'Prefer tooling skills for CLI output.',
            recommended: ['wu-lifecycle', 'worktree-discipline'],
          },
        },
      },
    });

    expect(output).toContain('Client Guidance (claude-code)');
    expect(output).toContain('Claude Code Notes');
    expect(output).toContain('Client Skills Guidance (claude-code)');
    expect(output).toContain('Recommended skills');
  });

  it('injects client blocks and skills guidance in Codex prompt', () => {
    const strategy = new GenericStrategy();
    const output = generateCodexPrompt(mockDoc, id, strategy, {
      client: {
        name: 'gemini-cli',
        config: {
          blocks: [
            {
              title: 'Gemini CLI Notes',
              content: 'Use multimodal checks when images are present.',
            },
          ],
          skills: {
            instructions: 'Favor multimodal tooling skills.',
            recommended: ['frontend-design'],
          },
        },
      },
    });

    expect(output).toContain('Client Guidance (gemini-cli)');
    expect(output).toContain('Gemini CLI Notes');
    expect(output).toContain('Client Skills Guidance (gemini-cli)');
    expect(output).toContain('Recommended skills');
  });
});
