import {
  parseTaskDescription,
  parseTaskTitleAndSubtasks,
  resolveTaskDeadline,
  titleHasDeadlineToken,
} from '@/lib/task-title-parser';

describe('mobile task description command', () => {
  it('extracts -d(...) while preserving @tmrw as deadline metadata', () => {
    const input = 'cut nail -d(show image of clean nails) @tmrw';
    const parsed = parseTaskDescription(input);

    expect(parsed).toEqual({
      taskInput: 'cut nail @tmrw',
      description: 'show image of clean nails',
    });
    expect(parseTaskTitleAndSubtasks(input)).toEqual({
      title: 'cut nail',
      subtasks: [],
    });
    expect(titleHasDeadlineToken(input)).toBe(true);

    const now = new Date(2026, 6, 26, 10, 0, 0, 0);
    const deadline = resolveTaskDeadline(parsed.taskInput, now, 60);
    expect(deadline.error).toBeNull();
    expect(deadline.deadline.getFullYear()).toBe(2026);
    expect(deadline.deadline.getMonth()).toBe(6);
    expect(deadline.deadline.getDate()).toBe(27);
    expect(deadline.deadline.getHours()).toBe(23);
    expect(deadline.deadline.getMinutes()).toBe(0);
  });

  it('supports subtasks and balanced parentheses in the context', () => {
    const input =
      'morning skincare / face wash / moisturizer -d(show items (including moisturizer)) @tmrw';

    expect(parseTaskDescription(input)).toEqual({
      taskInput: 'morning skincare / face wash / moisturizer @tmrw',
      description: 'show items (including moisturizer)',
    });
    expect(parseTaskTitleAndSubtasks(input)).toEqual({
      title: 'morning skincare',
      subtasks: ['face wash', 'moisturizer'],
    });
  });

  it('does not let deadline-like text inside -d(...) change scheduling', () => {
    expect(titleHasDeadlineToken('cut nail -d(show it tomorrow at @9)')).toBe(false);
  });

  it('does not recognize removed -des and -desc aliases', () => {
    expect(parseTaskDescription('read book -des show the final page')).toEqual({
      taskInput: 'read book -des show the final page',
      description: null,
    });
    expect(parseTaskDescription('read book -desc quote your notes')).toEqual({
      taskInput: 'read book -desc quote your notes',
      description: null,
    });
  });
});
