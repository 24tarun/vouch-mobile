import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import type { DashboardSortMode } from '@/lib/hooks/useTasks';
import { makeStyles } from './styles';

const localStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 29,
    elevation: 13,
  },
});

interface SortAnchor {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
}

interface SortOption {
  mode: DashboardSortMode;
  label: string;
}

interface TaskSortMenuProps {
  open: boolean;
  anchor: SortAnchor | null;
  sortMenuWidth: number;
  options: SortOption[];
  sortMode: DashboardSortMode;
  onChangeSortMode: (mode: DashboardSortMode) => void;
  onClose: () => void;
}

export function TaskSortMenu({
  open,
  anchor,
  sortMenuWidth,
  options,
  sortMode,
  onChangeSortMode,
  onClose,
}: TaskSortMenuProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  if (!open || !anchor) {
    return null;
  }

  return (
    <>
      <Pressable style={localStyles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sortDropdown,
          {
            top: anchor.pageY + anchor.height + 8,
            left: Math.max(spacing.lg, anchor.pageX + anchor.width - sortMenuWidth),
            width: sortMenuWidth,
          },
        ]}
      >
        {options.map((option) => (
          <TouchableOpacity
            key={option.mode}
            style={styles.sortDropdownItem}
            activeOpacity={0.75}
            onPress={() => {
              onChangeSortMode(option.mode);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Text style={styles.sortDropdownText}>{option.label}</Text>
            {sortMode === option.mode && (
              <Feather name="check" size={16} color={colors.accentCyan} />
            )}
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}
