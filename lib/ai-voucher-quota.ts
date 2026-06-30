import type { AiVoucherQuota } from '@/lib/types';

export function formatAiVoucherQuotaResetDate(resetsAt: string): string {
  const resetDate = new Date(resetsAt);
  if (Number.isNaN(resetDate.getTime())) return 'the start of next month';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
  }).format(resetDate);
}

export function formatAiVoucherQuotaExhaustedMessage(quota: AiVoucherQuota): string {
  const limit = quota.limit ?? 5;
  const pendingText = quota.pending > 0
    ? ` ${quota.pending} review${quota.pending === 1 ? ' is' : 's are'} still pending.`
    : '';
  return `Free accounts include ${limit} AI-reviewed tasks per calendar month. You have used ${quota.used} of ${limit}.${pendingText} Credits reset on ${formatAiVoucherQuotaResetDate(quota.resetsAt)}.`;
}
