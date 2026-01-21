import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  parseConfig,
  DEFAULT_METHODOLOGY_PRINCIPLES,
} from '../lumenflow-config-schema.js';

describe('LumenFlow Config - Agents Schema', () => {
  it('parses valid agents configuration', () => {
    const config = {
      agents: {
        defaultClient: 'gemini-cli',
        methodology: {
          enabled: true,
          enforcement: 'required',
          principles: ['TDD', 'Library-First'],
          notes: 'Apply defaults unless explicitly waived.',
        },
        clients: {
          'gemini-cli': {
            preamble: 'GEMINI.md',
            skillsDir: '.lumenflow/agents',
            blocks: [
              {
                title: 'Gemini CLI Notes',
                content: 'Use multimodal checks when images are present.',
              },
            ],
            skills: {
              instructions: 'Favor tooling skills for CLI workflows.',
              recommended: ['wu-lifecycle', 'worktree-discipline'],
            },
          },
          'custom-cli': {
            preamble: false,
            skillsDir: '/abs/path/to/skills',
          },
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents.defaultClient).toBe('gemini-cli');
      expect(result.data.agents.clients['gemini-cli'].preamble).toBe('GEMINI.md');
      expect(result.data.agents.clients['custom-cli'].preamble).toBe(false);
      expect(result.data.agents.methodology.principles).toEqual(['TDD', 'Library-First']);
      expect(result.data.agents.clients['gemini-cli'].blocks?.[0]?.title).toBe('Gemini CLI Notes');
      expect(result.data.agents.clients['gemini-cli'].skills?.recommended).toEqual([
        'wu-lifecycle',
        'worktree-discipline',
      ]);
    }
  });

  it('applies defaults when agents section is missing', () => {
    const config = {}; // Empty config
    const result = parseConfig(config);

    expect(result.agents).toBeDefined();
    expect(result.agents.defaultClient).toBe('claude-code');
    expect(result.agents.clients).toEqual({});
    expect(result.agents.methodology.enabled).toBe(true);
    expect(result.agents.methodology.enforcement).toBe('required');
    expect(result.agents.methodology.principles).toEqual(DEFAULT_METHODOLOGY_PRINCIPLES);
  });

  it('validates client configuration types', () => {
    const config = {
      agents: {
        clients: {
          'bad-client': {
            preamble: 123, // Invalid type (should be string or boolean)
          },
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(false);
  });

  it('rejects invalid methodology configuration types', () => {
    const config = {
      agents: {
        methodology: {
          principles: 'TDD', // invalid, should be array
        },
      },
    };

    const result = validateConfig(config);
    expect(result.success).toBe(false);
  });
});
