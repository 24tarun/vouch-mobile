import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusPill, STATUS_COLOR } from '@/components/StatusPill';
import type { AiVouch, Task, TaskEvent } from '@/lib/types';
import { type Colors, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

const EVENT_LABEL: Record<string, string> = {
  ACTIVE: 'Task created',
  MARK_COMPLETE: 'Marked complete',
  UNDO_COMPLETE: 'Completion undone',
  PROOF_UPLOADED: 'Proof uploaded',
  PROOF_UPLOAD_FAILED_REVERT: 'Proof upload failed',
  PROOF_REMOVED: 'Proof removed',
  PROOF_REQUESTED: 'Proof requested',
  VOUCHER_ACCEPT: 'Voucher accepted',
  VOUCHER_DENY: 'Voucher denied',
  VOUCHER_DELETE: 'Voucher removed',
  RECTIFY: 'Rectified',
  OVERRIDE: 'Override applied',
  DEADLINE_MISSED: 'Deadline missed',
  VOUCHER_TIMEOUT: 'Voucher timed out',
  POMO_COMPLETED: 'Pomodoro',
  DEADLINE_WARNING_1H: '1h left',
  DEADLINE_WARNING_5M: '5m left',
  DEADLINE_WARNING_10M: '10m left',
  GOOGLE_EVENT_CANCELLED: 'Google event cancelled',
  POSTPONE: 'Postponed',
  AI_DENIED: 'AI denied',
  AI_DENIED_AUTO_HOP: 'Moved to awaiting user',
  ESCALATE: 'Escalated',
  AI_ESCALATE_TO_HUMAN: 'Escalated to human voucher',
  ACCEPT_DENIAL: 'Denial accepted',
};

type TimelineEntry = {
  id: string;
  createdAt: string;
  status?: string;
  label?: string;
  tone?: string;
  detail?: string;
  preserveStatus?: boolean;
  renderAsPill?: boolean;
};

function formatTimelineTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

function formatPomoEventDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  if (safeSeconds < 60) return `${safeSeconds}s`;
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60}m`;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function getEventReason(event: TaskEvent): string | null {
  const rawReason = event.metadata?.reason;
  if (typeof rawReason !== 'string') return null;
  const trimmed = rawReason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAiDecisionDetail(
  event: TaskEvent,
  aiVouches: AiVouch[],
  usedAiVouchIds: Set<string>,
): string | null {
  const fromEvent = getEventReason(event);
  if (fromEvent) return fromEvent;

  const targetDecision = event.event_type === 'AI_DENIED' ? 'denied' : null;
  if (!targetDecision) return null;

  const eventTimeMs = new Date(event.created_at).getTime();
  if (!Number.isFinite(eventTimeMs)) return null;

  const candidates = aiVouches
    .filter((attempt) => attempt.decision === targetDecision)
    .filter((attempt) => !usedAiVouchIds.has(attempt.id))
    .sort((a, b) => {
      if (a.attempt_number !== b.attempt_number) return a.attempt_number - b.attempt_number;
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    });

  const beforeOrNearEvent = candidates.filter((attempt) => {
    const createdMs = new Date(attempt.created_at).getTime();
    return Number.isFinite(createdMs) && createdMs <= eventTimeMs + 300_000;
  });
  const match = (beforeOrNearEvent.at(-1) ?? candidates.at(0)) ?? null;
  if (!match) return null;
  usedAiVouchIds.add(match.id);
  const rawReason = typeof (match as any).reasoning === 'string'
    ? (match as any).reasoning
    : match.reason;
  const reason = (rawReason ?? '').trim();
  return reason.length > 0 ? reason : null;
}

function getEventSortPriority(event: TaskEvent): number {
  switch (event.event_type) {
    case 'ACTIVE':
      return 0;
    case 'MARK_COMPLETE':
      return 10;
    case 'PROOF_UPLOADED':
      return 20;
    case 'AI_DENIED':
      return 30;
    case 'AI_DENIED_AUTO_HOP':
      return 40;
    default:
      return 100;
  }
}

function compareTimelineEvents(a: TaskEvent, b: TaskEvent): number {
  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) return aTime - bTime;
  if (aValid !== bValid) return aValid ? -1 : 1;

  const aPriority = getEventSortPriority(a);
  const bPriority = getEventSortPriority(b);
  if (aPriority !== bPriority) return aPriority - bPriority;

  return a.id.localeCompare(b.id);
}

function getTimelineTone(event: TaskEvent): 'SUCCESS' | 'DANGER' | 'WARNING' | 'INFO' | 'PROOF' | 'NEUTRAL' {
  switch (event.event_type) {
    case 'MARK_COMPLETE':
    case 'VOUCHER_ACCEPT':
    case 'POMO_COMPLETED':
      return 'SUCCESS';
    case 'VOUCHER_DENY':
    case 'AI_DENIED':
    case 'AI_DENIED_AUTO_HOP':
    case 'DEADLINE_MISSED':
    case 'PROOF_UPLOAD_FAILED_REVERT':
    case 'ACCEPT_DENIAL':
      return 'DANGER';
    case 'DEADLINE_WARNING_1H':
    case 'DEADLINE_WARNING_10M':
    case 'DEADLINE_WARNING_5M':
    case 'VOUCHER_TIMEOUT':
    case 'PROOF_REQUESTED':
      return 'WARNING';
    case 'PROOF_UPLOADED':
    case 'PROOF_REMOVED':
      return 'PROOF';
    case 'ACTIVE':
    case 'UNDO_COMPLETE':
    case 'RECTIFY':
    case 'OVERRIDE':
    case 'POSTPONE':
    case 'ESCALATE':
    case 'AI_ESCALATE_TO_HUMAN':
    case 'GOOGLE_EVENT_CANCELLED':
      return 'INFO';
    default:
      return 'NEUTRAL';
  }
}

function makeTimelineEntry(event: TaskEvent, suffix: string, entry: Omit<TimelineEntry, 'id' | 'createdAt'>): TimelineEntry {
  return {
    id: `${event.id}:${suffix}`,
    createdAt: event.created_at,
    ...entry,
  };
}

function getReminderTimelineLabel(eventType: string): string | null {
  switch (eventType) {
    case 'DEADLINE_WARNING_1H':
      return '1hr Reminder Sent';
    case 'DEADLINE_WARNING_10M':
      return '10m Reminder Sent';
    case 'DEADLINE_WARNING_5M':
      return '5m Reminder Sent';
    default:
      return null;
  }
}

function buildTimelineEntries(event: TaskEvent, aiVouches: AiVouch[], usedAiVouchIds: Set<string>): TimelineEntry[] {
  const statusTransition =
    event.from_status !== event.to_status
      ? [makeTimelineEntry(event, 'status', { status: event.to_status, preserveStatus: true })]
      : [];
  const reminderLabel = getReminderTimelineLabel(event.event_type);

  if (event.event_type === 'ACTIVE') {
    return [makeTimelineEntry(event, 'status', { status: 'ACTIVE', preserveStatus: true })];
  }

  if (reminderLabel) {
    return [makeTimelineEntry(event, 'reminder', { label: reminderLabel, tone: 'WARNING' })];
  }

  switch (event.event_type) {
    case 'MARK_COMPLETE':
      return statusTransition.length > 0
        ? statusTransition
        : [
            makeTimelineEntry(event, 'action', {
              status: 'MARKED_COMPLETE',
              preserveStatus: true,
            }),
          ];
    case 'UNDO_COMPLETE':
      return [
        makeTimelineEntry(event, 'action', {
          label: 'Completion Undone',
          tone: 'INFO',
        }),
        ...statusTransition,
      ];
    case 'VOUCHER_ACCEPT':
      return statusTransition;
    case 'VOUCHER_DENY':
      return statusTransition;
    case 'AI_DENIED':
      return [
        makeTimelineEntry(event, 'action', {
          label: 'AI Denied',
          tone: 'DANGER',
          detail: resolveAiDecisionDetail(event, aiVouches, usedAiVouchIds) ?? undefined,
        }),
      ];
    case 'AI_DENIED_AUTO_HOP':
      return statusTransition;
    case 'PROOF_UPLOADED':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Uploaded', tone: 'PROOF' })];
    case 'PROOF_UPLOAD_FAILED_REVERT':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Upload Failed', tone: 'DANGER' })];
    case 'PROOF_REMOVED':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Removed', tone: 'PROOF' })];
    case 'PROOF_REQUESTED':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Requested', tone: 'WARNING' })];
    case 'POMO_COMPLETED': {
      const elapsedSeconds = Number(event.metadata?.elapsed_seconds ?? 0);
      const durationLabel = elapsedSeconds > 0 ? ` (${formatPomoEventDuration(elapsedSeconds)})` : '';
      return [makeTimelineEntry(event, 'action', {
        label: `Pomodoro${durationLabel}`,
        tone: 'INFO',
        renderAsPill: false,
      })];
    }
    case 'POSTPONE':
    case 'RECTIFY':
    case 'OVERRIDE':
    case 'DEADLINE_MISSED':
    case 'VOUCHER_TIMEOUT':
    case 'ESCALATE':
    case 'AI_ESCALATE_TO_HUMAN':
    case 'ACCEPT_DENIAL':
      if (statusTransition.length > 0) return statusTransition;
      break;
    default:
      if (statusTransition.length > 0) return statusTransition;
  }

  return [
    makeTimelineEntry(event, 'action', {
      label: EVENT_LABEL[event.event_type] ?? formatEnumLabel(event.event_type),
      tone: getTimelineTone(event),
    }),
  ];
}

function getTimelineEntryColor(entry: TimelineEntry, textMuted: string): string {
  const styleKey = entry.tone
    ?? (entry.preserveStatus ? entry.status : (entry.status === 'MARKED_COMPLETE' ? 'AWAITING_VOUCHER' : entry.status))
    ?? 'NEUTRAL';
  return STATUS_COLOR[styleKey] ?? textMuted;
}

type TaskTimelineProps = {
  task: Task;
  events: TaskEvent[];
  aiVouches?: AiVouch[];
};

export function TaskTimeline({ task, events, aiVouches = [] }: TaskTimelineProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const timelineEntries = useMemo(() => {
    const hasActiveEvent = events.some((e) => e.event_type === 'ACTIVE');
    const hasMarkCompleteEvent = events.some((e) => e.event_type === 'MARK_COMPLETE');
    const synthetic: TaskEvent[] = [];

    if (!hasActiveEvent) {
      synthetic.push({
        id: '__synthetic_active__',
        task_id: task.id,
        event_type: 'ACTIVE',
        actor_id: null,
        from_status: 'ACTIVE',
        to_status: 'ACTIVE',
        metadata: null,
        created_at: task.created_at,
      });
    }

    if (!hasMarkCompleteEvent && task.marked_completed_at) {
      synthetic.push({
        id: '__synthetic_mark_complete__',
        task_id: task.id,
        event_type: 'MARK_COMPLETE',
        actor_id: null,
        from_status: 'ACTIVE',
        to_status: 'MARKED_COMPLETE',
        metadata: null,
        created_at: task.marked_completed_at,
      });
    }

    const displayEvents = [...synthetic, ...events].sort(compareTimelineEvents);
    const usedAiVouchIds = new Set<string>();
    return displayEvents.flatMap((event) => buildTimelineEntries(event, aiVouches, usedAiVouchIds));
  }, [aiVouches, events, task.created_at, task.id, task.marked_completed_at]);

  if (timelineEntries.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Timeline</Text>
      <View style={styles.timeline}>
        {timelineEntries.map((entry, idx) => {
          const isRightSide = idx % 2 === 0;
          const isLast = idx === timelineEntries.length - 1;
          const entryColor = getTimelineEntryColor(entry, colors.textMuted);

          const pill = entry.renderAsPill === false ? (
            <Text style={[styles.timelineEventLabel, { color: entryColor }]} numberOfLines={2}>
              {entry.label}
            </Text>
          ) : (
            <StatusPill
              status={entry.status}
              label={entry.label}
              tone={entry.tone}
              preserveStatus={entry.preserveStatus}
            />
          );

          return (
            <View key={entry.id} style={styles.timelineRow}>
              <View style={styles.timelineSide}>
                {!isRightSide ? (
                  <View style={styles.timelineEntryLeft}>
                    <View style={styles.timelineStemRow}>
                      <View style={styles.timelinePillWrap}>{pill}</View>
                      <View style={[styles.timelineConnector, { backgroundColor: entryColor + '66' }]} />
                    </View>
                    <Text style={styles.timelineTime}>
                      {formatTimelineTimestamp(entry.createdAt)}
                    </Text>
                    {entry.detail ? <Text style={styles.timelineDetail} numberOfLines={3}>{entry.detail}</Text> : null}
                  </View>
                ) : null}
              </View>

              <View style={styles.timelineCenter}>
                <View style={[styles.timelineMarker, { backgroundColor: entryColor, borderColor: colors.bg }]} />
                {!isLast ? <View style={styles.timelineAxisSegment} /> : null}
              </View>

              <View style={styles.timelineSide}>
                {isRightSide ? (
                  <View style={styles.timelineEntryRight}>
                    <View style={styles.timelineStemRow}>
                      <View style={[styles.timelineConnector, { backgroundColor: entryColor + '66' }]} />
                      <View style={styles.timelinePillWrap}>{pill}</View>
                    </View>
                    <Text style={[styles.timelineTime, { textAlign: 'right' }]}>
                      {formatTimelineTimestamp(entry.createdAt)}
                    </Text>
                    {entry.detail ? <Text style={[styles.timelineDetail, { textAlign: 'right' }]} numberOfLines={3}>{entry.detail}</Text> : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  timeline: { paddingVertical: spacing.xs, paddingBottom: spacing.md },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch' },
  timelineSide: { flex: 1 },
  timelineCenter: { width: 12, alignItems: 'center' },
  timelineMarker: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  timelineAxisSegment: { width: 2, flex: 1, backgroundColor: colors.border },
  timelineEntryLeft: { paddingBottom: spacing.md, gap: spacing.xs },
  timelineEntryRight: { paddingBottom: spacing.md, gap: spacing.xs, alignItems: 'flex-end' },
  timelineStemRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  timelineConnector: { flex: 1, height: 2, minWidth: 8 },
  timelinePillWrap: { flexShrink: 1 },
  timelineEventLabel: { fontSize: typography.sm, fontWeight: typography.semibold, lineHeight: 20 },
  timelineTime: { fontSize: typography.xs, color: colors.textMuted, lineHeight: 16 },
  timelineDetail: { fontSize: typography.xs, color: colors.textMuted, lineHeight: 16 },
});
