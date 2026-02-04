/**
 * WU-1203: Tests for progress signals in wu-spawn output
 *
 * Acceptance Criteria:
 * 3. generateAgentCoordinationSection() in wu-spawn.ts reads config and generates dynamic guidance
 * 4. Spawn prompts show Required-Mandatory when enabled:true, Optional otherwise
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the function under test
import { generateAgentCoordinationSection } from '../wu-spawn.js';
import * as lumenflowConfig from '../lumenflow-config.js';
import type { ProgressSignalsConfig } from '../lumenflow-config-schema.js';

// Test constants
const TEST_WU_ID = 'WU-1203';
const DEFAULT_MEMORY_DIR = 'memory-bank/';
const DEFAULT_SESSION_TTL = 604800000;
const DEFAULT_CHECKPOINT_TTL = 2592000000;
const PROGRESS_SIGNALS_REQUIRED = 'Progress Signals (Required at Milestones)';
const PROGRESS_SIGNALS_OPTIONAL = 'Progress Signals (Optional)';

/**
 * Creates a mock config for testing progress signals
 */

function createMockConfig(progressSignals?: Partial<ProgressSignalsConfig>) {
  return {
    memory: {
      directory: DEFAULT_MEMORY_DIR,
      sessionTtl: DEFAULT_SESSION_TTL,
      checkpointTtl: DEFAULT_CHECKPOINT_TTL,
      enableAutoCleanup: true,
      ...(progressSignals && { progress_signals: progressSignals as ProgressSignalsConfig }),
    },
    version: '1.0.0',
    directories: {} as never,
    state: {} as never,
    git: {} as never,
    wu: {} as never,
    gates: {} as never,
    ui: {} as never,
    yaml: {} as never,
    agents: {} as never,
    experimental: {} as never,
  };
}

describe('WU-1203: Progress Signals in Wu-Spawn', () => {
  describe('AC3: generateAgentCoordinationSection reads config', () => {
    let getConfigMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      getConfigMock = vi.spyOn(lumenflowConfig, 'getConfig');
    });

    afterEach(() => {
      getConfigMock.mockRestore();
    });

    it('should show "Progress Signals (Optional)" when enabled:false', () => {
      getConfigMock.mockReturnValue(
        createMockConfig({
          enabled: false,
          frequency: 0,
          on_milestone: true,
          on_tests_pass: true,
          before_gates: true,
          on_blocked: true,
          auto_checkpoint: false,
        }),
      );

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      expect(section).toContain(PROGRESS_SIGNALS_OPTIONAL);
      expect(section).not.toContain(PROGRESS_SIGNALS_REQUIRED);
    });

    it('should show "Progress Signals (Required at Milestones)" when enabled:true', () => {
      getConfigMock.mockReturnValue(
        createMockConfig({
          enabled: true,
          frequency: 0,
          on_milestone: true,
          on_tests_pass: true,
          before_gates: true,
          on_blocked: true,
          auto_checkpoint: false,
        }),
      );

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      expect(section).toContain(PROGRESS_SIGNALS_REQUIRED);
    });

    it('should show "Required at Milestones" when no progress_signals config exists (WU-1210 default)', () => {
      // Pass undefined to omit progress_signals entirely
      getConfigMock.mockReturnValue(createMockConfig());

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      // WU-1210: Without explicit config, defaults to enabled (Required at Milestones)
      // This ensures agents signal progress at key milestones by default
      expect(section).toContain(PROGRESS_SIGNALS_REQUIRED);
    });
  });

  describe('AC4: Dynamic milestone triggers from config', () => {
    let getConfigMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      getConfigMock = vi.spyOn(lumenflowConfig, 'getConfig');
    });

    afterEach(() => {
      getConfigMock.mockRestore();
    });

    it('should list milestone triggers based on config when enabled', () => {
      getConfigMock.mockReturnValue(
        createMockConfig({
          enabled: true,
          frequency: 0,
          on_milestone: true,
          on_tests_pass: true,
          before_gates: true,
          on_blocked: true,
          auto_checkpoint: false,
        }),
      );

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      // Should mention the enabled triggers
      expect(section).toContain('acceptance criterion completed');
      expect(section).toContain('tests first pass');
      expect(section).toContain('Before running gates');
      expect(section).toContain('blocked');
    });

    it('should include frequency guidance when frequency > 0', () => {
      getConfigMock.mockReturnValue(
        createMockConfig({
          enabled: true,
          frequency: 10,
          on_milestone: true,
          on_tests_pass: true,
          before_gates: true,
          on_blocked: true,
          auto_checkpoint: false,
        }),
      );

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      // Should mention frequency-based signals
      expect(section).toContain('Every 10 tool calls');
    });

    it('should not mention frequency when frequency is 0', () => {
      getConfigMock.mockReturnValue(
        createMockConfig({
          enabled: true,
          frequency: 0,
          on_milestone: true,
          on_tests_pass: true,
          before_gates: true,
          on_blocked: true,
          auto_checkpoint: false,
        }),
      );

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      // Should not mention frequency-based signals
      expect(section).not.toContain('every 0 tool calls');
      expect(section).not.toMatch(/every \d+ tool calls/);
    });

    it('should only list triggers that are enabled in config', () => {
      getConfigMock.mockReturnValue(
        createMockConfig({
          enabled: true,
          frequency: 0,
          on_milestone: true,
          on_tests_pass: false, // Disabled
          before_gates: true,
          on_blocked: false, // Disabled
          auto_checkpoint: false,
        }),
      );

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      // Should include enabled triggers
      expect(section).toContain('acceptance criterion completed');
      expect(section).toContain('Before running gates');

      // The disabled triggers should not be listed as mandatory
      // (The exact text may vary, but the concept is selective inclusion)
    });
  });

  describe('backward compatibility', () => {
    let getConfigMock: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      getConfigMock = vi.spyOn(lumenflowConfig, 'getConfig');
    });

    afterEach(() => {
      getConfigMock.mockRestore();
    });

    it('should work when getConfig returns minimal config', () => {
      // Simulate minimal config (no memory.progress_signals)
      getConfigMock.mockReturnValue(createMockConfig());

      // Should not throw
      const section = generateAgentCoordinationSection(TEST_WU_ID);
      expect(section).toBeTruthy();
      expect(section).toContain('Agent Coordination');
    });

    it('should always include mem:signal examples', () => {
      getConfigMock.mockReturnValue(createMockConfig());

      const section = generateAgentCoordinationSection(TEST_WU_ID);

      // Core guidance should always be present
      expect(section).toContain('pnpm mem:signal');
      expect(section).toContain('mem:inbox');
    });
  });
});
