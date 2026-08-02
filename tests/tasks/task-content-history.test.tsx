import { fireEvent, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import { TaskContent } from '@/components/tasks/TaskContent';
import type { TaskRowData } from '@/components/TaskRow';

jest.mock('@/lib/ThemeContext', () => {
  const { darkColors } = jest.requireActual('@/lib/theme');
  return { useTheme: () => ({ colors: darkColors, isDark: true }) };
});

jest.mock('@/components/TaskRow', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    TaskRow: ({ task, onPrefetch, variant }: { task: { id: string }; onPrefetch?: (id: string) => void; variant?: string }) => (
      <MockText
        testID="task-row"
        accessibilityHint={variant}
        accessibilityRole="button"
        accessibilityLabel={task.id}
        onPressIn={() => onPrefetch?.(task.id)}
      >
        {task.id}
      </MockText>
    ),
  };
});

jest.mock('@/components/tasks/TasksEmptyState', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { TasksEmptyState: () => <MockText>Empty tasks</MockText> };
});

const noop = () => {};

function task(id: string, status: string): TaskRowData {
  return {
    id,
    title: id,
    deadline: '2026-08-03T10:00:00.000Z',
    status,
  };
}

function renderContent(overrides: Partial<React.ComponentProps<typeof TaskContent>> = {}) {
  return render(
    <TaskContent
      dueSoonTasks={[task('active', 'ACTIVE')]}
      futureTasks={[task('future', 'POSTPONED')]}
      pastTasks={[task('past', 'ACCEPTED')]}
      hasMorePast={false}
      loadingMorePast={false}
      onLoadMorePast={noop}
      refreshing={false}
      onRefresh={async () => {}}
      onCompletionIntent={() => 'accepted'}
      onPostponeIntent={noop}
      onPrefetchTask={noop}
      alwaysShowActiveTasks
      {...overrides}
    />,
  );
}

describe('TaskContent historical tasks', () => {
  it('renders active and future tasks before historical tasks without a history bucket', () => {
    const view = renderContent();

    expect(view.getAllByTestId('task-row').map((row) => row.props.children)).toEqual([
      'active',
      'future',
      'past',
    ]);
    expect(view.queryByText('Past')).toBeNull();
    expect(view.queryByText('History')).toBeNull();
  });

  it('shows historical tasks without an active-task placeholder', () => {
    const view = renderContent({
      dueSoonTasks: [],
      futureTasks: [],
      pastTasks: [task('past', 'ACCEPTED')],
    });

    expect(view.getByText('past')).toBeTruthy();
    expect(view.queryByText('Empty tasks')).toBeNull();
    expect(view.queryByText('No active tasks.')).toBeNull();
  });

  it('shows the empty state only when every task list is empty', () => {
    const view = renderContent({ dueSoonTasks: [], futureTasks: [], pastTasks: [] });
    expect(view.getByText('Empty tasks')).toBeTruthy();
  });

  it('requests one new page near the scroll end and allows another after rows append', () => {
    const onLoadMorePast = jest.fn();
    const view = renderContent({ hasMorePast: true, onLoadMorePast });
    const scrollView = view.UNSAFE_getByType(ScrollView);
    const nearEndEvent = {
      nativeEvent: {
        contentOffset: { y: 700 },
        contentSize: { height: 1000, width: 390 },
        layoutMeasurement: { height: 500, width: 390 },
      },
    };

    fireEvent.scroll(scrollView, nearEndEvent);
    fireEvent.scroll(scrollView, nearEndEvent);
    expect(onLoadMorePast).toHaveBeenCalledTimes(1);

    view.rerender(
      <TaskContent
        dueSoonTasks={[task('active', 'ACTIVE')]}
        futureTasks={[task('future', 'POSTPONED')]}
        pastTasks={[task('past', 'ACCEPTED'), task('older', 'DENIED')]}
        hasMorePast
        loadingMorePast={false}
        onLoadMorePast={onLoadMorePast}
        refreshing={false}
        onRefresh={async () => {}}
        onCompletionIntent={() => 'accepted'}
        onPostponeIntent={noop}
        onPrefetchTask={noop}
        alwaysShowActiveTasks
      />,
    );

    fireEvent.scroll(view.UNSAFE_getByType(ScrollView), nearEndEvent);
    expect(onLoadMorePast).toHaveBeenCalledTimes(2);
  });

  it('prefetches only the first five initially displayed active-like tasks', () => {
    const onPrefetchTask = jest.fn();
    const dueSoonTasks = [
      task('optimistic-new', 'ACTIVE'),
      ...Array.from({ length: 7 }, (_, index) => task(`active-${index}`, 'ACTIVE')),
    ];

    renderContent({
      dueSoonTasks,
      futureTasks: [task('future', 'ACTIVE')],
      onPrefetchTask,
    });

    expect(onPrefetchTask.mock.calls.map(([taskId]) => taskId)).toEqual([
      'active-0',
      'active-1',
      'active-2',
      'active-3',
      'active-4',
    ]);
  });

  it('places muted future tasks before history without a collapsible section', () => {
    const onPrefetchTask = jest.fn();
    const view = renderContent({
      alwaysShowActiveTasks: false,
      futureTasks: [task('future-active', 'ACTIVE'), task('future-postponed', 'POSTPONED')],
      onPrefetchTask,
    });

    const rows = view.getAllByTestId('task-row');
    expect(rows.map((row) => row.props.children)).toEqual([
      'active',
      'future-active',
      'future-postponed',
      'past',
    ]);
    expect(rows.map((row) => row.props.accessibilityHint)).toEqual([
      undefined,
      'future-muted',
      'future-muted',
      undefined,
    ]);
    expect(view.queryByText('Future')).toBeNull();

    onPrefetchTask.mockClear();
    fireEvent(view.getByRole('button', { name: 'past' }), 'pressIn');
    expect(onPrefetchTask).toHaveBeenCalledWith('past');
  });
});
