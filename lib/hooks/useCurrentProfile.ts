import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

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
