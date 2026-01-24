/**
 * @file command-registry.test.ts
 * @description Tests for command registry (wu:* command definitions)
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests cover:
 * - Command definitions for wu:create, wu:claim, wu:done, etc.
 * - Required location constraints
 * - Required WU status constraints
 * - Custom predicates with severity
 * - getValidCommandsForContext returns appropriate commands
 */

import { describe, it, expect } from 'vitest';
import {
  COMMAND_REGISTRY,
  getCommandDefinition,
  getValidCommandsForContext,
  type CommandDefinition,
} from '../../validation/command-registry.js';
import { CONTEXT_VALIDATION } from '../../wu-constants.js';
import type { WuContext } from '../../validation/types.js';

const { LOCATION_TYPES, COMMANDS } = CONTEXT_VALIDATION;

describe('COMMAND_REGISTRY', () => {
  describe('registry structure', () => {
    it('contains all wu:* commands', () => {
      const expectedCommands = [
        COMMANDS.WU_CREATE,
        COMMANDS.WU_CLAIM,
        COMMANDS.WU_DONE,
        COMMANDS.WU_BLOCK,
        COMMANDS.WU_UNBLOCK,
        COMMANDS.WU_STATUS,
        COMMANDS.WU_RECOVER,
      ];

      for (const cmd of expectedCommands) {
        expect(COMMAND_REGISTRY.has(cmd)).toBe(true);
      }
    });

    it('each command has required fields', () => {
      for (const [name, def] of COMMAND_REGISTRY) {
        expect(def.name).toBe(name);
        expect(typeof def.description).toBe('string');
        expect(def.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('wu:create command', () => {
    it('requires main location', () => {
      const def = getCommandDefinition(COMMANDS.WU_CREATE);
      expect(def?.requiredLocation).toBe(LOCATION_TYPES.MAIN);
    });

    it('has no WU status requirement (creates new WU)', () => {
      const def = getCommandDefinition(COMMANDS.WU_CREATE);
      expect(def?.requiredWuStatus).toBeNull();
    });
  });

  describe('wu:claim command', () => {
    it('requires main location', () => {
      const def = getCommandDefinition(COMMANDS.WU_CLAIM);
      expect(def?.requiredLocation).toBe(LOCATION_TYPES.MAIN);
    });

    it('requires WU status ready', () => {
      const def = getCommandDefinition(COMMANDS.WU_CLAIM);
      expect(def?.requiredWuStatus).toBe('ready');
    });
  });

  describe('wu:done command', () => {
    it('requires main location', () => {
      const def = getCommandDefinition(COMMANDS.WU_DONE);
      expect(def?.requiredLocation).toBe(LOCATION_TYPES.MAIN);
    });

    it('requires WU status in_progress', () => {
      const def = getCommandDefinition(COMMANDS.WU_DONE);
      expect(def?.requiredWuStatus).toBe('in_progress');
    });

    it('has predicate for clean git state', () => {
      const def = getCommandDefinition(COMMANDS.WU_DONE);
      expect(def?.predicates).toBeDefined();
      expect(def?.predicates?.length).toBeGreaterThan(0);

      // Should have a git clean check
      const gitCleanPredicate = def?.predicates?.find(
        (p) => p.id === 'worktree-clean' || p.id === 'git-clean',
      );
      expect(gitCleanPredicate).toBeDefined();
    });
  });

  describe('wu:block command', () => {
    it('allows both main and worktree locations', () => {
      const def = getCommandDefinition(COMMANDS.WU_BLOCK);
      expect(def?.requiredLocation).toBeNull();
    });

    it('requires WU status in_progress', () => {
      const def = getCommandDefinition(COMMANDS.WU_BLOCK);
      expect(def?.requiredWuStatus).toBe('in_progress');
    });
  });

  describe('wu:unblock command', () => {
    it('allows both main and worktree locations', () => {
      const def = getCommandDefinition(COMMANDS.WU_UNBLOCK);
      expect(def?.requiredLocation).toBeNull();
    });

    it('requires WU status blocked', () => {
      const def = getCommandDefinition(COMMANDS.WU_UNBLOCK);
      expect(def?.requiredWuStatus).toBe('blocked');
    });
  });

  describe('wu:status command', () => {
    it('allows any location', () => {
      const def = getCommandDefinition(COMMANDS.WU_STATUS);
      expect(def?.requiredLocation).toBeNull();
    });

    it('has no WU status requirement (informational)', () => {
      const def = getCommandDefinition(COMMANDS.WU_STATUS);
      expect(def?.requiredWuStatus).toBeNull();
    });
  });

  describe('wu:recover command', () => {
    it('requires main location', () => {
      const def = getCommandDefinition(COMMANDS.WU_RECOVER);
      expect(def?.requiredLocation).toBe(LOCATION_TYPES.MAIN);
    });

    it('has no WU status requirement (handles any state)', () => {
      const def = getCommandDefinition(COMMANDS.WU_RECOVER);
      expect(def?.requiredWuStatus).toBeNull();
    });
  });
});

describe('getCommandDefinition', () => {
  it('returns command definition for valid command', () => {
    const def = getCommandDefinition(COMMANDS.WU_CREATE);
    expect(def).not.toBeNull();
    expect(def?.name).toBe(COMMANDS.WU_CREATE);
  });

  it('returns null for unknown command', () => {
    const def = getCommandDefinition('wu:unknown' as never);
    expect(def).toBeNull();
  });
});

describe('getValidCommandsForContext', () => {
  it('returns wu:claim for main checkout with ready WU', () => {
    const context: WuContext = {
      location: {
        type: LOCATION_TYPES.MAIN,
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      },
      git: {
        branch: 'main',
        isDetached: false,
        isDirty: false,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: 'origin/main',
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-1090',
        status: 'ready',
        lane: 'Framework: Core',
        title: 'Test WU',
        yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      },
      session: {
        isActive: false,
        sessionId: null,
      },
    };

    const validCommands = getValidCommandsForContext(context);
    const commandNames = validCommands.map((c) => c.name);

    expect(commandNames).toContain(COMMANDS.WU_CLAIM);
    expect(commandNames).not.toContain(COMMANDS.WU_DONE);
  });

  it('returns wu:done for main checkout with in_progress WU', () => {
    const context: WuContext = {
      location: {
        type: LOCATION_TYPES.MAIN,
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      },
      git: {
        branch: 'main',
        isDetached: false,
        isDirty: false,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: 'origin/main',
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-1090',
        status: 'in_progress',
        lane: 'Framework: Core',
        title: 'Test WU',
        yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      },
      session: {
        isActive: true,
        sessionId: 'session-123',
      },
    };

    const validCommands = getValidCommandsForContext(context);
    const commandNames = validCommands.map((c) => c.name);

    expect(commandNames).toContain(COMMANDS.WU_DONE);
    expect(commandNames).toContain(COMMANDS.WU_BLOCK);
    expect(commandNames).not.toContain(COMMANDS.WU_CLAIM);
  });

  it('returns wu:block and wu:status for worktree with in_progress WU', () => {
    const context: WuContext = {
      location: {
        type: LOCATION_TYPES.WORKTREE,
        cwd: '/repo/worktrees/framework-core-wu-1090',
        gitRoot: '/repo/worktrees/framework-core-wu-1090',
        mainCheckout: '/repo',
        worktreeName: 'framework-core-wu-1090',
        worktreeWuId: 'WU-1090',
      },
      git: {
        branch: 'lane/framework-core/wu-1090',
        isDetached: false,
        isDirty: false,
        hasStaged: false,
        ahead: 2,
        behind: 0,
        tracking: 'origin/main',
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-1090',
        status: 'in_progress',
        lane: 'Framework: Core',
        title: 'Test WU',
        yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      },
      session: {
        isActive: true,
        sessionId: 'session-123',
      },
    };

    const validCommands = getValidCommandsForContext(context);
    const commandNames = validCommands.map((c) => c.name);

    expect(commandNames).toContain(COMMANDS.WU_BLOCK);
    expect(commandNames).toContain(COMMANDS.WU_STATUS);
    // wu:done requires main checkout
    expect(commandNames).not.toContain(COMMANDS.WU_DONE);
    // wu:claim requires main checkout
    expect(commandNames).not.toContain(COMMANDS.WU_CLAIM);
  });

  it('always includes wu:status (no restrictions)', () => {
    const contexts: WuContext[] = [
      // Main checkout
      {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      },
      // Worktree
      {
        location: {
          type: LOCATION_TYPES.WORKTREE,
          cwd: '/repo/worktrees/test',
          gitRoot: '/repo/worktrees/test',
          mainCheckout: '/repo',
          worktreeName: 'test',
          worktreeWuId: null,
        },
        git: {
          branch: 'feature',
          isDetached: false,
          isDirty: true,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      },
    ];

    for (const context of contexts) {
      const validCommands = getValidCommandsForContext(context);
      const commandNames = validCommands.map((c) => c.name);
      expect(commandNames).toContain(COMMANDS.WU_STATUS);
    }
  });
});
