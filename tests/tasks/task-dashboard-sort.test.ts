import {
  sortDashboardTasks,
  sortPastTasksLatest,
  type DashboardSortMode,
} from '@/lib/tasks/task-dashboard-sort';
import type { TaskRowData } from '@/components/TaskRow';

const tasks: TaskRowData[] = [
  {
    id: 'b',
    title: 'Second created',
    deadline: '2026-08-03T10:00:00.000Z',
    created_at: '2026-08-02T10:00:00.000Z',
  },
  {
    id: 'a',
    title: 'First created',
    deadline: '2026-08-04T10:00:00.000Z',
    created_at: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'c',
    title: 'Latest created',
    deadline: '2026-08-03T10:00:00.000Z',
    created_at: '2026-08-03T10:00:00.000Z',
  },
];

describe('sortDashboardTasks', () => {
  it.each<[DashboardSortMode, string[]]>([
    ['deadline_asc', ['c', 'b', 'a']],
    ['deadline_desc', ['a', 'c', 'b']],
    ['created_asc', ['a', 'b', 'c']],
    ['created_desc', ['c', 'b', 'a']],
  ])('applies %s consistently to task rows', (mode, expectedIds) => {
    expect(sortDashboardTasks(tasks, mode).map((task) => task.id)).toEqual(expectedIds);
  });

  it('uses the task id as a stable final tie-breaker', () => {
    const tied = tasks.map((task) => ({
      ...task,
      deadline: '2026-08-03T10:00:00.000Z',
      created_at: '2026-08-02T10:00:00.000Z',
    }));

    expect(sortDashboardTasks(tied, 'deadline_asc').map((task) => task.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps historical tasks latest-updated first regardless of dashboard sorting', () => {
    const historical = [
      { ...tasks[0], updated_at: '2026-08-02T10:00:00.000Z' },
      { ...tasks[1], updated_at: '2026-08-04T10:00:00.000Z' },
      { ...tasks[2], updated_at: '2026-08-03T10:00:00.000Z' },
    ];

    expect(sortPastTasksLatest(historical).map((task) => task.id)).toEqual(['a', 'c', 'b']);
  });
});
