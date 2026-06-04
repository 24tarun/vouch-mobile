import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DashboardSortMode } from './useTasks';

const STORAGE_KEY = 'vouch:task-sort-mode';
const VALID_MODES: DashboardSortMode[] = ['deadline_asc', 'deadline_desc', 'created_asc', 'created_desc'];
const DEFAULT: DashboardSortMode = 'deadline_asc';

function isValidMode(value: unknown): value is DashboardSortMode {
  return typeof value === 'string' && VALID_MODES.includes(value as DashboardSortMode);
}

let cachedMode: DashboardSortMode = DEFAULT;
const listeners = new Set<(mode: DashboardSortMode) => void>();

function notify(mode: DashboardSortMode) {
  cachedMode = mode;
  for (const fn of listeners) fn(mode);
}

let loadedFromStorage = false;

async function loadFromStorage() {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (isValidMode(raw)) {
      notify(raw);
    }
  } catch {}
}

export function useTaskSortMode(): [DashboardSortMode, (mode: DashboardSortMode) => void] {
  const [mode, setMode] = useState(cachedMode);

  useEffect(() => {
    void loadFromStorage();
    const listener = (next: DashboardSortMode) => setMode(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const update = useCallback((next: DashboardSortMode) => {
    notify(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  return [mode, update];
}
