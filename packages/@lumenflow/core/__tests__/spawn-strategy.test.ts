import { describe, it, expect, vi } from 'vitest';
import {
  SpawnStrategyFactory,
  ClaudeCodeStrategy,
  GeminiCliStrategy,
  GenericStrategy,
} from '../src/spawn-strategy.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('SpawnStrategyFactory', () => {
  it('creates ClaudeCodeStrategy for "claude-code"', () => {
    const strategy = SpawnStrategyFactory.create('claude-code');
    expect(strategy).toBeInstanceOf(ClaudeCodeStrategy);
  });

  it('creates ClaudeCodeStrategy for "claude"', () => {
    const strategy = SpawnStrategyFactory.create('claude');
    expect(strategy).toBeInstanceOf(ClaudeCodeStrategy);
  });

  it('creates GeminiCliStrategy for "gemini-cli"', () => {
    const strategy = SpawnStrategyFactory.create('gemini-cli');
    expect(strategy).toBeInstanceOf(GeminiCliStrategy);
  });

  it('creates GenericStrategy for unknown client', () => {
    const strategy = SpawnStrategyFactory.create('unknown-client');
    expect(strategy).toBeInstanceOf(GenericStrategy);
  });
});

describe('ClaudeCodeStrategy', () => {
  it('includes CLAUDE.md in preamble if it exists', () => {
    (fs.existsSync as any).mockReturnValue(true);
    const strategy = new ClaudeCodeStrategy();
    const preamble = strategy.getPreamble('WU-123');
    expect(preamble).toContain('CLAUDE.md');
    expect(preamble).toContain('Claude-specific workflow overlay');
  });

  it('points to .claude/agents in skills instruction', () => {
    const strategy = new ClaudeCodeStrategy();
    const instruction = strategy.getSkillLoadingInstruction();
    expect(instruction).toContain('.claude/agents');
  });
});

describe('GeminiCliStrategy', () => {
  it('includes GEMINI.md in preamble if it exists', () => {
    (fs.existsSync as any).mockReturnValue(true);
    const strategy = new GeminiCliStrategy();
    const preamble = strategy.getPreamble('WU-123');
    expect(preamble).toContain('GEMINI.md');
    expect(preamble).toContain('Gemini-specific workflow overlay');
  });
});
