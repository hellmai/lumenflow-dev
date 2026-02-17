import { describe, expect, it } from 'vitest';
import { TaskScheduler } from '../src/scheduler/task-scheduler.js';

describe('runtime TaskScheduler', () => {
  it('dequeues by priority while enforcing lane WIP limits', () => {
    const scheduler = new TaskScheduler({
      laneWipLimits: {
        'lane-a': 1,
      },
    });

    scheduler.enqueue({ task_id: 'A-1', lane_id: 'lane-a', priority: 'P1' });
    scheduler.enqueue({ task_id: 'A-2', lane_id: 'lane-a', priority: 'P0' });
    scheduler.enqueue({ task_id: 'B-1', lane_id: 'lane-b', priority: 'P2' });

    const first = scheduler.dequeue();
    expect(first?.task_id).toBe('A-2');
    if (first) {
      scheduler.markStarted(first.task_id);
    }

    const second = scheduler.dequeue();
    expect(second?.task_id).toBe('B-1');
    if (second) {
      scheduler.markStarted(second.task_id);
    }

    scheduler.markCompleted('A-2');

    const third = scheduler.dequeue();
    expect(third?.task_id).toBe('A-1');
  });

  it('tracks lane-active counts and queue depth', () => {
    const scheduler = new TaskScheduler({
      laneWipLimits: {
        'lane-a': 1,
      },
    });

    scheduler.enqueue({ task_id: 'A-1', lane_id: 'lane-a', priority: 'P1' });
    scheduler.enqueue({ task_id: 'B-1', lane_id: 'lane-b', priority: 'P1' });

    expect(scheduler.getQueueDepth()).toBe(2);

    const first = scheduler.dequeue();
    expect(first?.lane_id).toBe('lane-a');
    if (first) {
      scheduler.markStarted(first.task_id);
    }

    expect(scheduler.getLaneActiveCount('lane-a')).toBe(1);
    scheduler.markCompleted('A-1');
    expect(scheduler.getLaneActiveCount('lane-a')).toBe(0);
  });

  it('does not decrement lane counters for unknown task completions', () => {
    const scheduler = new TaskScheduler({
      laneWipLimits: {
        'lane-a': 2,
        'lane-b': 2,
      },
    });

    scheduler.enqueue({ task_id: 'A-1', lane_id: 'lane-a', priority: 'P1' });
    scheduler.enqueue({ task_id: 'B-1', lane_id: 'lane-b', priority: 'P1' });

    const first = scheduler.dequeue();
    const second = scheduler.dequeue();

    if (first) {
      scheduler.markStarted(first.task_id);
    }
    if (second) {
      scheduler.markStarted(second.task_id);
    }

    expect(scheduler.getLaneActiveCount('lane-a')).toBe(1);
    expect(scheduler.getLaneActiveCount('lane-b')).toBe(1);

    scheduler.markCompleted('NOT-ACTIVE-TASK');

    expect(scheduler.getLaneActiveCount('lane-a')).toBe(1);
    expect(scheduler.getLaneActiveCount('lane-b')).toBe(1);
  });
});
