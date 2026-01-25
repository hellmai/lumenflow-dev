/**
 * @file validation-ports.test.ts
 * @description Tests for validation-related port interfaces
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - ICommandRegistry port interface definition
 * - Existing command registry satisfies port contract
 */

import { describe, it, expect, vi } from 'vitest';
import type { ICommandRegistry } from '../../ports/validation.ports.js';
import type { CommandDefinition, WuContext } from '../../validation/types.js';
import { CONTEXT_VALIDATION } from '../../wu-constants.js';

const { LOCATION_TYPES, COMMANDS } = CONTEXT_VALIDATION;

describe('ICommandRegistry port interface', () => {
  describe('contract definition', () => {
    it('getCommandDefinition returns CommandDefinition or null', () => {
      // Arrange: Create a mock implementation
      const mockRegistry: ICommandRegistry = {
        getCommandDefinition: vi.fn().mockReturnValue({
          name: COMMANDS.WU_DONE,
          description: 'Complete WU',
          requiredLocation: LOCATION_TYPES.MAIN,
          requiredWuStatus: 'in_progress',
          predicates: [],
          getNextSteps: () => ['Done!'],
        }),
        getValidCommandsForContext: vi.fn().mockReturnValue([]),
        getAllCommands: vi.fn().mockReturnValue([]),
      };

      // Act
      const result = mockRegistry.getCommandDefinition(COMMANDS.WU_DONE);

      // Assert: Verify contract
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('requiredLocation');
      expect(result).toHaveProperty('requiredWuStatus');
    });

    it('getCommandDefinition returns null for unknown command', () => {
      const mockRegistry: ICommandRegistry = {
        getCommandDefinition: vi.fn().mockReturnValue(null),
        getValidCommandsForContext: vi.fn().mockReturnValue([]),
        getAllCommands: vi.fn().mockReturnValue([]),
      };

      const result = mockRegistry.getCommandDefinition('wu:unknown');
      expect(result).toBeNull();
    });

    it('getValidCommandsForContext returns array of CommandDefinitions', () => {
      const mockWuDone: CommandDefinition = {
        name: COMMANDS.WU_DONE,
        description: 'Complete WU',
        requiredLocation: LOCATION_TYPES.MAIN,
        requiredWuStatus: 'in_progress',
        predicates: [],
      };

      const mockRegistry: ICommandRegistry = {
        getCommandDefinition: vi.fn(),
        getValidCommandsForContext: vi.fn().mockReturnValue([mockWuDone]),
        getAllCommands: vi.fn().mockReturnValue([mockWuDone]),
      };

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
          ahead: 1,
          behind: 0,
          tracking: 'origin/main',
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1093',
          status: 'in_progress',
          lane: 'Framework: Core',
          title: 'Test',
          yamlPath: '/repo/wu.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'test' },
      };

      // Act
      const result = mockRegistry.getValidCommandsForContext(context);

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('name');
    });

    it('getAllCommands returns all registered command definitions', () => {
      const commands: CommandDefinition[] = [
        {
          name: COMMANDS.WU_CREATE,
          description: 'Create WU',
          requiredLocation: LOCATION_TYPES.MAIN,
          requiredWuStatus: null,
        },
        {
          name: COMMANDS.WU_CLAIM,
          description: 'Claim WU',
          requiredLocation: LOCATION_TYPES.MAIN,
          requiredWuStatus: 'ready',
        },
      ];

      const mockRegistry: ICommandRegistry = {
        getCommandDefinition: vi.fn(),
        getValidCommandsForContext: vi.fn(),
        getAllCommands: vi.fn().mockReturnValue(commands),
      };

      // Act
      const result = mockRegistry.getAllCommands();

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });
});
