import { supabase } from '@/lib/supabase';

export type GoogleCalendarEnqueueSkipReason =
  | 'task_not_event'
  | 'google_not_connected'
  | 'app_to_google_disabled'
  | 'calendar_not_selected'
  | 'google_event_missing';

interface GoogleCalendarEnqueueRpcRow {
  status: 'enqueued' | 'skipped';
  reason: GoogleCalendarEnqueueSkipReason | null;
  outbox_id: number | null;
}

interface GoogleCalendarDispatchResponse {
  success: boolean;
  retryScheduled?: boolean;
  error?: string;
  runId?: string | null;
}

export type GoogleCalendarMobileSyncResult =
  | { status: 'dispatched'; message: null }
  | { status: 'skipped'; message: string | null; reason: GoogleCalendarEnqueueSkipReason }
  | { status: 'warning'; message: string };

function getSupabaseFunctionConfig() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return { supabaseUrl, anonKey };
}

async function getAccessToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.access_token?.trim() || null;
}

function messageForSkipReason(reason: GoogleCalendarEnqueueSkipReason): string | null {
  switch (reason) {
    case 'task_not_event':
      return null;
    case 'google_not_connected':
      return 'Task created. Connect Google Calendar on the website to sync event tasks.';
    case 'app_to_google_disabled':
      return 'Task created. Turn on Vouch to Google sync on the website to sync event tasks.';
    case 'calendar_not_selected':
      return 'Task created. Choose a Google calendar on the website to sync event tasks.';
    case 'google_event_missing':
      return null;
    default:
      return 'Task created, but Google sync did not start.';
  }
}

function deleteMessageForSkipReason(reason: GoogleCalendarEnqueueSkipReason): string | null {
  switch (reason) {
    case 'google_not_connected':
      return 'Task deleted. Connect Google Calendar on the website to clean up synced events automatically.';
    case 'app_to_google_disabled':
      return 'Task deleted. Turn on Vouch to Google sync on the website to clean up synced events automatically.';
    case 'calendar_not_selected':
      return 'Task deleted. Choose a Google calendar on the website to clean up synced events automatically.';
    case 'google_event_missing':
    case 'task_not_event':
      return null;
    default:
      return 'Task deleted, but Google Calendar cleanup did not start.';
  }
}

async function dispatchGoogleCalendarOutbox(outboxId: number): Promise<GoogleCalendarDispatchResponse> {
  const accessToken = await getAccessToken();
  const { supabaseUrl, anonKey } = getSupabaseFunctionConfig();

  if (!accessToken || !supabaseUrl || !anonKey) {
    return {
      success: false,
      retryScheduled: true,
      error: 'Missing mobile auth session or Supabase function configuration.',
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/google-calendar-dispatch-mobile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ outboxId }),
    });

    let parsed: GoogleCalendarDispatchResponse | null = null;
    try {
      parsed = await response.clone().json() as GoogleCalendarDispatchResponse;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        success: false,
        retryScheduled: true,
        error: parsed?.error || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      };
    }

    return parsed ?? {
      success: false,
      retryScheduled: true,
      error: 'Immediate Google sync returned an empty response.',
    };
  } catch (error) {
    return {
      success: false,
      retryScheduled: true,
      error: error instanceof Error ? error.message : 'Immediate Google sync request failed.',
    };
  }
}

