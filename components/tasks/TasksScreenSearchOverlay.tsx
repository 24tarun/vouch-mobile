import { memo, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { TextInput } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { TaskSearchOverlay } from '@/components/tasks/TaskSearchOverlay';
import type { TaskRowData } from '@/components/TaskRow';
import { useRouter } from 'expo-router';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';

interface SearchAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  anchor: SearchAnchor | null;
  expandProgress: SharedValue<number>;
  screenWidth: number;
  targetTop: number;
  targetHeight: number;
  onClose: () => void;
}

export const TasksScreenSearchOverlay = memo(function TasksScreenSearchOverlay({
  visible,
  anchor,
  expandProgress,
  screenWidth,
  targetTop,
  targetHeight,
  onClose,
}: Props) {
  const router = useRouter();
  const searchInputRef = useRef<TextInput | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TaskRowData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const trimmedSearchQuery = searchQuery.trim();
  const isSearchActive = visible && trimmedSearchQuery.length > 0;

  useEffect(() => {
    if (visible) {
      const focusTimeout = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(focusTimeout);
    }
    searchInputRef.current?.blur();
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setSearchQuery('');
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!isSearchActive) {
      if (!visible) return;
      if (searchResults.length > 0 || searchError) {
        setSearchResults([]);
        setSearchError(null);
        setSearchLoading(false);
      }
      return;
    }
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          if (!cancelled) {
            setSearchResults([]);
            setSearchLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, deadline, status, has_proof')
          .eq('user_id', userId)
          .neq('status', 'DELETED')
          .ilike('title', `%${trimmedSearchQuery}%`)
          .order('updated_at', { ascending: false })
          .limit(100);

        if (cancelled) return;
        if (error) {
          setSearchResults([]);
          setSearchError(error.message || 'Search failed');
          setSearchLoading(false);
          return;
        }

        setSearchResults((data as TaskRowData[]) ?? []);
        setSearchError(null);
        setSearchLoading(false);
      } catch (error: any) {
        if (cancelled) return;
        setSearchResults([]);
        setSearchError(error?.message ?? 'Search failed');
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchActive, trimmedSearchQuery]);

  function handleSearchResultPress(task: TaskRowData) {
    if (isOptimisticTaskId(task.id)) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }
    onClose();
    router.push(`/tasks/${task.id}` as any);
  }

  return (
    <TaskSearchOverlay
      visible={visible}
      anchor={anchor}
      expandProgress={expandProgress}
      screenWidth={screenWidth}
      targetTop={targetTop}
      targetHeight={targetHeight}
      searchInputRef={searchInputRef}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      searchLoading={searchLoading}
      searchError={searchError}
      searchResults={searchResults}
      onResultPress={handleSearchResultPress}
      onClose={onClose}
    />
  );
});
