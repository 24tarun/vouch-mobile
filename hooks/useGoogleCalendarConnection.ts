import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { isGoogleEventColorId, type GoogleEventColorId } from '@/lib/task-title-parser';

export interface GoogleCalendarConnectionData {
  connected: boolean;
  accountEmail: string | null;
  selectedCalendarId: string | null;
  selectedCalendarSummary: string | null;
  syncAppToGoogleEnabled: boolean;
  lastError: string | null;
  readyForAppToGoogleSync: boolean;
  defaultEventColorId: GoogleEventColorId;
}

const EMPTY: GoogleCalendarConnectionData = {
  connected: false,
  accountEmail: null,
  selectedCalendarId: null,
  selectedCalendarSummary: null,
  syncAppToGoogleEnabled: false,
  lastError: null,
  readyForAppToGoogleSync: false,
  defaultEventColorId: '9',
};

async function fetchGoogleCalendarConnection(userId: string): Promise<GoogleCalendarConnectionData> {
  const baseSelection = 'google_account_email, selected_calendar_id, selected_calendar_summary, encrypted_refresh_token, sync_app_to_google_enabled, last_error';
  const preferredSelection = `${baseSelection}, default_event_color_id`;

  const { data, error } = await (supabase.from('google_calendar_connections') as any)
    .select(preferredSelection)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    const { data: fallbackData } = await (supabase.from('google_calendar_connections') as any)
      .select(baseSelection)
      .eq('user_id', userId)
      .maybeSingle();

    if (!fallbackData) return EMPTY;

    const connected = Boolean(fallbackData.encrypted_refresh_token);
    const selectedCalendarId = (fallbackData.selected_calendar_id as string | null) ?? null;
    const syncAppToGoogleEnabled = Boolean(fallbackData.sync_app_to_google_enabled);

    return {
      connected,
      accountEmail: (fallbackData.google_account_email as string | null) ?? null,
      selectedCalendarId,
      selectedCalendarSummary: (fallbackData.selected_calendar_summary as string | null) ?? null,
      syncAppToGoogleEnabled,
      lastError: (fallbackData.last_error as string | null) ?? null,
      readyForAppToGoogleSync: connected && syncAppToGoogleEnabled && Boolean(selectedCalendarId),
      defaultEventColorId: '9',
    };
  }

  if (!data) return EMPTY;

  const connected = Boolean(data.encrypted_refresh_token);
  const selectedCalendarId = (data.selected_calendar_id as string | null) ?? null;
  const syncAppToGoogleEnabled = Boolean(data.sync_app_to_google_enabled);

  return {
    connected,
    accountEmail: (data.google_account_email as string | null) ?? null,
    selectedCalendarId,
    selectedCalendarSummary: (data.selected_calendar_summary as string | null) ?? null,
    syncAppToGoogleEnabled,
    lastError: (data.last_error as string | null) ?? null,
    readyForAppToGoogleSync: connected && syncAppToGoogleEnabled && Boolean(selectedCalendarId),
    defaultEventColorId: isGoogleEventColorId(data.default_event_color_id) ? data.default_event_color_id : '9',
  };
}

export function useGoogleCalendarConnection() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['google-calendar-connection', user?.id ?? null],
    queryFn: () => fetchGoogleCalendarConnection(user!.id),
    enabled: Boolean(user?.id),
  });
}
