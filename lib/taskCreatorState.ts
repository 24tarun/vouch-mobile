import { createContext, createElement, useContext, useRef, type ReactNode } from 'react';

/**
 * Imperative handle so the tab layout can collapse the task creator overlay
 * when any nav tab is pressed while the creator is open.
 *
 * Uses React context with a ref to survive Fast Refresh in development
 * and make the dependency visible to React's tree.
 */
interface TaskCreatorHandle {
  isExpanded: boolean;
  collapse: () => void;
}

const TaskCreatorContext = createContext<React.RefObject<TaskCreatorHandle> | null>(null);

export function TaskCreatorProvider({ children }: { children: ReactNode }) {
  const ref = useRef<TaskCreatorHandle>({ isExpanded: false, collapse: () => {} });
  return createElement(
    TaskCreatorContext.Provider,
    { value: ref },
    children,
  );
}

export function useTaskCreatorHandle(): React.RefObject<TaskCreatorHandle> {
  const ref = useContext(TaskCreatorContext);
  if (!ref) throw new Error('useTaskCreatorHandle must be used within a TaskCreatorProvider');
  return ref;
}
