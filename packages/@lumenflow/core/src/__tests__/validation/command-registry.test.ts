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

  it('excludes wu:done when git is dirty (predicate fails)', () => {
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
        isDirty: true, // Dirty git state
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: 'origin/main',
        modifiedFiles: ['file.ts'],
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
      session: { isActive: true, sessionId: 'session-123' },
    };

    const validCommands = getValidCommandsForContext(context);
    const commandNames = validCommands.map((c) => c.name);

    // wu:done predicate checks for clean git state
    expect(commandNames).not.toContain(COMMANDS.WU_DONE);
    // Other commands still work
    expect(commandNames).toContain(COMMANDS.WU_BLOCK);
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

describe('getNextSteps', () => {
  it('wu:create returns next steps with WU ID', () => {
    const def = getCommandDefinition(COMMANDS.WU_CREATE);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-1234',
        status: 'ready',
        lane: 'Framework: Core',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      },
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.includes('WU-1234'))).toBe(true);
  });

  it('wu:create returns fallback WU-XXX when no WU in context', () => {
    const def = getCommandDefinition(COMMANDS.WU_CREATE);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.includes('WU-XXX'))).toBe(true);
  });

  it('wu:claim returns next steps with worktree path', () => {
    const def = getCommandDefinition(COMMANDS.WU_CLAIM);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-1234',
        status: 'ready',
        lane: 'Framework: Core',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      },
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.includes('worktrees/'))).toBe(true);
    expect(nextSteps?.some((s) => s.includes('wu-1234'))).toBe(true);
  });

  it('wu:done returns success message', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.toLowerCase().includes('completed'))).toBe(true);
  });

  it('wu:block returns guidance about lane availability', () => {
    const def = getCommandDefinition(COMMANDS.WU_BLOCK);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.toLowerCase().includes('blocked'))).toBe(true);
  });

  it('wu:unblock returns guidance with WU ID', () => {
    const def = getCommandDefinition(COMMANDS.WU_UNBLOCK);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-5555',
        status: 'blocked',
        lane: 'Test',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: true,
        inconsistencyReason: null,
      },
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.includes('WU-5555'))).toBe(true);
  });

  it('wu:recover returns guidance', () => {
    const def = getCommandDefinition(COMMANDS.WU_RECOVER);
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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const nextSteps = def?.getNextSteps?.(context);
    expect(nextSteps).toBeDefined();
    expect(nextSteps?.some((s) => s.toLowerCase().includes('recovery'))).toBe(true);
  });
});

describe('predicate getFixMessage', () => {
  it('worktree-clean predicate provides fix message', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const cleanPredicate = def?.predicates?.find((p) => p.id === 'worktree-clean');
    expect(cleanPredicate).toBeDefined();
    expect(cleanPredicate?.getFixMessage).toBeDefined();

    const context: WuContext = {
      location: {
        type: LOCATION_TYPES.WORKTREE,
        cwd: '/repo/worktrees/test-wu-123',
        gitRoot: '/repo/worktrees/test-wu-123',
        mainCheckout: '/repo',
        worktreeName: 'test-wu-123',
        worktreeWuId: 'WU-123',
      },
      git: {
        branch: 'lane/test/wu-123',
        isDetached: false,
        isDirty: true,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: null,
        modifiedFiles: ['file.ts'],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const fixMessage = cleanPredicate?.getFixMessage?.(context);
    expect(fixMessage).toBeDefined();
    expect(fixMessage?.toLowerCase()).toContain('commit');
  });

  it('worktree-clean predicate provides fallback message without worktree name', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const cleanPredicate = def?.predicates?.find((p) => p.id === 'worktree-clean');

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
        isDirty: true,
        hasStaged: false,
        ahead: 0,
        behind: 0,
        tracking: null,
        modifiedFiles: ['file.ts'],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const fixMessage = cleanPredicate?.getFixMessage?.(context);
    expect(fixMessage).toBeDefined();
    expect(fixMessage).toContain('worktree');
  });

  it('has-commits predicate provides fix message', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const commitsPredicate = def?.predicates?.find((p) => p.id === 'has-commits');
    expect(commitsPredicate).toBeDefined();
    expect(commitsPredicate?.getFixMessage).toBeDefined();

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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: null,
      session: { isActive: false, sessionId: null },
    };

    const fixMessage = commitsPredicate?.getFixMessage?.(context);
    expect(fixMessage).toBeDefined();
    expect(fixMessage?.toLowerCase()).toContain('commit');
  });

  it('state-consistent predicate provides fix message', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const consistentPredicate = def?.predicates?.find((p) => p.id === 'state-consistent');
    expect(consistentPredicate).toBeDefined();
    expect(consistentPredicate?.getFixMessage).toBeDefined();

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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-123',
        status: 'in_progress',
        lane: 'Test',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: false,
        inconsistencyReason: 'YAML says ready but state store says in_progress',
      },
      session: { isActive: false, sessionId: null },
    };

    const fixMessage = consistentPredicate?.getFixMessage?.(context);
    expect(fixMessage).toBeDefined();
    expect(fixMessage).toContain('YAML');
  });

  it('state-consistent predicate returns default message when no inconsistency reason', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const consistentPredicate = def?.predicates?.find((p) => p.id === 'state-consistent');

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
        tracking: null,
        modifiedFiles: [],
        hasError: false,
        errorMessage: null,
      },
      wu: {
        id: 'WU-123',
        status: 'in_progress',
        lane: 'Test',
        title: 'Test',
        yamlPath: '/repo/wu.yaml',
        isConsistent: false,
        inconsistencyReason: null,
      },
      session: { isActive: false, sessionId: null },
    };

    const fixMessage = consistentPredicate?.getFixMessage?.(context);
    expect(fixMessage).toBeDefined();
    expect(fixMessage?.toLowerCase()).toContain('inconsistent');
  });
});

