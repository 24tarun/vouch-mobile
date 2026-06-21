import { supabase } from '@/lib/supabase';
import type { TaskStatus } from '@/lib/types';
import { calculateTaskStatusCounts, type TaskStatsCounts } from '@/lib/stats/task-status-counts';

export interface SettingsStats {
  totalTasks: number;
  accepted: number;
  denied: number;
  missed: number;
  totalVouched: number;
  focusedSeconds: number;
}

async function calculateTaskStats(userId: string): Promise<{ data: TaskStatsCounts | null; error: string | null }> {
  const { data, error } = await supabase
    .from('tasks')
    .select('status')
    .eq('user_id', userId)
    .not('status', 'eq', 'DELETED');

  if (error) {
    return { data: null, error: error.message };
  }

  const tasks = (data ?? []) as { status: TaskStatus }[];
  const counts = calculateTaskStatusCounts(tasks);

  return { data: counts, error: null };
}

async function calculateVouchedCount(userId: string): Promise<{ data: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact' })
    .eq('voucher_id', userId);

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data ? data.length : 0, error: null };
}

async function calculateFocusedTime(userId: string): Promise<{ data: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from('pomo_sessions')
    .select('elapsed_seconds')
    .eq('user_id', userId)
    .eq('status', 'COMPLETED');

  if (error) {
    return { data: null, error: error.message };
  }

  const sessions = (data ?? []) as { elapsed_seconds: number }[];
  const totalSeconds = sessions.reduce((sum, session) => sum + (session.elapsed_seconds ?? 0), 0);

  return { data: totalSeconds, error: null };
}

export async function fetchSettingsStats(userId: string): Promise<{ data: SettingsStats | null; error: string | null }> {
  if (!userId) {
    return { data: null, error: 'User ID is required' };
  }

  const [taskStatsRes, vouchedRes, focusedTimeRes] = await Promise.all([
    calculateTaskStats(userId),
    calculateVouchedCount(userId),
    calculateFocusedTime(userId),
  ]);

  if (taskStatsRes.error || vouchedRes.error || focusedTimeRes.error) {
    return {
      data: null,
      error: taskStatsRes.error ?? vouchedRes.error ?? focusedTimeRes.error ?? 'Unknown error',
    };
  }

  return {
    data: {
      totalTasks: taskStatsRes.data?.total ?? 0,
      accepted: taskStatsRes.data?.accepted ?? 0,
      denied: taskStatsRes.data?.denied ?? 0,
      missed: taskStatsRes.data?.missed ?? 0,
      totalVouched: vouchedRes.data ?? 0,
      focusedSeconds: focusedTimeRes.data ?? 0,
    },
    error: null,
  };
}
