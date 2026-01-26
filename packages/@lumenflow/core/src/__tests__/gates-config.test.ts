/**
 * Gates Config Tests
 *
 * WU-1067: Config-driven gates execution
 *
 * Tests for the config-driven gates system that allows users to define
 * custom format, lint, test commands in .lumenflow.config.yaml instead
 * of relying on hardcoded language presets.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import will fail until we implement the module
import {
  GateCommandConfigSchema,
  GatesExecutionConfigSchema,
  parseGateCommand,
  expandPreset,
  loadGatesConfig,
  getDefaultGatesConfig,
  GATE_PRESETS,
} from '../gates-config.js';

describe('gates-config', () => {
  describe('GateCommandConfigSchema', () => {
    it('should accept a string command', () => {
      const result = GateCommandConfigSchema.safeParse('pnpm format:check');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('pnpm format:check');
      }
    });

    it('should accept an object with command and options', () => {
      const result = GateCommandConfigSchema.safeParse({
        command: 'dotnet format --verify-no-changes',
        continueOnError: false,
        timeout: 60000,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          command: 'dotnet format --verify-no-changes',
          continueOnError: false,
          timeout: 60000,
        });
      }
    });

    it('should accept object with only command (defaults for options)', () => {
      const result = GateCommandConfigSchema.safeParse({
        command: 'cargo fmt --check',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          command: 'cargo fmt --check',
        });
      }
    });

    it('should reject invalid input', () => {
      const result = GateCommandConfigSchema.safeParse(123);
      expect(result.success).toBe(false);
    });

    it('should reject object without command field', () => {
      const result = GateCommandConfigSchema.safeParse({
        continueOnError: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('GatesExecutionConfigSchema', () => {
    it('should accept complete gates config with all fields', () => {
      const config = {
        setup: 'pnpm install',
        format: 'pnpm format:check',
        lint: 'pnpm lint',
        typecheck: 'pnpm typecheck',
        test: 'pnpm test',
        coverage: {
          command: 'pnpm test --coverage',
          threshold: 90,
        },
      };

      const result = GatesExecutionConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.setup).toBe('pnpm install');
        expect(result.data.format).toBe('pnpm format:check');
        expect(result.data.lint).toBe('pnpm lint');
        expect(result.data.typecheck).toBe('pnpm typecheck');
        expect(result.data.test).toBe('pnpm test');
      }
    });

    it('should accept partial config (all fields optional)', () => {
      const config = {
        lint: 'ruff check .',
        test: 'pytest',
      };

      const result = GatesExecutionConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lint).toBe('ruff check .');
        expect(result.data.test).toBe('pytest');
        expect(result.data.format).toBeUndefined();
      }
    });

    it('should accept preset field for default expansion', () => {
      const config = {
        preset: 'node',
      };

      const result = GatesExecutionConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preset).toBe('node');
      }
    });

    it('should allow preset with overrides', () => {
      const config = {
        preset: 'python',
        lint: 'custom-linter .',
      };

      const result = GatesExecutionConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preset).toBe('python');
        expect(result.data.lint).toBe('custom-linter .');
      }
    });

    it('should accept empty config', () => {
      const result = GatesExecutionConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('parseGateCommand', () => {
    it('should parse string command to executable form', () => {
      const result = parseGateCommand('pnpm lint');

      expect(result).toEqual({
        command: 'pnpm lint',
        continueOnError: false,
        timeout: 120000, // default 2 minutes
      });
    });

    it('should parse object command preserving options', () => {
      const result = parseGateCommand({
        command: 'dotnet test',
        continueOnError: true,
        timeout: 300000,
      });

      expect(result).toEqual({
        command: 'dotnet test',
        continueOnError: true,
        timeout: 300000,
      });
    });

    it('should apply default timeout when not specified', () => {
      const result = parseGateCommand({
        command: 'go test ./...',
      });

      expect(result.timeout).toBe(120000);
    });

    it('should return null for undefined command', () => {
      const result = parseGateCommand(undefined);
      expect(result).toBeNull();
    });
  });

  describe('expandPreset', () => {
    it('should expand node preset to default Node.js commands', () => {
      const expanded = expandPreset('node');

      expect(expanded.setup).toContain('install');
      expect(expanded.format).toContain('prettier');
      expect(expanded.lint).toContain('eslint');
      expect(expanded.typecheck).toContain('tsc');
      expect(expanded.test).toContain('test');
    });

    it('should expand python preset to default Python commands', () => {
      const expanded = expandPreset('python');

      expect(expanded.format).toContain('ruff');
      expect(expanded.lint).toContain('ruff');
      expect(expanded.test).toContain('pytest');
    });

    it('should expand go preset to default Go commands', () => {
      const expanded = expandPreset('go');

      expect(expanded.format).toContain('gofmt');
      expect(expanded.lint).toContain('golangci-lint');
      expect(expanded.typecheck).toContain('go vet');
      expect(expanded.test).toContain('go test');
    });

    it('should expand rust preset to default Rust commands', () => {
      const expanded = expandPreset('rust');

      expect(expanded.format).toContain('cargo fmt');
      expect(expanded.lint).toContain('clippy');
      expect(expanded.typecheck).toContain('cargo check');
      expect(expanded.test).toContain('cargo test');
    });

    it('should expand dotnet preset to default .NET commands', () => {
      const expanded = expandPreset('dotnet');

      expect(expanded.format).toContain('dotnet format');
      expect(expanded.lint).toContain('dotnet build');
      expect(expanded.test).toContain('dotnet test');
    });

    // WU-1118: Java/JVM, Ruby, and PHP presets
    it('should expand java preset to default Java/JVM commands', () => {
      const expanded = expandPreset('java');

      expect(expanded.format).toBeDefined();
      expect(expanded.lint).toBeDefined();
      expect(expanded.test).toBeDefined();
      // Java preset should support both Maven and Gradle
      expect(expanded.test).toContain('mvn');
    });

    it('should expand ruby preset to default Ruby commands', () => {
      const expanded = expandPreset('ruby');

      expect(expanded.setup).toContain('bundle');
      expect(expanded.format).toContain('rubocop');
      expect(expanded.lint).toContain('rubocop');
      expect(expanded.test).toContain('rspec');
    });

    it('should expand php preset to default PHP commands', () => {
      const expanded = expandPreset('php');

      expect(expanded.setup).toContain('composer');
      expect(expanded.format).toContain('php-cs-fixer');
      expect(expanded.lint).toContain('phpstan');
      expect(expanded.test).toContain('phpunit');
    });

    it('should return empty object for unknown preset', () => {
      const expanded = expandPreset('unknown-preset');
      expect(expanded).toEqual({});
    });

    it('should return empty object for undefined preset', () => {
      const expanded = expandPreset(undefined);
      expect(expanded).toEqual({});
    });
  });

  describe('GATE_PRESETS', () => {
    it('should have node preset defined', () => {
      expect(GATE_PRESETS.node).toBeDefined();
      expect(GATE_PRESETS.node.format).toBeDefined();
      expect(GATE_PRESETS.node.lint).toBeDefined();
      expect(GATE_PRESETS.node.test).toBeDefined();
    });

    it('should have python preset defined', () => {
      expect(GATE_PRESETS.python).toBeDefined();
    });

    it('should have go preset defined', () => {
      expect(GATE_PRESETS.go).toBeDefined();
    });

    it('should have rust preset defined', () => {
      expect(GATE_PRESETS.rust).toBeDefined();
    });

    it('should have dotnet preset defined', () => {
      expect(GATE_PRESETS.dotnet).toBeDefined();
    });

    // WU-1118: Java/JVM, Ruby, and PHP presets
    it('should have java preset defined', () => {
      expect(GATE_PRESETS.java).toBeDefined();
      expect(GATE_PRESETS.java.format).toBeDefined();
      expect(GATE_PRESETS.java.lint).toBeDefined();
      expect(GATE_PRESETS.java.test).toBeDefined();
    });

    it('should have ruby preset defined', () => {
      expect(GATE_PRESETS.ruby).toBeDefined();
      expect(GATE_PRESETS.ruby.setup).toBeDefined();
      expect(GATE_PRESETS.ruby.format).toBeDefined();
      expect(GATE_PRESETS.ruby.lint).toBeDefined();
      expect(GATE_PRESETS.ruby.test).toBeDefined();
    });

    it('should have php preset defined', () => {
      expect(GATE_PRESETS.php).toBeDefined();
      expect(GATE_PRESETS.php.setup).toBeDefined();
      expect(GATE_PRESETS.php.format).toBeDefined();
      expect(GATE_PRESETS.php.lint).toBeDefined();
      expect(GATE_PRESETS.php.test).toBeDefined();
    });
  });

  describe('loadGatesConfig', () => {
    // Use real temp directory for file system tests
    const testDir = path.join('/tmp', `test-lumenflow-gates-${Date.now()}`);
    const configPath = path.join(testDir, '.lumenflow.config.yaml');

    beforeEach(() => {
      // Create temp directory
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      // Clean up temp directory
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should load gates config from .lumenflow.config.yaml', () => {
      const yamlContent = `
version: "2.0"
gates:
  execution:
    format: "pnpm format:check"
    lint: "pnpm lint"
    test: "pnpm test"
`;
      fs.writeFileSync(configPath, yamlContent);

      const config = loadGatesConfig(testDir);

      expect(config).toBeDefined();
      expect(config?.format).toBe('pnpm format:check');
      expect(config?.lint).toBe('pnpm lint');
      expect(config?.test).toBe('pnpm test');
    });

    it('should expand preset and merge with overrides', () => {
      const yamlContent = `
version: "2.0"
gates:
  execution:
    preset: "node"
    lint: "custom-lint"
`;
      fs.writeFileSync(configPath, yamlContent);

      const config = loadGatesConfig(testDir);

      expect(config).toBeDefined();
      // Preset format should be present
      expect(config?.format).toContain('prettier');
      // Override should take precedence
      expect(config?.lint).toBe('custom-lint');
    });

    it('should return null when no gates config exists', () => {
      const yamlContent = `
version: "2.0"
directories:
  wuDir: "docs/tasks/wu"
`;
      fs.writeFileSync(configPath, yamlContent);

      const config = loadGatesConfig(testDir);

      expect(config).toBeNull();
    });

    it('should return null when config file does not exist', () => {
      // Don't create the config file
      const config = loadGatesConfig(testDir);

      expect(config).toBeNull();
    });

    it('should handle malformed YAML gracefully', () => {
      const yamlContent = `
gates:
  execution:
    format: [invalid: yaml: here
`;
      fs.writeFileSync(configPath, yamlContent);

      // Suppress console.warn during this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = loadGatesConfig(testDir);

      expect(config).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe('getDefaultGatesConfig', () => {
    it('should return sensible defaults for auto-detection', () => {
      const defaults = getDefaultGatesConfig();

      expect(defaults).toBeDefined();
      expect(defaults.format).toBeDefined();
      expect(defaults.lint).toBeDefined();
      expect(defaults.test).toBeDefined();
    });
  });

  describe('integration: preset with overrides', () => {
    it('should correctly merge preset defaults with user overrides', () => {
      // Simulating: preset: python, lint: "mypy ." (override)
      const presetDefaults = expandPreset('python');
      const userOverrides = { lint: 'mypy .' };

      const merged = { ...presetDefaults, ...userOverrides };

      // User override wins
      expect(merged.lint).toBe('mypy .');
      // Preset defaults for other fields
      expect(merged.format).toContain('ruff');
      expect(merged.test).toContain('pytest');
    });
  });
});
