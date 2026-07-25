export interface TaskProofQueueSnapshot {
  activeTaskId: string | null;
  pendingTaskIds: string[];
}

interface TaskProofQueueItem {
  taskId: string;
  run: () => Promise<void>;
  resolveDone: () => void;
}

export interface TaskProofQueueEnqueueResult {
  accepted: boolean;
  numberAhead: number;
  done: Promise<void>;
}

type TaskProofQueueListener = (snapshot: TaskProofQueueSnapshot) => void;

/**
 * Serializes proof mutations on one device while leaving uploads from other
 * signed-in clients completely independent.
 */
export class TaskProofActionQueue {
  private readonly queuedItems: TaskProofQueueItem[] = [];
  private readonly pendingTaskIds = new Set<string>();
  private readonly doneByTaskId = new Map<string, Promise<void>>();
  private readonly listeners = new Set<TaskProofQueueListener>();
  private activeTaskId: string | null = null;
  private isDraining = false;

  constructor(private readonly onUnexpectedError?: (error: unknown) => void) {}

  getSnapshot(): TaskProofQueueSnapshot {
    return {
      activeTaskId: this.activeTaskId,
      pendingTaskIds: Array.from(this.pendingTaskIds),
    };
  }

  subscribe(listener: TaskProofQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  enqueue(taskId: string, run: () => Promise<void>): TaskProofQueueEnqueueResult {
    const existingDone = this.doneByTaskId.get(taskId);
    if (existingDone) {
      return {
        accepted: false,
        numberAhead: 0,
        done: existingDone,
      };
    }

    const numberAhead = this.pendingTaskIds.size;
    let resolveDone = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    this.pendingTaskIds.add(taskId);
    this.doneByTaskId.set(taskId, done);
    this.queuedItems.push({ taskId, run, resolveDone });
    this.emit();
    void this.drain();

    return {
      accepted: true,
      numberAhead,
      done,
    };
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private async drain() {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      while (this.queuedItems.length > 0) {
        const item = this.queuedItems.shift();
        if (!item) continue;

        this.activeTaskId = item.taskId;
        this.emit();
        try {
          await item.run();
        } catch (error) {
          this.onUnexpectedError?.(error);
        } finally {
          this.activeTaskId = null;
          this.pendingTaskIds.delete(item.taskId);
          this.doneByTaskId.delete(item.taskId);
          item.resolveDone();
          this.emit();
        }
      }
    } finally {
      this.isDraining = false;
    }
  }
}
