// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { createActor } from 'xstate';
import { describe, expect, it } from 'vitest';
import {
  TASK_LIFECYCLE_EVENTS,
  TASK_LIFECYCLE_STATES,
  assertTransition,
  resolveTaskState,
  taskLifecycleMachine,
  type TaskStateAliases,
} from '../state-machine/index.js';

describe('kernel task state machine', () => {
  it('allows canonical lifecycle transitions', () => {
    const transitions: Array<[string, string]> = [
      ['ready', 'active'],
      ['active', 'blocked'],
      ['active', 'waiting'],
      ['active', 'done'],
      ['active', 'ready'],
      ['blocked', 'active'],
      ['blocked', 'done'],
      ['waiting', 'active'],
      ['waiting', 'done'],
    ];

    for (const [from, to] of transitions) {
      expect(() => assertTransition(from, to, 'WU-1727')).not.toThrow();
    }
  });

  it('rejects all transitions from done (terminal state)', () => {
    expect(() => assertTransition('done', 'active', 'WU-1727')).toThrow('done is a terminal state');
    expect(() => assertTransition('done', 'ready', 'WU-1727')).toThrow('done is a terminal state');
  });

  it('resolves pack-provided aliases when validating transitions', () => {
    const aliases: TaskStateAliases = {
      active: 'in_progress',
    };

    expect(resolveTaskState('in_progress', aliases)).toBe('active');
    expect(resolveTaskState('active', aliases)).toBe('active');
    expect(() => assertTransition('ready', 'in_progress', 'WU-1727', aliases)).not.toThrow();
    expect(() => assertTransition('in_progress', 'done', 'WU-1727', aliases)).not.toThrow();
  });

  it('throws descriptive errors for illegal transitions', () => {
    expect(() => assertTransition('ready', 'done', 'WU-1727')).toThrow(
      'Illegal state transition for WU-1727',
    );
  });

  it('supports snapshot serialization and rehydration', () => {
    const actor1 = createActor(taskLifecycleMachine);
    actor1.start();
    actor1.send({ type: TASK_LIFECYCLE_EVENTS.CLAIM });
    actor1.send({ type: TASK_LIFECYCLE_EVENTS.BLOCK });

    const serialized = JSON.stringify(actor1.getSnapshot());
    expect(serialized).toBeTruthy();

    const persistedSnapshot = actor1.getPersistedSnapshot();
    actor1.stop();

    const actor2 = createActor(taskLifecycleMachine, {
      snapshot: persistedSnapshot,
    });
    actor2.start();

    expect(actor2.getSnapshot().value).toBe(TASK_LIFECYCLE_STATES.BLOCKED);
    actor2.send({ type: TASK_LIFECYCLE_EVENTS.UNBLOCK });
    expect(actor2.getSnapshot().value).toBe(TASK_LIFECYCLE_STATES.ACTIVE);

    actor2.stop();
  });
});
