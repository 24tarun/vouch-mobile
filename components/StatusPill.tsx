import { StyleSheet, Text, View } from 'react-native';
import { radius } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

// Labels — match vouch-web's formatTaskStatusLabel exactly
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  POSTPONED: 'Postponed',
  MARKED_COMPLETE: 'Marked Complete',
  AWAITING_VOUCHER: 'Awaiting Voucher',
  AWAITING_AI: 'Awaiting AI',
  AI_DENIED: 'AI Denied',
  AWAITING_USER: 'Awaiting User',
  ESCALATED: 'Escalated',
  ACCEPTED: 'Accepted',
  AUTO_ACCEPTED: 'Auto Accepted',
  AI_ACCEPTED: 'AI Accepted',
  DENIED: 'Denied',
  MISSED: 'Missed',
  RECTIFIED: 'Rectified',
  SETTLED: 'Override',   // vouch-web renders SETTLED as "OVERRIDE"
  DELETED: 'Deleted',
};

// Per-status color tokens — translated from vouch-web's TASK_STATUS_BADGE_CLASS_BY_STATUS
// Opacity hex suffixes: /10=1A /15=26 /20=33 /30=4D /35=59 /40=66 /50=80
interface StatusStyle {
  text: string;
  bg: string;
  border: string;
}

const STATUS_STYLE: Record<string, StatusStyle> = {
  ACTIVE: {
    text: '#93C5FD',        // blue-300
    bg: '#3B82F633',        // blue-500/20
    border: '#3B82F64D',    // blue-500/30
  },
  POSTPONED: {
    text: '#66A3FF',
    bg: '#0066FF33',        // #0066FF/20
    border: '#0066FF66',    // #0066FF/40
  },
  MARKED_COMPLETE: {
    text: '#34D399',        // emerald-400
    bg: '#34D39926',        // emerald-400/15
    border: '#34D39959',    // emerald-400/35
  },
  AWAITING_VOUCHER: {
    text: '#FBBF24',        // amber-400
    bg: '#FBBF2426',        // amber-400/15
    border: '#FBBF2459',    // amber-400/35
  },
  AWAITING_AI: {
    text: '#FBBF24',
    bg: '#FBBF2426',
    border: '#FBBF2459',
  },
  AI_DENIED: {
    text: '#EF4444',        // red-500
    bg: '#EF44441A',        // red-500/10
    border: '#EF44444D',    // red-500/30
  },
  AWAITING_USER: {
    text: '#FDBA74',        // orange-300
    bg: '#F9731633',        // orange-500/20
    border: '#F973164D',    // orange-500/30
  },
  ESCALATED: {
    text: '#93C5FD',        // blue-300
    bg: '#3B82F633',        // blue-500/20
    border: '#3B82F64D',    // blue-500/30
  },
  ACCEPTED: {
    text: '#6EE7B7',        // emerald-300
    bg: '#10B98133',        // emerald-500/20
    border: '#10B9814D',    // emerald-500/30
  },
  AUTO_ACCEPTED: {
    text: '#6EE7B7',
    bg: '#10B98133',
    border: '#10B9814D',
  },
  AI_ACCEPTED: {
    text: '#6EE7B7',
    bg: '#10B98133',
    border: '#10B9814D',
  },
  DENIED: {
    text: '#EF4444',
    bg: '#EF44441A',
    border: '#EF44444D',
  },
  MISSED: {
    text: '#EF4444',
    bg: '#EF44441A',
    border: '#EF44444D',
  },
  RECTIFIED: {
    text: '#FDBA74',        // orange-300
    bg: '#F9731633',        // orange-500/20
    border: '#F973164D',    // orange-500/30
  },
  DELETED: {
    text: '#CBD5E1',        // slate-300
    bg: '#47556966',        // slate-600/40
    border: '#47556980',    // slate-600/50
  },
  SETTLED: {
    text: '#F0ABFC',        // fuchsia-300
    bg: '#A21CAF33',        // fuchsia-700/20
    border: '#A21CAF66',    // fuchsia-700/40
  },
  SUCCESS: {
    text: '#6EE7B7',
    bg: '#10B98133',
    border: '#10B9814D',
  },
  WARNING: {
    text: '#FBBF24',
    bg: '#FBBF2426',
    border: '#FBBF2459',
  },
  DANGER: {
    text: '#EF4444',
    bg: '#EF44441A',
    border: '#EF44444D',
  },
  INFO: {
    text: '#93C5FD',
    bg: '#3B82F633',
    border: '#3B82F64D',
  },
  PROOF: {
    text: '#F472B6',
    bg: '#F472B61A',
    border: '#F472B659',
  },
  NEUTRAL: {
    text: '#CBD5E1',
    bg: '#47556933',
    border: '#47556966',
  },
};

// Exported so task detail timeline dots can use the text color
export const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_STYLE).map(([k, v]) => [k, v.text])
);

interface StatusPillProps {
  status?: string;
  label?: string;
  tone?: string;
  preserveStatus?: boolean;
  size?: 'small' | 'large';
}

function formatFallbackLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusPill({
  status,
  label,
  tone,
  preserveStatus = false,
  size = 'small',
}: StatusPillProps) {
  // MARKED_COMPLETE is a transient internal state; surface it as AWAITING_VOUCHER everywhere
  const baseStatus = status ?? tone ?? 'NEUTRAL';
  const resolvedStatus = preserveStatus
    ? baseStatus
    : (baseStatus === 'MARKED_COMPLETE' ? 'AWAITING_VOUCHER' : baseStatus);
  const styleKey = tone ?? resolvedStatus;
  const style = STATUS_STYLE[styleKey];
  const resolvedLabel = label ?? STATUS_LABEL[resolvedStatus] ?? formatFallbackLabel(resolvedStatus);
  const { colors } = useTheme();
  const isLarge = size === 'large';

  if (!style) {
    return (
      <View style={[styles.pill, isLarge && styles.pillLarge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Text style={[styles.label, isLarge && styles.labelLarge, { color: colors.textMuted }]}>{resolvedLabel}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.pill, isLarge && styles.pillLarge, { backgroundColor: style.bg, borderColor: style.border }]}>
      <Text style={[styles.label, isLarge && styles.labelLarge, { color: style.text }]}>{resolvedLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  pillLarge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  labelLarge: {
    fontSize: 13,
  },
});
