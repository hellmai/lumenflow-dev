export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface ScheduledTask {
  task_id: string;
  lane_id: string;
  priority: TaskPriority;
  payload?: Record<string, unknown>;
}

export interface TaskSchedulerOptions {
  laneWipLimits?: Record<string, number>;
}

interface QueueEntry {
  task: ScheduledTask;
  sequence: number;
}

const PRIORITY_SCORE: Record<TaskPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export class TaskScheduler {
  private readonly laneWipLimits: Record<string, number>;
  private readonly queue: QueueEntry[];
  private readonly activeByLane: Map<string, number>;
  private readonly activeByTask: Map<string, string>;
  private readonly dequeuedByTask: Map<string, ScheduledTask>;
  private sequenceCounter: number;

  constructor(options: TaskSchedulerOptions = {}) {
    this.laneWipLimits = { ...(options.laneWipLimits ?? {}) };
    this.queue = [];
    this.activeByLane = new Map<string, number>();
    this.activeByTask = new Map<string, string>();
    this.dequeuedByTask = new Map<string, ScheduledTask>();
    this.sequenceCounter = 0;
  }

  enqueue(task: ScheduledTask): void {
    this.queue.push({
      task,
      sequence: this.sequenceCounter,
    });
    this.sequenceCounter += 1;
  }

  dequeue(): ScheduledTask | null {
    if (this.queue.length === 0) {
      return null;
    }

    const sorted = [...this.queue]
      .map((entry, index) => ({
        entry,
        index,
      }))
      .sort((left, right) => {
        const priorityDelta =
          PRIORITY_SCORE[left.entry.task.priority] - PRIORITY_SCORE[right.entry.task.priority];
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return left.entry.sequence - right.entry.sequence;
      });

    for (const candidate of sorted) {
      if (!this.canStartInLane(candidate.entry.task.lane_id)) {
        continue;
      }

      this.queue.splice(candidate.index, 1);
      this.dequeuedByTask.set(candidate.entry.task.task_id, candidate.entry.task);
      return candidate.entry.task;
    }

    return null;
  }

  markStarted(taskId: string): void {
    const task = this.dequeuedByTask.get(taskId);
    if (!task) {
      return;
    }

    const current = this.activeByLane.get(task.lane_id) ?? 0;
    this.activeByLane.set(task.lane_id, current + 1);
    this.activeByTask.set(task.task_id, task.lane_id);
    this.dequeuedByTask.delete(taskId);
  }

  markCompleted(taskId: string): void {
    const laneId = this.activeByTask.get(taskId);
    if (!laneId) {
      return;
    }
    this.activeByTask.delete(taskId);

    const activeCount = this.activeByLane.get(laneId) ?? 0;
    const next = Math.max(0, activeCount - 1);
    if (next === 0) {
      this.activeByLane.delete(laneId);
      return;
    }
    this.activeByLane.set(laneId, next);
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getLaneActiveCount(laneId: string): number {
    return this.activeByLane.get(laneId) ?? 0;
  }

  private canStartInLane(laneId: string): boolean {
    const limit = this.laneWipLimits[laneId];
    if (typeof limit !== 'number' || limit <= 0) {
      return true;
    }
    return this.getLaneActiveCount(laneId) < limit;
  }
}
