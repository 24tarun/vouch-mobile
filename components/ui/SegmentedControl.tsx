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
  variant?: 'pill' | 'traffic';
  trafficOrientation?: 'horizontal' | 'vertical';
  trafficStandalone?: boolean;
}

export function SegmentedControl({
  items,
  activeKey,
  onChange,
  variant = 'pill',
  trafficOrientation = 'horizontal',
  trafficStandalone = false,
}: SegmentedControlProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const trafficContainerStyle = [
    styles.trafficControl,
    trafficOrientation === 'vertical' ? styles.trafficControlVertical : styles.trafficControlHorizontal,
    trafficStandalone && styles.trafficControlStandalone,
  ];

  return (
    <View style={variant === 'traffic' ? trafficContainerStyle : styles.segControl}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        const badgeCount = item.badgeCount ?? 0;
        const showBadge = item.showBadge !== false && badgeCount > 0;
        const badgeText = badgeCount > 99 ? '99+' : String(badgeCount);
        const trafficColor = item.color ?? colors.surface;
        const activeGlowStyle = isActive
          ? {
              shadowColor: trafficColor,
              shadowOpacity: 0.49,
              shadowRadius: 7.5,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            }
          : null;

        return (
          <TouchableOpacity
            key={item.key}
            style={variant === 'traffic'
              ? [
                  styles.trafficPill,
                  trafficOrientation === 'horizontal' && styles.trafficPillHorizontal,
                  isActive ? styles.trafficPillActive : styles.trafficPillIdle,
                  activeGlowStyle,
                  { backgroundColor: trafficColor },
                ]
              : [styles.segOption, isActive && styles.segOptionActive]}
            onPress={() => onChange(item.key)}
            activeOpacity={0.8}
            accessibilityLabel={item.label}
          >
            {variant === 'traffic' ? (
              showBadge ? <Text style={styles.trafficLabel}>{badgeText}</Text> : null
            ) : (
              <>
                <Text style={[styles.segLabel, isActive && styles.segLabelActive]}>{item.label}</Text>
                {showBadge ? (
                  <View style={styles.segBadge}>
                    <Text style={styles.segBadgeText}>{badgeText}</Text>
                  </View>
                ) : null}
              </>
            )}
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
  segOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  segOptionActive: {
    backgroundColor: colors.surface,
  },
  segLabel: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textSubtle,
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
  trafficControl: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  trafficControlHorizontal: {
    flexDirection: 'row',
    gap: 8,
  },
  trafficControlVertical: {
    flexDirection: 'column',
    gap: 8,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0,
  },
  trafficControlStandalone: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0,
  },
  trafficPill: {
    minWidth: 100,
    height: 20,
    borderRadius: 999,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  trafficPillIdle: {
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  trafficPillActive: {
    borderWidth: 0.75,
    borderColor: 'rgba(255,255,255,0.92)',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  trafficPillHorizontal: {
    flex: 1,
    minWidth: 0,
  },
  trafficLabel: {
    fontSize: typography.base,
    lineHeight: 18,
    fontWeight: typography.bold,
    color: '#ffffff',
  },
});
