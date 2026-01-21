import { describe, it, expect } from 'vitest';
import { validateConfig, parseConfig } from '../lumenflow-config-schema.js';

describe('LumenFlow Config - Agents Schema', () => {
  it('parses valid agents configuration', () => {
    const config = {
      agents: {
        defaultClient: 'gemini-cli',
        clients: {
          'gemini-cli': {
            preamble: 'GEMINI.md',
            skillsDir: '.lumenflow/agents',
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
    }
  });

  it('applies defaults when agents section is missing', () => {
    const config = {}; // Empty config
    const result = parseConfig(config);

    expect(result.agents).toBeDefined();
    expect(result.agents.defaultClient).toBe('claude-code');
    expect(result.agents.clients).toEqual({});
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
});
