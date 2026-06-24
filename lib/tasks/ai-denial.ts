import type { AiVouch, TaskEvent } from '@/lib/types';

function eventReason(event: TaskEvent): string | null {
  const rawReason = event.metadata?.reason;
  if (typeof rawReason !== 'string') return null;
  const reason = rawReason.trim();
  return reason.length > 0 ? reason : null;
}

export function getLatestAiDenialReason(aiVouches: AiVouch[], events: TaskEvent[]): string | null {
  const denialVouches = aiVouches
    .filter((vouch) => vouch.decision === 'denied')
    .sort((a, b) => {
      if (a.attempt_number !== b.attempt_number) return a.attempt_number - b.attempt_number;
      const aTime = new Date(a.vouched_at).getTime();
      const bTime = new Date(b.vouched_at).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });

  for (let i = denialVouches.length - 1; i >= 0; i -= 1) {
    const reason = (denialVouches[i].reason ?? '').trim();
    if (reason) return reason;
  }

  const denialEvents = events.filter((event) => event.event_type === 'AI_DENY' || event.event_type === 'AI_DENIED');
  for (let i = denialEvents.length - 1; i >= 0; i -= 1) {
    const reason = eventReason(denialEvents[i]);
    if (reason) return reason;
  }

  return null;
}
