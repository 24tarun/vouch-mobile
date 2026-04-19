import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { queryKeys } from '@/lib/query/keys';

export async function fetchCurrentProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return (data as Profile | null) ?? null;
}

export function useCurrentProfile(userId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.currentProfile(userId),
    queryFn: () => fetchCurrentProfile(userId!),
    enabled: Boolean(userId),
  });

  return query;
}
