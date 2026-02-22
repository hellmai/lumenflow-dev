// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for spawn-prompt-helpers (WU-2043)
 *
 * Tests the 9 exported functions in isolation:
 * - formatAcceptance
 * - generateImplementationContext
 * - detectMandatoryAgents
 * - generateMandatoryAgentSection
 * - generatePreamble
 * - generateClientBlocksSection
 * - generateInvariantsPriorArtSection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatAcceptance,
  generateImplementationContext,
  detectMandatoryAgents,
  generateMandatoryAgentSection,
  generatePreamble,
  generateClientBlocksSection,
  generateInvariantsPriorArtSection,
} from '../spawn-prompt-helpers.js';
import type { SpawnStrategy } from '../spawn-strategy.js';
import type { WUDoc } from '../spawn-agent-guidance.js';

// Mock node:fs (synchronous)
vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// Mock invariants-runner loadInvariants
vi.mock('../invariants-runner.js', () => ({
  loadInvariants: vi.fn().mockReturnValue([]),
  INVARIANT_TYPES: {
    REQUIRED_FILE: 'required-file',
    FORBIDDEN_FILE: 'forbidden-file',
    MUTUAL_EXCLUSIVITY: 'mutual-exclusivity',
    FORBIDDEN_PATTERN: 'forbidden-pattern',
    REQUIRED_PATTERN: 'required-pattern',
    FORBIDDEN_IMPORT: 'forbidden-import',
    WU_AUTOMATED_TESTS: 'wu-automated-tests',
  },
}));

// Mock minimatch
vi.mock('minimatch', () => ({
  minimatch: vi.fn().mockReturnValue(false),
}));

import { existsSync } from 'node:fs';
import { loadInvariants } from '../invariants-runner.js';

describe('formatAcceptance', () => {
  it('should format acceptance criteria as markdown checklist', () => {
    const result = formatAcceptance(['Criterion A', 'Criterion B']);
    expect(result).toBe('- [ ] Criterion A\n- [ ] Criterion B');
  });

  it('should return default message for empty array', () => {
    expect(formatAcceptance([])).toBe('- No acceptance criteria defined');
  });

  it('should return default message for undefined', () => {
    expect(formatAcceptance(undefined)).toBe('- No acceptance criteria defined');
  });

  it('should handle single criterion', () => {
    const result = formatAcceptance(['Only one']);
    expect(result).toBe('- [ ] Only one');
  });
});

describe('generateImplementationContext', () => {
  it('should return empty string when doc has no extra context', () => {
    const doc: WUDoc = {} as WUDoc;
    expect(generateImplementationContext(doc)).toBe('');
  });

  it('should include spec_refs section when present', () => {
    const doc: WUDoc = {
      spec_refs: ['docs/spec.md'],
    } as WUDoc;
    const result = generateImplementationContext(doc);
    expect(result).toContain('## References');
    expect(result).toContain('docs/spec.md');
  });

  it('should include notes section when present', () => {
    const doc: WUDoc = {
      notes: 'Important implementation note',
    } as WUDoc;
    const result = generateImplementationContext(doc);
    expect(result).toContain('## Implementation Notes');
    expect(result).toContain('Important implementation note');
  });

  it('should include risks section when present', () => {
    const doc: WUDoc = {
      risks: ['Performance degradation', 'Breaking change'],
    } as WUDoc;
    const result = generateImplementationContext(doc);
    expect(result).toContain('## Risks');
    expect(result).toContain('Performance degradation');
  });

  it('should include manual tests section when present', () => {
    const doc: WUDoc = {
      tests: { manual: ['Test step 1', 'Test step 2'] },
    } as WUDoc;
    const result = generateImplementationContext(doc);
    expect(result).toContain('## Manual Verification');
    expect(result).toContain('Test step 1');
  });

  it('should omit sections with empty content', () => {
    const doc: WUDoc = {
      spec_refs: [],
      risks: [],
      notes: '  ',
      tests: { manual: [] },
    } as unknown as WUDoc;
    expect(generateImplementationContext(doc)).toBe('');
  });

  it('should handle external spec_refs with lumenflow:// prefix', () => {
    const doc: WUDoc = {
      spec_refs: ['lumenflow://plans/WU-100-plan.md'],
    } as WUDoc;
    const result = generateImplementationContext(doc);
    expect(result).toContain('external - read with filesystem access');
  });
});

describe('detectMandatoryAgents', () => {
  it('should return empty array when no code paths provided', () => {
    expect(detectMandatoryAgents(undefined)).toEqual([]);
    expect(detectMandatoryAgents([])).toEqual([]);
  });

  it('should return empty array when no triggers match', () => {
    // MANDATORY_TRIGGERS is empty for LumenFlow framework development
    expect(detectMandatoryAgents(['src/foo.ts'])).toEqual([]);
  });
});

describe('generateMandatoryAgentSection', () => {
  it('should return empty string when no mandatory agents', () => {
    expect(generateMandatoryAgentSection([], 'WU-100')).toBe('');
  });

  it('should format agents list when present', () => {
    const result = generateMandatoryAgentSection(
      ['security-reviewer', 'performance-tester'],
      'WU-100',
    );
    expect(result).toContain('## Mandatory Agents');
    expect(result).toContain('security-reviewer');
    expect(result).toContain('performance-tester');
  });
});

describe('generatePreamble', () => {
  it('should delegate to strategy.getPreamble', () => {
    const mockStrategy: SpawnStrategy = {
      getPreamble: vi.fn().mockReturnValue('Mock preamble for WU-100'),
      getSkillLoadingInstruction: vi.fn(),
    };

    const result = generatePreamble('WU-100', mockStrategy);

    expect(result).toBe('Mock preamble for WU-100');
    expect(mockStrategy.getPreamble).toHaveBeenCalledWith('WU-100');
  });
});

describe('generateClientBlocksSection', () => {
  it('should return empty string when no client context', () => {
    expect(generateClientBlocksSection(undefined)).toBe('');
  });

  it('should return empty string when config has no blocks', () => {
    expect(
      generateClientBlocksSection({ name: 'test', config: { blocks: [] } as never }),
    ).toBe('');
  });

  it('should format client blocks when present', () => {
    const result = generateClientBlocksSection({
      name: 'claude-code',
      config: {
        blocks: [
          { title: 'Safety', content: 'Always follow safety rules' },
          { title: 'Performance', content: 'Optimize for speed' },
        ],
      } as never,
    });

    expect(result).toContain('## Client Guidance (claude-code)');
    expect(result).toContain('### Safety');
    expect(result).toContain('Always follow safety rules');
    expect(result).toContain('### Performance');
  });
});

describe('generateInvariantsPriorArtSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty string when no code paths', () => {
    expect(generateInvariantsPriorArtSection([])).toBe('');
  });

  it('should return empty string when invariants.yml does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(generateInvariantsPriorArtSection(['src/foo.ts'])).toBe('');
  });

  it('should return empty string when no invariants match code paths', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(loadInvariants).mockReturnValue([
      {
        id: 'INV-001',
        type: 'required-file',
        description: 'Test',
        path: 'unrelated.md',
      },
    ]);

    expect(generateInvariantsPriorArtSection(['src/foo.ts'])).toBe('');
  });

  it('should handle loadInvariants throwing error gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(loadInvariants).mockImplementation(() => {
      throw new Error('Parse error');
    });

    expect(generateInvariantsPriorArtSection(['src/foo.ts'])).toBe('');
  });
});
