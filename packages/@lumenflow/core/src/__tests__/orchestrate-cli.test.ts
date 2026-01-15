/**
 * Orchestrate CLI Tests
 *
 * Tests the CLI command structure and argument parsing.
 * Integration tests for actual execution are in separate file.
 *
 * @module orchestrate-cli.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { createOrchestrateCLI } from '../orchestrate-cli';

describe('orchestrate-cli', () => {
  describe('createOrchestrateCLI', () => {
    it('returns a Commander program', () => {
      const program = createOrchestrateCLI();
      expect(program).toBeInstanceOf(Command);
    });

    it('has name "orchestrate"', () => {
      const program = createOrchestrateCLI();
      expect(program.name()).toBe('orchestrate');
    });

    it('has status subcommand', () => {
      const program = createOrchestrateCLI();
      const statusCmd = program.commands.find((cmd) => cmd.name() === 'status');
      expect(statusCmd).toBeDefined();
    });

    it('has suggest subcommand', () => {
      const program = createOrchestrateCLI();
      const suggestCmd = program.commands.find((cmd) => cmd.name() === 'suggest');
      expect(suggestCmd).toBeDefined();
    });

    it('suggest subcommand has --wu option', () => {
      const program = createOrchestrateCLI();
      const suggestCmd = program.commands.find((cmd) => cmd.name() === 'suggest');
      expect(suggestCmd).toBeDefined();

      // Check if --wu option exists
      const wuOption = suggestCmd!.options.find((opt) => opt.long === '--wu' || opt.short === '-w');
      expect(wuOption).toBeDefined();
    });
  });
});
