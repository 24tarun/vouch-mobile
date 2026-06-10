import { getDefaultDeadline } from '@/lib/task-title-parser';

describe('getDefaultDeadline', () => {
  it('defaults to 23:00 on the same day when the current time is earlier', () => {
    const now = new Date(2026, 5, 10, 17, 27, 36);
    const deadline = getDefaultDeadline(now);

    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(5);
    expect(deadline.getDate()).toBe(10);
    expect(deadline.getHours()).toBe(23);
    expect(deadline.getMinutes()).toBe(0);
  });

  it('rolls to the next day at 23:00 when the current time is already past the deadline', () => {
    const now = new Date(2026, 5, 10, 23, 30, 0);
    const deadline = getDefaultDeadline(now);

    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(5);
    expect(deadline.getDate()).toBe(11);
    expect(deadline.getHours()).toBe(23);
    expect(deadline.getMinutes()).toBe(0);
  });
});
