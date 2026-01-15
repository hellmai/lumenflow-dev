/**
 * ArgParser tests (WU-2537)
 */

import { describe, it, expect } from 'vitest';
import { ArgParser } from '../../src/utils/arg-parser.js';

describe('ArgParser', () => {
  describe('parse', () => {
    it('parses string options', () => {
      const parser = new ArgParser('test');
      parser.addOption('id', { type: 'string' });

      const result = parser.parse(['--id', 'WU-123']);
      expect(result.options.id).toBe('WU-123');
    });

    it('parses boolean options', () => {
      const parser = new ArgParser('test');
      parser.addOption('verbose', { type: 'boolean' });

      const result = parser.parse(['--verbose']);
      expect(result.options.verbose).toBe(true);
    });

    it('handles default values', () => {
      const parser = new ArgParser('test');
      parser.addOption('mode', { type: 'string', default: 'normal' });

      const result = parser.parse([]);
      expect(result.options.mode).toBe('normal');
    });

    it('handles short aliases', () => {
      const parser = new ArgParser('test');
      parser.addOption('verbose', { type: 'boolean', alias: 'v' });

      const result = parser.parse(['-v']);
      expect(result.options.verbose).toBe(true);
    });

    it('collects positional arguments', () => {
      const parser = new ArgParser('test');
      parser.addOption('flag', { type: 'boolean' });

      const result = parser.parse(['--flag', 'file1.ts', 'file2.ts']);
      expect(result.positional).toEqual(['file1.ts', 'file2.ts']);
    });

    it('throws on missing required option', () => {
      const parser = new ArgParser('test');
      parser.addOption('id', { type: 'string', required: true });

      expect(() => parser.parse([])).toThrow('Option --id is required');
    });

    it('throws when string option missing value', () => {
      const parser = new ArgParser('test');
      parser.addOption('id', { type: 'string' });

      expect(() => parser.parse(['--id'])).toThrow('requires a value');
    });

    it('handles multiple options', () => {
      const parser = new ArgParser('test');
      parser.addOption('id', { type: 'string' });
      parser.addOption('lane', { type: 'string' });
      parser.addOption('dry-run', { type: 'boolean' });

      const result = parser.parse(['--id', 'WU-123', '--lane', 'Ops', '--dry-run']);
      expect(result.options.id).toBe('WU-123');
      expect(result.options.lane).toBe('Ops');
      expect(result.options['dry-run']).toBe(true);
    });

    it('ignores unknown options', () => {
      const parser = new ArgParser('test');
      parser.addOption('known', { type: 'boolean' });

      const result = parser.parse(['--known', '--unknown']);
      expect(result.options.known).toBe(true);
      expect(result.options.unknown).toBeUndefined();
    });
  });
});
