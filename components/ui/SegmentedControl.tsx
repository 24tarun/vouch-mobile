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
}

export function SegmentedControl({
  items,
  activeKey,
  onChange,
}: SegmentedControlProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.segControl}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        const badgeCount = item.badgeCount ?? 0;
        const showBadge = item.showBadge !== false && badgeCount > 0;
        const badgeText = badgeCount > 99 ? '99+' : String(badgeCount);

        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.segOption, isActive && styles.segOptionActive]}
            onPress={() => onChange(item.key)}
            activeOpacity={0.8}
            accessibilityLabel={item.label}
          >
            <Text style={[styles.segLabel, isActive && styles.segLabelActive]}>{item.label}</Text>
            {showBadge ? (
              <View style={styles.segBadge}>
                <Text style={styles.segBadgeText}>{badgeText}</Text>
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
});
