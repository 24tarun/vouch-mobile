import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import type { TaskRowData } from '@/components/TaskRow';

interface UseTaskSearchResult {
  trimmedQuery: string;
  searchResults: TaskRowData[];
  searchLoading: boolean;
  searchError: string | null;
  refetchSearch: () => void;
}

export function useTaskSearch(searchQuery: string, enabled = true): UseTaskSearchResult {
  const { user } = useAuth();
  const [searchResults, setSearchResults] = useState<TaskRowData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const trimmedQuery = searchQuery.trim();

  const refetchSearch = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled || trimmedQuery.length === 0) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        if (!user?.id) {
          if (!cancelled) {
            setSearchResults([]);
            setSearchLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, deadline, status, has_proof')
          .eq('user_id', user.id)
          .neq('status', 'DELETED')
          .ilike('title', `%${trimmedQuery}%`)
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
  }, [enabled, reloadToken, trimmedQuery, user?.id]);

  return {
    trimmedQuery,
    searchResults,
    searchLoading,
    searchError,
    refetchSearch,
  };
}
