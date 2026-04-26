import { Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, interpolate, interpolateColor, type SharedValue } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { radius } from '@/lib/theme';
import { StatusPill } from '@/components/StatusPill';
import type { TaskRowData } from '@/components/TaskRow';

interface SearchAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TaskSearchOverlayProps {
  visible: boolean;
  anchor: SearchAnchor | null;
  expandProgress: SharedValue<number>;
  screenWidth: number;
  targetTop: number;
  targetHeight: number;
  searchInputRef: React.RefObject<TextInput | null>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: TaskRowData[];
  onResultPress: (task: TaskRowData) => void;
  onClose: () => void;
}

export function TaskSearchOverlay({
  visible,
  anchor,
  expandProgress,
  screenWidth,
  targetTop,
  targetHeight,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  searchLoading,
  searchError,
  searchResults,
  onResultPress,
  onClose,
}: TaskSearchOverlayProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const trimmedQuery = searchQuery.trim();

  const animatedOverlayStyle = useAnimatedStyle(() => ({
    top: interpolate(expandProgress.value, [0, 1], [anchor?.y ?? 0, targetTop]),
    left: interpolate(expandProgress.value, [0, 1], [anchor?.x ?? 0, 0]),
    width: interpolate(expandProgress.value, [0, 1], [anchor?.width ?? screenWidth, screenWidth]),
    height: interpolate(expandProgress.value, [0, 1], [anchor?.height ?? 0, targetHeight]),
    borderTopLeftRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, radius.xl]),
    borderTopRightRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, radius.xl]),
    borderBottomLeftRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, 0]),
    borderBottomRightRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, 0]),
    borderColor: interpolateColor(expandProgress.value, [0, 1], [colors.border, colors.borderStrong]),
  }));

  if (!visible || !anchor) {
    return null;
  }

  return (
    <>
      <Pressable style={styles.creatorOverlayBackdrop} onPress={onClose} />
      <Animated.View style={[styles.creatorOverlay, animatedOverlayStyle]}>
        <View style={styles.searchSheetHeader}>
          <View style={styles.searchSheetInputWrap}>
            <Feather name="search" size={16} color={colors.textMuted} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchSheetInput}
              placeholder="Search tasks"
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          <TouchableOpacity
            style={styles.searchSheetClose}
            onPress={onClose}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <Feather name="x" size={17} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView
          style={styles.creatorBody}
          contentContainerStyle={styles.searchSheetContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {trimmedQuery.length === 0 ? (
            <Text style={styles.placeholder}>Type to search your tasks.</Text>
          ) : searchLoading ? (
            <Text style={styles.placeholder}>Searching tasks…</Text>
          ) : searchError ? (
            <Text style={[styles.placeholder, { color: colors.destructive }]}>{searchError}</Text>
          ) : searchResults.length === 0 ? (
            <Text style={styles.placeholder}>No matching tasks found.</Text>
          ) : (
            searchResults.map((task) => (
              <TouchableOpacity
                key={`sheet-search-${task.id}`}
                style={styles.searchResultRow}
                activeOpacity={0.75}
                onPress={() => onResultPress(task)}
                accessibilityRole="button"
                accessibilityLabel={task.title}
              >
                <Text style={styles.searchResultTitle} numberOfLines={1}>{task.title}</Text>
                <View style={styles.searchResultMeta}>
                  {task.status ? <StatusPill status={task.status} /> : null}
                  <Feather name="external-link" size={14} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </>
  );
}