export async function syncGoogleCalendarTaskAfterCreate(taskId: string): Promise<GoogleCalendarMobileSyncResult> {
  try {
    const { data, error } = await ((supabase.rpc('enqueue_google_calendar_task_upsert', {
      p_task_id: taskId,
    }) as any).single());

    if (error) {
      console.warn('[google-calendar-mobile-sync] enqueue RPC failed', {
        taskId,
        message: error.message,
      });
      return {
        status: 'warning',
        message: 'Task created, but Google sync could not be queued.',
      };
    }

    const row = (data ?? null) as GoogleCalendarEnqueueRpcRow | null;
    if (!row) {
      console.warn('[google-calendar-mobile-sync] enqueue RPC returned no row', { taskId });
      return {
        status: 'warning',
        message: 'Task created, but Google sync could not be queued.',
      };
    }

    if (row.status === 'skipped') {
      console.warn('[google-calendar-mobile-sync] enqueue skipped', {
        taskId,
        reason: row.reason,
      });
      return {
        status: 'skipped',
        reason: row.reason ?? 'task_not_event',
        message: row.reason ? messageForSkipReason(row.reason) : null,
      };
    }

    if (!row.outbox_id) {
      console.warn('[google-calendar-mobile-sync] enqueue returned no outbox id', { taskId, row });
      return {
        status: 'warning',
        message: 'Task created, but Google sync could not be started.',
      };
    }

    const dispatch = await dispatchGoogleCalendarOutbox(row.outbox_id);
    if (!dispatch.success) {
      console.warn('[google-calendar-mobile-sync] immediate dispatch failed', {
        taskId,
        outboxId: row.outbox_id,
        error: dispatch.error,
      });
      return {
        status: 'warning',
        message: 'Task created. Google sync will retry in the background.',
      };
    }

    return { status: 'dispatched', message: null };
  } catch (error) {
    console.warn('[google-calendar-mobile-sync] unexpected sync error', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 'warning',
      message: 'Task created, but Google sync could not be started.',
    };
  }
}

export async function syncGoogleCalendarTaskAfterDelete(
  taskId: string,
  googleEventId?: string | null,
  calendarId?: string | null,
): Promise<GoogleCalendarMobileSyncResult> {
  if (!googleEventId?.trim()) {
    return {
      status: 'skipped',
      reason: 'google_event_missing',
      message: null,
    };
  }

  try {
    const { data, error } = await ((supabase.rpc('enqueue_google_calendar_task_delete', {
      p_task_id: taskId,
      p_google_event_id: googleEventId.trim(),
      p_calendar_id: calendarId?.trim() || null,
    }) as any).single());

    if (error) {
      console.warn('[google-calendar-mobile-sync] delete enqueue RPC failed', {
        taskId,
        message: error.message,
      });
      return {
        status: 'warning',
        message: 'Task deleted, but Google Calendar cleanup could not be queued.',
      };
    }

    const row = (data ?? null) as GoogleCalendarEnqueueRpcRow | null;
    if (!row) {
      console.warn('[google-calendar-mobile-sync] delete enqueue RPC returned no row', { taskId });
      return {
        status: 'warning',
        message: 'Task deleted, but Google Calendar cleanup could not be queued.',
      };
    }

    if (row.status === 'skipped') {
      console.warn('[google-calendar-mobile-sync] delete enqueue skipped', {
        taskId,
        reason: row.reason,
      });
      return {
        status: 'skipped',
        reason: row.reason ?? 'google_event_missing',
        message: row.reason ? deleteMessageForSkipReason(row.reason) : null,
      };
    }

    if (!row.outbox_id) {
      console.warn('[google-calendar-mobile-sync] delete enqueue returned no outbox id', { taskId, row });
      return {
        status: 'warning',
        message: 'Task deleted, but Google Calendar cleanup could not be started.',
      };
    }

    const dispatch = await dispatchGoogleCalendarOutbox(row.outbox_id);
    if (!dispatch.success) {
      console.warn('[google-calendar-mobile-sync] delete dispatch failed', {
        taskId,
        outboxId: row.outbox_id,
        error: dispatch.error,
      });
      return {
        status: 'warning',
        message: 'Task deleted. Google Calendar cleanup will retry in the background.',
      };
    }

    return { status: 'dispatched', message: null };
  } catch (error) {
    console.warn('[google-calendar-mobile-sync] unexpected delete sync error', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 'warning',
      message: 'Task deleted, but Google Calendar cleanup could not be started.',
    };
  }
}
