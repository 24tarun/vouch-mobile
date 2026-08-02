import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GestureDetector } from 'react-native-gesture-handler';

import { TaskRow } from '@/components/TaskRow';

jest.mock('@expo/vector-icons', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    Feather: (props: Record<string, unknown>) => React.createElement(Text, props),
  };
});

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/ThemeContext', () => {
  const { darkColors } = jest.requireActual('@/lib/theme');
  return { useTheme: () => ({ colors: darkColors, isDark: true }) };
});

describe('historical TaskRow', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('is muted, readable, icon-free, and opens task detail directly', () => {
    const view = render(
      <TaskRow
        task={{
          id: 'past-task',
          title: 'Finished task',
          deadline: '2026-08-01T10:00:00.000Z',
          status: 'ACCEPTED',
        }}
      />,
    );

    const row = view.getByRole('button', { name: 'Open Finished task details' });
    const rowStyle = StyleSheet.flatten(row.props.style);
    const title = view.getByText('Finished task');
    const titleStyle = StyleSheet.flatten(title.props.style);

    expect(rowStyle.opacity).toBe(0.18);
    expect(rowStyle.paddingVertical).toBe(13);
    expect(titleStyle.fontSize).toBe(17);
    expect(titleStyle.textDecorationLine).toBeUndefined();
    expect(view.UNSAFE_queryAllByType(Feather)).toHaveLength(0);
    expect(view.queryByLabelText('Finished task, expand')).toBeNull();

    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/tasks/past-task');
  });
});

describe('active TaskRow', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  const activeTask = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    title: 'Active task',
    deadline: '2026-08-03T10:00:00.000Z',
    status: 'ACTIVE',
  };

  it('prefetches on press-in and opens detail without expanding', () => {
    const onPrefetch = jest.fn();
    const view = render(<TaskRow task={activeTask} onPrefetch={onPrefetch} />);
    const row = view.getByRole('button', { name: 'Open Active task details' });
    const rowStyle = StyleSheet.flatten(row.props.style);
    const swipeActions = view.UNSAFE_getAllByType(View)
      .find((node) => node.props.testID === 'task-swipe-actions');
    const swipeActionsStyle = StyleSheet.flatten(swipeActions?.props.style);

    fireEvent(row, 'pressIn');
    fireEvent.press(row);

    expect(onPrefetch).toHaveBeenCalledWith(activeTask.id);
    expect(mockPush).toHaveBeenCalledWith(`/tasks/${activeTask.id}`);
    expect(rowStyle.paddingVertical).toBe(13);
    expect(swipeActionsStyle.opacity).toBe(0);
    expect(view.queryByLabelText('Complete task')).toBeNull();
    expect(view.queryByLabelText('Open detail')).toBeNull();
    expect(view.queryByPlaceholderText('Add subtask...')).toBeNull();
    const renderedText = view.UNSAFE_getAllByType(Text).map((node) => node.props.children);
    expect(renderedText).toContain('Complete');
    expect(renderedText).toContain('Postpone');
  });

  it('routes left swipes to postpone and right swipes to completion', () => {
    const onCompletionIntent = jest.fn(() => 'accepted' as const);
    const onPostponeIntent = jest.fn();
    const view = render(
      <TaskRow
        task={activeTask}
        onCompletionIntent={onCompletionIntent}
        onPostponeIntent={onPostponeIntent}
      />,
    );
    const gesture = view.UNSAFE_getByType(GestureDetector).props.gesture;

    act(() => {
      gesture.handlers.onUpdate({ translationX: -10_000 });
      gesture.handlers.onEnd({ translationX: -10_000 }, true);
    });
    expect(onPostponeIntent).toHaveBeenCalledWith(activeTask);
    expect(onCompletionIntent).not.toHaveBeenCalled();

    act(() => {
      gesture.handlers.onUpdate({ translationX: 10_000 });
      gesture.handlers.onEnd({ translationX: 10_000 }, true);
    });
    expect(onCompletionIntent).toHaveBeenCalledTimes(1);
    expect(onCompletionIntent).toHaveBeenCalledWith(activeTask);
    expect(onPostponeIntent).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch another completion while an action is in progress', () => {
    const onCompletionIntent = jest.fn(() => 'accepted' as const);
    const onPostponeIntent = jest.fn();
    const view = render(
      <TaskRow
        task={activeTask}
        onCompletionIntent={onCompletionIntent}
        onPostponeIntent={onPostponeIntent}
        completionInProgress
      />,
    );
    const gesture = view.UNSAFE_getByType(GestureDetector).props.gesture;

    act(() => {
      gesture.handlers.onEnd({ translationX: 10_000 }, true);
    });
    expect(onCompletionIntent).not.toHaveBeenCalled();

    act(() => {
      gesture.handlers.onEnd({ translationX: -10_000 }, true);
    });
    expect(onPostponeIntent).not.toHaveBeenCalled();
  });

  it('keeps a paused recurrence in the active, swipeable row treatment', () => {
    const view = render(
      <TaskRow
        task={{
          ...activeTask,
          title: 'Paused recurrence',
          recurrence_rule_id: 'recurrence-1',
          recurrence_paused_at: '2026-08-02T10:00:00.000Z',
        }}
        onCompletionIntent={() => 'accepted'}
      />,
    );

    expect(view.getByRole('button', { name: 'Open Paused recurrence details' })).toBeTruthy();
    expect(view.UNSAFE_getByType(GestureDetector)).toBeTruthy();
    expect(view.UNSAFE_getAllByType(Feather).map((icon) => icon.props.name)).toEqual([
      'repeat',
      'pause',
    ]);
  });

  it.each(['ACTIVE', 'POSTPONED'])('shows a muted future %s task as a compact deadline row at 50%% opacity', (status) => {
    const view = render(
      <TaskRow
        task={{
          ...activeTask,
          deadline: '2026-08-06T10:00:00.000Z',
          status,
          title: `Future ${status.toLowerCase()}`,
        }}
        variant="future-muted"
      />,
    );

    const row = view.getByRole('button', { name: `Open Future ${status.toLowerCase()} details` });
    expect(StyleSheet.flatten(row.props.style).opacity).toBe(0.5);
    expect(view.getByText('06 Aug')).toBeTruthy();
    expect(view.queryByText(status === 'ACTIVE' ? 'Active' : 'Postponed')).toBeNull();
    expect(view.UNSAFE_queryByType(GestureDetector)).toBeNull();
  });
});
