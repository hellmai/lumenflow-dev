/**
 * Orchestration DI Composition Root Tests
 *
 * Tests the dependency injection factory functions.
 *
 * @module orchestration-di.test
 */

import { describe, it, expect } from 'vitest';
import {
  createDashboardUseCase,
  createSuggestionsUseCase,
  createRenderer,
} from '../orchestration-di';
import { GetDashboardDataUseCase } from '../usecases/get-dashboard-data.usecase';
import { GetSuggestionsUseCase } from '../usecases/get-suggestions.usecase';
import { TerminalDashboardRenderer } from '../adapters/terminal-renderer.adapter';

describe('orchestration-di', () => {
  describe('createDashboardUseCase', () => {
    it('returns a GetDashboardDataUseCase instance', () => {
      const useCase = createDashboardUseCase();
      expect(useCase).toBeInstanceOf(GetDashboardDataUseCase);
    });

    it('accepts optional baseDir parameter', () => {
      const useCase = createDashboardUseCase('/custom/path');
      expect(useCase).toBeInstanceOf(GetDashboardDataUseCase);
    });
  });

  describe('createSuggestionsUseCase', () => {
    it('returns a GetSuggestionsUseCase instance', () => {
      const useCase = createSuggestionsUseCase();
      expect(useCase).toBeInstanceOf(GetSuggestionsUseCase);
    });

    it('accepts optional baseDir parameter', () => {
      const useCase = createSuggestionsUseCase('/custom/path');
      expect(useCase).toBeInstanceOf(GetSuggestionsUseCase);
    });
  });

  describe('createRenderer', () => {
    it('returns a TerminalDashboardRenderer instance', () => {
      const renderer = createRenderer();
      expect(renderer).toBeInstanceOf(TerminalDashboardRenderer);
    });
  });
});
