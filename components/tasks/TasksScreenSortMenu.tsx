import { memo, useState, useImperativeHandle, forwardRef } from 'react';
import { TaskSortMenu } from '@/components/tasks/TaskSortMenu';
import type { DashboardSortMode } from '@/lib/hooks/useTasks';

const SORT_OPTIONS: { mode: DashboardSortMode; label: string }[] = [
  { mode: 'deadline_asc', label: 'Sort by deadline ascending' },
  { mode: 'deadline_desc', label: 'Sort by deadline descending' },
  { mode: 'created_asc', label: 'Sort by time created ascending' },
  { mode: 'created_desc', label: 'Sort by time created descending' },
];

export interface TasksScreenSortMenuHandle {
  open: (anchor: { pageX: number; pageY: number; width: number; height: number }) => void;
}

interface Props {
  sortMenuWidth: number;
  safeTopInset: number;
  sortMode: DashboardSortMode;
  onChangeSortMode: (mode: DashboardSortMode) => void;
}

export const TasksScreenSortMenu = memo(forwardRef<TasksScreenSortMenuHandle, Props>(
  function TasksScreenSortMenu({ sortMenuWidth, safeTopInset, sortMode, onChangeSortMode }, ref) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<{ pageX: number; pageY: number; width: number; height: number } | null>(null);

    useImperativeHandle(ref, () => ({
      open: (a) => {
        setAnchor(a);
        setOpen(true);
      },
    }), []);

    return (
      <TaskSortMenu
        open={open}
        anchor={anchor}
        sortMenuWidth={sortMenuWidth}
        safeTopInset={safeTopInset}
        options={SORT_OPTIONS}
        sortMode={sortMode}
        onChangeSortMode={onChangeSortMode}
        onClose={() => setOpen(false)}
      />
    );
  },
));
