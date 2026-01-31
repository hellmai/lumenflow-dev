import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  ClaudeCodeStrategy,
  GeminiCliStrategy,
  GenericStrategy,
  SpawnStrategyFactory,
} from '../spawn-strategy';

// Mock fs.existsSync
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

describe('SpawnStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BaseSpawnStrategy.getCorePreamble', () => {
    it('should include quick-ref-commands.md in the preamble', () => {
      // Use GenericStrategy which directly returns the core preamble
      const strategy = new GenericStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      expect(preamble).toContain('quick-ref-commands.md');
      expect(preamble).toContain('CLI tooling reference');
    });

    it('should include quick-ref-commands.md as step 6', () => {
      const strategy = new GenericStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      // Check that quick-ref is listed as step 6
      expect(preamble).toMatch(
        /6\.\s*Read\s+docs\/04-operations\/_frameworks\/lumenflow\/agent\/onboarding\/quick-ref-commands\.md/,
      );
    });

    it('should include all required context files in correct order', () => {
      const strategy = new GenericStrategy();
      const preamble = strategy.getPreamble('WU-TEST');

      // Verify order: LUMENFLOW.md < constraints.md < README.md < lumenflow-complete.md < WU YAML < quick-ref
      const lumenflowPos = preamble.indexOf('LUMENFLOW.md');
      const constraintsPos = preamble.indexOf('.lumenflow/constraints.md');
      const readmePos = preamble.indexOf('README.md');
      const completePos = preamble.indexOf('lumenflow-complete.md');
      const wuYamlPos = preamble.indexOf('WU-TEST.yaml');
      const quickRefPos = preamble.indexOf('quick-ref-commands.md');

      expect(lumenflowPos).toBeLessThan(constraintsPos);
      expect(constraintsPos).toBeLessThan(readmePos);
      expect(readmePos).toBeLessThan(completePos);
      expect(completePos).toBeLessThan(wuYamlPos);
      expect(wuYamlPos).toBeLessThan(quickRefPos);
    });
  });

  describe('ClaudeCodeStrategy', () => {
    it('should add Claude overlay as step 7 when .claude/CLAUDE.md exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const strategy = new ClaudeCodeStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      expect(preamble).toContain('7. Read .claude/CLAUDE.md');
      expect(preamble).toContain('Claude-specific workflow overlay');
    });

    it('should not add Claude overlay when .claude/CLAUDE.md does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const strategy = new ClaudeCodeStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      expect(preamble).not.toContain('.claude/CLAUDE.md');
    });

    it('should still include quick-ref-commands.md as step 6', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const strategy = new ClaudeCodeStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      expect(preamble).toMatch(/6\.\s*Read.*quick-ref-commands\.md/);
      expect(preamble).toMatch(/7\.\s*Read.*\.claude\/CLAUDE\.md/);
    });
  });

  describe('GeminiCliStrategy', () => {
    it('should add Gemini overlay as step 7 when GEMINI.md exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const strategy = new GeminiCliStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      expect(preamble).toContain('7. Read GEMINI.md');
      expect(preamble).toContain('Gemini-specific workflow overlay');
    });

    it('should not add Gemini overlay when GEMINI.md does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const strategy = new GeminiCliStrategy();
      const preamble = strategy.getPreamble('WU-1234');

      expect(preamble).not.toContain('GEMINI.md');
    });
  });

  describe('SpawnStrategyFactory', () => {
    it('should create ClaudeCodeStrategy for claude-code', () => {
      const strategy = SpawnStrategyFactory.create('claude-code');
      expect(strategy).toBeInstanceOf(ClaudeCodeStrategy);
    });

    it('should create ClaudeCodeStrategy for claude (legacy alias)', () => {
      const strategy = SpawnStrategyFactory.create('claude');
      expect(strategy).toBeInstanceOf(ClaudeCodeStrategy);
    });

    it('should create GeminiCliStrategy for gemini-cli', () => {
      const strategy = SpawnStrategyFactory.create('gemini-cli');
      expect(strategy).toBeInstanceOf(GeminiCliStrategy);
    });

    it('should create GenericStrategy for unknown clients', () => {
      const strategy = SpawnStrategyFactory.create('unknown-client');
      expect(strategy).toBeInstanceOf(GenericStrategy);
    });
  });
});
