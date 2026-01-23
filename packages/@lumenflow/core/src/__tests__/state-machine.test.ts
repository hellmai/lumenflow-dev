/**
 * @file state-machine.test.ts
 * @description Tests for WU state machine transitions
 *
 * Tests cover:
 * - Valid state transitions
 * - Invalid state transitions (rejected)
 * - Release transition (WU-1080: in_progress -> ready)
 * - Terminal state (done has no outgoing transitions)
 */

import { describe, it, expect } from 'vitest';
import { assertTransition } from '../state-machine.js';

describe('State Machine', () => {
  describe('Valid transitions', () => {
    it('should allow ready -> in_progress (claim)', () => {
      expect(() => assertTransition('ready', 'in_progress', 'WU-100')).not.toThrow();
    });

    it('should allow in_progress -> blocked (block)', () => {
      expect(() => assertTransition('in_progress', 'blocked', 'WU-100')).not.toThrow();
    });

    it('should allow in_progress -> waiting (await sign-off)', () => {
      expect(() => assertTransition('in_progress', 'waiting', 'WU-100')).not.toThrow();
    });

    it('should allow in_progress -> done (direct completion)', () => {
      expect(() => assertTransition('in_progress', 'done', 'WU-100')).not.toThrow();
    });

    it('should allow blocked -> in_progress (unblock)', () => {
      expect(() => assertTransition('blocked', 'in_progress', 'WU-100')).not.toThrow();
    });

    it('should allow blocked -> done (direct completion from blocked)', () => {
      expect(() => assertTransition('blocked', 'done', 'WU-100')).not.toThrow();
    });

    it('should allow waiting -> in_progress (changes requested)', () => {
      expect(() => assertTransition('waiting', 'in_progress', 'WU-100')).not.toThrow();
    });

    it('should allow waiting -> done (approved)', () => {
      expect(() => assertTransition('waiting', 'done', 'WU-100')).not.toThrow();
    });
  });

  describe('WU-1080: Release transition (orphan recovery)', () => {
    it('should allow in_progress -> ready (release)', () => {
      expect(() => assertTransition('in_progress', 'ready', 'WU-1080')).not.toThrow();
    });

    it('should NOT allow blocked -> ready (must unblock first)', () => {
      expect(() => assertTransition('blocked', 'ready', 'WU-100')).toThrow();
    });

    it('should NOT allow waiting -> ready (must go through in_progress)', () => {
      expect(() => assertTransition('waiting', 'ready', 'WU-100')).toThrow();
    });

    it('should NOT allow done -> ready (done is terminal)', () => {
      expect(() => assertTransition('done', 'ready', 'WU-100')).toThrow();
    });
  });

  describe('Invalid transitions', () => {
    it('should reject done -> in_progress (done is terminal)', () => {
      expect(() => assertTransition('done', 'in_progress', 'WU-100')).toThrow(
        'done is a terminal state',
      );
    });

    it('should reject ready -> done (must go through in_progress)', () => {
      expect(() => assertTransition('ready', 'done', 'WU-100')).toThrow();
    });

    it('should reject ready -> blocked (must go through in_progress)', () => {
      expect(() => assertTransition('ready', 'blocked', 'WU-100')).toThrow();
    });
  });

  describe('Invalid state values', () => {
    it('should reject null from state', () => {
      expect(() => assertTransition(null, 'in_progress', 'WU-100')).toThrow();
    });

    it('should reject undefined from state', () => {
      expect(() => assertTransition(undefined, 'in_progress', 'WU-100')).toThrow();
    });

    it('should reject empty string from state', () => {
      expect(() => assertTransition('', 'in_progress', 'WU-100')).toThrow();
    });

    it('should reject unknown from state', () => {
      expect(() => assertTransition('unknown', 'in_progress', 'WU-100')).toThrow();
    });

    it('should reject unknown to state', () => {
      expect(() => assertTransition('ready', 'unknown', 'WU-100')).toThrow();
    });
  });
});
