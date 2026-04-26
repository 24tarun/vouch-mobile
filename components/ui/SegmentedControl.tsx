import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/lib/ThemeContext';
import { type Colors, typography } from '@/lib/theme';

export interface SegmentedControlItem {
  key: string;
  label: string;
  badgeCount?: number;
  showBadge?: boolean;
  color?: string;
}

interface SegmentedControlProps {
  items: SegmentedControlItem[];
  activeKey: string;
  onChange: (key: string) => void;
  variant?: 'default' | 'signal';
}

export function SegmentedControl({
  items,
  activeKey,
  onChange,
  variant = 'default',
}: SegmentedControlProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const isSignalVariant = variant === 'signal';

  return (
    <View style={[styles.segControl, isSignalVariant && styles.segControlSignal]}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        const badgeCount = item.badgeCount ?? 0;
        const showBadge = item.showBadge !== false && badgeCount > 0;
        const badgeText = badgeCount > 99 ? '99+' : String(badgeCount);
        const signalBadgeText = badgeCount > 9 ? '9+' : String(badgeCount);
        const signalColor = item.color ?? colors.accentCyan;

        return (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.segOption,
              isSignalVariant && styles.segOptionSignal,
              isActive && styles.segOptionActive,
              isSignalVariant
                ? {
                    borderColor: isActive ? signalColor : `${signalColor}66`,
                    backgroundColor: signalColor,
                    opacity: isActive ? 1 : 0.32,
                    shadowColor: signalColor,
                    shadowOpacity: isActive ? 0.52 : 0.12,
                    shadowRadius: isActive ? 10 : 3,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: isActive ? 6 : 0,
                  }
                : null,
            ]}
            onPress={() => onChange(item.key)}
            activeOpacity={0.8}
            accessibilityLabel={item.label}
          >
            {!isSignalVariant ? (
              <Text
                style={[
                  styles.segLabel,
                  isSignalVariant && styles.segLabelSignal,
                  isActive && styles.segLabelActive,
                  isSignalVariant
                    ? (isActive
                      ? styles.segLabelSignalActive
                      : styles.segLabelSignalInactive)
                    : null,
                ]}
              >
                {item.label}
              </Text>
            ) : null}
            {isSignalVariant && showBadge ? (
              <Text style={styles.segSignalCount}>
                {signalBadgeText}
              </Text>
            ) : null}
            {!isSignalVariant && showBadge ? (
              <View
                style={[
                  styles.segBadge,
                ]}
              >
                <Text style={styles.segBadgeText}>
                  {badgeText}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  segControl: {
    flexDirection: 'row',
    backgroundColor: colors.surface2,
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  segControlSignal: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 8,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  segOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  segOptionSignal: {
    width: 22,
    height: 22,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segOptionActive: {
    backgroundColor: colors.surface,
  },
  segLabel: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textSubtle,
  },
  segLabelSignal: {
    fontSize: typography.xs,
    color: colors.textMuted,
    letterSpacing: 0.15,
  },
  segLabelSignalActive: {
    color: '#FFFFFF',
  },
  segLabelSignalInactive: {
    color: 'rgba(255,255,255,0.72)',
  },
  segLabelActive: {
    color: colors.text,
  },
  segBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segBadgeText: {
    fontSize: 10,
    fontWeight: typography.bold,
    color: '#fff',
  },
  segSignalCount: {
    fontSize: 9,
    fontWeight: typography.bold,
    color: '#FFFFFF',
    lineHeight: 10,
    includeFontPadding: false,
  },
});
