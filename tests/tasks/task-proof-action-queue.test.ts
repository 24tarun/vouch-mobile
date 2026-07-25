import { TaskProofActionQueue } from '@/lib/tasks/task-proof-action-queue';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('TaskProofActionQueue', () => {
  it('runs proof actions serially in selection order', async () => {
    const firstGate = deferred();
    const events: string[] = [];
    const queue = new TaskProofActionQueue();

    const first = queue.enqueue('task-1', async () => {
      events.push('first-start');
      await firstGate.promise;
      events.push('first-end');
    });
    const second = queue.enqueue('task-2', async () => {
      events.push('second-start');
    });

    expect(first.accepted).toBe(true);
    expect(first.numberAhead).toBe(0);
    expect(second.accepted).toBe(true);
    expect(second.numberAhead).toBe(1);
    expect(queue.getSnapshot().pendingTaskIds).toEqual(['task-1', 'task-2']);
    expect(events).toEqual(['first-start']);

    firstGate.resolve();
    await Promise.all([first.done, second.done]);

    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
    expect(queue.getSnapshot()).toEqual({ activeTaskId: null, pendingTaskIds: [] });
  });

  it('continues with the next action after an unexpected failure', async () => {
    const errors: unknown[] = [];
    const events: string[] = [];
    const queue = new TaskProofActionQueue((error) => errors.push(error));

    const first = queue.enqueue('task-1', async () => {
      throw new Error('boom');
    });
    const second = queue.enqueue('task-2', async () => {
      events.push('second-ran');
    });

    await Promise.all([first.done, second.done]);

    expect(errors).toHaveLength(1);
    expect(events).toEqual(['second-ran']);
  });

  it('does not enqueue two simultaneous actions for the same task', async () => {
    const gate = deferred();
    const queue = new TaskProofActionQueue();
    const first = queue.enqueue('task-1', () => gate.promise);
    const duplicate = queue.enqueue('task-1', async () => {});

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.done).toBe(first.done);
    expect(queue.getSnapshot().pendingTaskIds).toEqual(['task-1']);

    gate.resolve();
    await duplicate.done;
  });
});
