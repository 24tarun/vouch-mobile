import { supabase } from '@/lib/supabase';

interface LedgerReportPayload {
  success?: boolean;
  error?: string;
  message?: string;
}

interface LedgerReportHttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text: () => Promise<string>;
}

export type LedgerReportResult =
  | { success: true; message: string }
  | { success: false; error: string };

export async function decodeLedgerReportResponse(
  response: LedgerReportHttpResponse,
): Promise<LedgerReportResult> {
  const rawBody = await response.text();
  let payload: LedgerReportPayload | null = null;

  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (parsed && typeof parsed === 'object') payload = parsed as LedgerReportPayload;
    } catch {
      payload = null;
    }
  }

  if (!response.ok || payload?.success !== true) {
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return { success: false, error: payload.error.trim() };
    }
    const status = response.status > 0 ? `HTTP ${response.status}` : 'network response';
    return {
      success: false,
      error: `The ledger service returned an invalid ${status}. Please try again.`,
    };
  }

  return {
    success: true,
    message: typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : 'Current month ledger report was sent to your registered email.',
  };
}

export async function requestCurrentMonthLedgerReport(): Promise<LedgerReportResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!accessToken) return { success: false, error: 'Please sign in again and retry.' };
  if (!supabaseUrl || !anonKey) {
    return { success: false, error: 'The ledger service is not configured.' };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/ledger-till-date`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    return await decodeLedgerReportResponse(response);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error && error.message.trim()
        ? error.message
        : 'Could not reach the ledger service. Please try again.',
    };
  }
}