/**
 * WU-1092: Tests for worktreeCleanPredicate checking worktreeGit.
 *
 * The worktreeCleanPredicate must check context.worktreeGit.isDirty when available,
 * NOT context.git.isDirty. When running wu:done from main, context.git reflects
 * main's state while context.worktreeGit reflects the worktree's state.
 */
describe('worktreeCleanPredicate checks worktreeGit (WU-1092)', () => {
  const baseGitState = {
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
  };

  const baseContext: WuContext = {
    location: {
      type: LOCATION_TYPES.MAIN,
      cwd: '/repo',
      gitRoot: '/repo',
      mainCheckout: '/repo',
      worktreeName: null,
      worktreeWuId: null,
    },
    git: baseGitState,
    wu: {
      id: 'WU-1092',
      status: 'in_progress',
      lane: 'Framework: Core',
      title: 'Test',
      yamlPath: '/repo/wu.yaml',
      isConsistent: true,
      inconsistencyReason: null,
    },
    session: { isActive: true, sessionId: 'session-123' },
  };

  it('fails when worktreeGit is dirty even if main git is clean', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const cleanPredicate = def?.predicates?.find((p) => p.id === 'worktree-clean');
    expect(cleanPredicate).toBeDefined();

    // Main is clean, but worktree is dirty
    const context: WuContext = {
      ...baseContext,
      git: { ...baseGitState, isDirty: false },
      worktreeGit: { ...baseGitState, isDirty: true, modifiedFiles: ['src/dirty.ts'] },
    };

    // Predicate should FAIL (return false) because worktree is dirty
    expect(cleanPredicate?.check(context)).toBe(false);
  });

  it('passes when worktreeGit is clean even if main git happens to be dirty', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const cleanPredicate = def?.predicates?.find((p) => p.id === 'worktree-clean');
    expect(cleanPredicate).toBeDefined();

    // Main has some unrelated changes, but worktree is clean
    const context: WuContext = {
      ...baseContext,
      git: { ...baseGitState, isDirty: true, modifiedFiles: ['unrelated.md'] },
      worktreeGit: { ...baseGitState, isDirty: false },
    };

    // Predicate should PASS (return true) because worktree is clean
    expect(cleanPredicate?.check(context)).toBe(true);
  });

  it('falls back to git.isDirty when worktreeGit is undefined', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const cleanPredicate = def?.predicates?.find((p) => p.id === 'worktree-clean');
    expect(cleanPredicate).toBeDefined();

    // No worktreeGit (e.g., running from worktree itself)
    const context: WuContext = {
      ...baseContext,
      git: { ...baseGitState, isDirty: true },
      // worktreeGit: undefined (not set)
    };

    // Should fall back to checking git.isDirty
    expect(cleanPredicate?.check(context)).toBe(false);
  });

  it('passes when both git and worktreeGit are clean', () => {
    const def = getCommandDefinition(COMMANDS.WU_DONE);
    const cleanPredicate = def?.predicates?.find((p) => p.id === 'worktree-clean');
    expect(cleanPredicate).toBeDefined();

    const context: WuContext = {
      ...baseContext,
      git: { ...baseGitState, isDirty: false },
      worktreeGit: { ...baseGitState, isDirty: false },
    };

    expect(cleanPredicate?.check(context)).toBe(true);
  });

  it('excludes wu:done from valid commands when worktreeGit is dirty', () => {
    // Context: main is clean, worktree is dirty
    const context: WuContext = {
      ...baseContext,
      git: { ...baseGitState, isDirty: false, ahead: 1 }, // ahead=1 to satisfy has-commits
      worktreeGit: { ...baseGitState, isDirty: true },
    };

    const validCommands = getValidCommandsForContext(context);
    const commandNames = validCommands.map((c) => c.name);

    // wu:done should NOT be valid because worktree is dirty
    expect(commandNames).not.toContain(COMMANDS.WU_DONE);
    // wu:block should still be valid
    expect(commandNames).toContain(COMMANDS.WU_BLOCK);
  });

  it('includes wu:done in valid commands when worktreeGit is clean', () => {
    // Context: both main and worktree are clean
    const context: WuContext = {
      ...baseContext,
      git: { ...baseGitState, isDirty: false, ahead: 1 }, // ahead=1 to satisfy has-commits
      worktreeGit: { ...baseGitState, isDirty: false },
    };

    const validCommands = getValidCommandsForContext(context);
    const commandNames = validCommands.map((c) => c.name);

    // wu:done SHOULD be valid because worktree is clean
    expect(commandNames).toContain(COMMANDS.WU_DONE);
  });
});
