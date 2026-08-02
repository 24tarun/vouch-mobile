import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { Resend } from "npm:resend@4.1.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Currency = "EUR" | "USD" | "INR";

interface LedgerTask {
  title: string | null;
  status: string | null;
}

interface LedgerRow {
  amount_cents: number | null;
  entry_type: string | null;
  task: LedgerTask | LedgerTask[] | null;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function resolveCurrency(value: unknown): Currency {
  return value === "USD" || value === "INR" || value === "EUR" ? value : "EUR";
}

function formatCurrency(cents: number, currency: Currency): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function entryTypeLabel(entryType: string, taskStatus: string | null): string {
  if (entryType === "voucher_timeout_penalty") return "Voucher Timeout Penalty";
  if (entryType === "override") return "Override";
  if (entryType === "rectified") return "Rectified";
  if (entryType === "failure") {
    if (taskStatus === "DENIED") return "Denied";
    if (taskStatus === "SURRENDERED") return "Surrendered";
    return "Missed";
  }
  return entryType || "Entry";
}

function taskFromRow(row: LedgerRow): LedgerTask | null {
  return Array.isArray(row.task) ? row.task[0] ?? null : row.task;
}

function currentPeriodInTimezone(timezone: unknown): string {
  const timeZone = typeof timezone === "string" && timezone.trim()
    ? timezone.trim()
    : "UTC";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone,
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    // Invalid or unavailable timezones fall back to UTC below.
  }

  return new Date().toISOString().slice(0, 7);
}

function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const resendApiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
    console.error("[ledger-till-date] missing required environment variables");
    return json({ success: false, error: "Ledger email service is not configured." }, 503);
  }

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return json({ success: false, error: "Not authenticated." }, 401);

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: "Not authenticated." }, 401);
  if (!user.email) return json({ success: false, error: "Email missing on authenticated account." }, 400);

  try {
    const profileResult = await adminSupabase
      .from("profiles")
      .select("currency, charity_enabled, selected_charity_id, timezone")
      .eq("id", user.id)
      .maybeSingle();
    if (profileResult.error) throw new Error(profileResult.error.message);

    const profile = profileResult.data as {
      currency?: unknown;
      charity_enabled?: boolean | null;
      selected_charity_id?: string | null;
      timezone?: unknown;
    } | null;
    const period = currentPeriodInTimezone(profile?.timezone);
    const month = periodLabel(period);
    const ledgerResult = await adminSupabase
      .from("ledger_entries")
      .select("amount_cents, entry_type, task:tasks(title, status)")
      .eq("user_id", user.id)
      .eq("period", period)
      .order("created_at", { ascending: false });
    if (ledgerResult.error) throw new Error(ledgerResult.error.message);

    const currency = resolveCurrency(profile?.currency);
    let charityName: string | null = null;

    if (profile?.charity_enabled && profile.selected_charity_id) {
      const { data: charity, error: charityError } = await adminSupabase
        .from("charities")
        .select("name, is_active")
        .eq("id", profile.selected_charity_id)
        .maybeSingle();
      if (charityError) throw new Error(charityError.message);
      if (charity?.is_active && typeof charity.name === "string") charityName = charity.name;
    }

    const entries = (ledgerResult.data ?? []) as LedgerRow[];
    const totalCents = entries.reduce((sum, row) => sum + Number(row.amount_cents ?? 0), 0);
    const donationCents = Math.max(totalCents, 0);
    const donationFormatted = formatCurrency(donationCents, currency);

    const rowsHtml = entries.length > 0
      ? entries.map((entry) => {
          const task = taskFromRow(entry);
          const amountCents = Number(entry.amount_cents ?? 0);
          const amount = `${amountCents > 0 ? "+" : ""}${formatCurrency(amountCents, currency)}`;
          return `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(task?.title?.trim() || "Adjustment")}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(entryTypeLabel(String(entry.entry_type ?? ""), task?.status ?? null))}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${amountCents > 0 ? "#dc322f" : "#859900"};font-family:monospace;">${escapeHtml(amount)}</td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="3" style="padding:16px;text-align:center;color:#64748b;">No ledger entries yet.</td></tr>';

    const totalHeaderLabel = donationCents > 0 ? "Total Charitable Commitment" : "Current Balance";
    const charityLine = charityName
      ? `<p style="margin:24px 0 8px;font-size:15px;color:#1e293b;">Please send this amount manually to <strong>${escapeHtml(charityName)}</strong>.</p>`
      : '<p style="margin:24px 0 8px;font-size:15px;color:#1e293b;">No active charity is selected in your preferences.</p>';
    const resend = new Resend(resendApiKey);
    const emailResult = await resend.emails.send({
      from: "Vouch <noreply@vouch.tarunh.com>",
      to: user.email,
      subject: `Ledger for ${month}: ${donationFormatted}`,
      html: `
        <div style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
          <h1 style="color:#6366f1;margin-bottom:8px;font-size:24px;">Current Month Ledger</h1>
          <p style="color:#64748b;margin-top:0;font-size:16px;">Ledger for <strong>${escapeHtml(month)}</strong>.</p>
          <div style="background:#fff1f2;border:1px solid #fecdd3;padding:20px;border-radius:8px;margin:24px 0;text-align:center;">
            <p style="margin:0;font-size:14px;color:#9f1239;text-transform:uppercase;font-weight:bold;letter-spacing:.05em;">${escapeHtml(totalHeaderLabel)}</p>
            <p style="margin:8px 0 0;font-size:42px;font-weight:800;color:#e11d48;">${escapeHtml(donationFormatted)}</p>
          </div>
          <h3 style="margin-top:32px;font-size:18px;color:#1e293b;border-bottom:2px solid #f1f5f9;padding-bottom:8px;">Detailed Breakdown</h3>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;">
            <thead><tr style="background:#f8fafc;text-align:left;"><th style="padding:8px;border-bottom:2px solid #e2e8f0;">Task</th><th style="padding:8px;border-bottom:2px solid #e2e8f0;">Type</th><th style="padding:8px;border-bottom:2px solid #e2e8f0;text-align:right;">Amount</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          ${charityLine}
          <p style="margin:0;font-size:14px;color:#475569;">Payment is not processed in-app.</p>
        </div>`,
    });

    if (emailResult.error) {
      console.error("[ledger-till-date] email failed", emailResult.error);
      return json({ success: false, error: "Could not send the ledger email." }, 502);
    }

    return json({
      success: true,
      message: "Current month ledger email sent.",
      period,
      entryCount: entries.length,
    });
  } catch (error) {
    console.error("[ledger-till-date] request failed", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Could not compile ledger.",
    }, 500);
  }
});
