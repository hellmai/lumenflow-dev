import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SpawnStrategyFactory,
  ClaudeCodeStrategy,
  GeminiCliStrategy,
  GenericStrategy,
} from '../spawn-strategy.js';
import * as fs from 'node:fs';

// Mock fs to avoid real file system access
vi.mock('node:fs');

describe('SpawnStrategy', () => {
  const WU_ID = 'WU-1000';

  describe('Factory', () => {
    it('creates ClaudeCodeStrategy for "claude-code" client', () => {
      const strategy = SpawnStrategyFactory.create('claude-code');
      expect(strategy).toBeInstanceOf(ClaudeCodeStrategy);
    });

    it('creates GeminiCliStrategy for "gemini-cli" client', () => {
      const strategy = SpawnStrategyFactory.create('gemini-cli');
      expect(strategy).toBeInstanceOf(GeminiCliStrategy);
    });

    it('creates GenericStrategy for unknown client', () => {
      // Should also warn, but we verify the fallback here
      const strategy = SpawnStrategyFactory.create('unknown-client');
      expect(strategy).toBeInstanceOf(GenericStrategy);
    });
  });

  describe('ClaudeCodeStrategy', () => {
    let strategy: ClaudeCodeStrategy;

    beforeEach(() => {
      strategy = new ClaudeCodeStrategy();
    });

    it('getPreamble includes CLAUDE.md if it exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const preamble = strategy.getPreamble(WU_ID);
      expect(preamble).toContain('CLAUDE.md');
      expect(preamble).toContain('LUMENFLOW.md'); // Core always included
    });

    it('getSkillLoadingInstruction checks .lumenflow/agents and .claude/agents', () => {
      const instruction = strategy.getSkillLoadingInstruction();
      expect(instruction).toContain('.lumenflow/agents');
      expect(instruction).toContain('.claude/agents');
    });
  });

  describe('GenericStrategy', () => {
    let strategy: GenericStrategy;

    beforeEach(() => {
      strategy = new GenericStrategy();
    });

    it('getPreamble includes core docs but NOT vendor docs', () => {
      const preamble = strategy.getPreamble(WU_ID);
      expect(preamble).toContain('LUMENFLOW.md');
      expect(preamble).not.toContain('CLAUDE.md');
      expect(preamble).not.toContain('GEMINI.md');
    });

    it('getSkillLoadingInstruction points strictly to .lumenflow/agents', () => {
      const instruction = strategy.getSkillLoadingInstruction();
      expect(instruction).toContain('.lumenflow/agents');
      expect(instruction).not.toContain('.claude/agents');
    });
  });
});
