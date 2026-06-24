import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { PageHeader } from '@/components/PageHeader';
import { TaskRow, type TaskRowData } from '@/components/TaskRow';
import { StatusPill } from '@/components/StatusPill';
import { StatsOverview } from '@/components/StatsOverview';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/tasks/styles';
import { spacing, typography } from '@/lib/theme';
import { useTasks } from '@/lib/hooks/useTasks';
import { useTaskSortMode } from '@/lib/hooks/useTaskSortMode';
import { useTaskSearch } from '@/lib/hooks/useTaskSearch';
import { useSettingsStats } from '@/lib/hooks/useSettingsStats';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';

const makeLocalStyles = (colors: ReturnType<typeof useTheme>['colors'], isDark: boolean) => StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  historyCardContent: {
    gap: 2,
    marginHorizontal: -spacing.sm,
  },
  searchShell: {
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  headerSafeArea: {
    paddingTop: 0,
  },
  compactSearchWrap: {
    minHeight: 36,
    paddingHorizontal: 10,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.sm,
    marginTop: 2,
    borderTopWidth: 1,
  },
  loadMoreText: {
    fontSize: typography.sm,
  },
});

export default function HistoryScreen() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const localStyles = useMemo(() => makeLocalStyles(colors, isDark), [colors, isDark]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sortMode] = useTaskSortMode();
  const { pastTasks, hasMorePast, loadingMore, loading, error, refetch, loadMorePastTasks } = useTasks(sortMode);
  const settingsStatsQuery = useSettingsStats();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { trimmedQuery, searchResults, searchLoading, searchError, refetchSearch } = useTaskSearch(searchQuery);

  useFocusEffect(
    useCallback(() => {
      refetch();
      if (trimmedQuery.length > 0) {
        refetchSearch();
      }
    }, [refetch, refetchSearch, trimmedQuery.length]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    refetch();
    settingsStatsQuery.refetch();
    if (trimmedQuery.length > 0) {
      refetchSearch();
    }
    setRefreshing(false);
  }, [refetch, refetchSearch, settingsStatsQuery, trimmedQuery.length]);

  const handleSearchResultPress = useCallback((task: TaskRowData) => {
    if (isOptimisticTaskId(task.id)) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }
    router.push(`/tasks/${task.id}` as any);
  }, [router]);

  const content = (() => {
    if (trimmedQuery.length > 0) {
      if (searchLoading) {
        return <Text style={styles.placeholder}>Searching tasks…</Text>;
      }
      if (searchError) {
        return <Text style={[styles.placeholder, { color: colors.destructive }]}>{searchError}</Text>;
      }
      if (searchResults.length === 0) {
        return <Text style={styles.placeholder}>No matching tasks found.</Text>;
      }

      return searchResults.map((task) => (
        <TouchableOpacity
          key={`history-search-${task.id}`}
          style={styles.searchResultRow}
          activeOpacity={0.7}
          onPress={() => handleSearchResultPress(task)}
          accessibilityRole="button"
          accessibilityLabel={task.title}
        >
          <Text style={styles.searchResultTitle} numberOfLines={1}>
            {task.title}
          </Text>
          <View style={styles.searchResultMeta}>
            {task.recurrence_rule_id ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                <Feather name="repeat" size={15} color="#C084FC" />
                {task.recurrence_paused_at ? <Feather name="pause" size={14} color="#C084FC" /> : null}
              </View>
            ) : null}
            {task.status ? <StatusPill status={task.status} /> : null}
            <Feather name="external-link" size={14} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
      ));
    }

    if (loading) {
      return (
        <>
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: spacing.xxl }} />
          <Text style={styles.placeholder}>Loading past tasks…</Text>
        </>
      );
    }
    if (error) {
      return <Text style={[styles.placeholder, { color: colors.destructive }]}>{error}</Text>;
    }
    if (pastTasks.length === 0) {
      return <Text style={styles.placeholder}>No past tasks yet.</Text>;
    }

    return (
      <>
        {pastTasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
        {hasMorePast ? (
          <TouchableOpacity
            style={[localStyles.loadMoreBtn, { borderTopColor: colors.border }]}
            onPress={loadMorePastTasks}
            disabled={loadingMore}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Load more past tasks"
          >
            {loadingMore ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Text style={[localStyles.loadMoreText, { color: colors.textMuted }]}>Load more</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </>
    );
  })();

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={[localStyles.headerSafeArea, { paddingTop: insets.top }]}>
        <PageHeader title="History" />
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.taskList, { paddingTop: 0, paddingBottom: spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textMuted}
            colors={[colors.textMuted]}
          />
        }
      >
        <View style={localStyles.content}>
          <View style={localStyles.section}>
            <StatsOverview
              totalTasks={settingsStatsQuery.data?.totalTasks}
              accepted={settingsStatsQuery.data?.accepted}
              denied={settingsStatsQuery.data?.denied}
              missed={settingsStatsQuery.data?.missed}
              totalVouched={settingsStatsQuery.data?.totalVouched}
              focusedSeconds={settingsStatsQuery.data?.focusedSeconds}
              loading={settingsStatsQuery.loading}
              error={settingsStatsQuery.error}
            />
          </View>

          <View style={localStyles.section}>
            <View style={localStyles.searchShell}>
              <View style={[styles.searchSheetInputWrap, localStyles.compactSearchWrap]}>
                <Feather name="search" size={16} color={colors.textMuted} />
                <TextInput
                  style={styles.searchSheetInput}
                  placeholder="Search tasks..."
                  placeholderTextColor={colors.textSubtle}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            </View>
            <View style={localStyles.sectionDivider} />
            <View style={localStyles.historyCardContent}>
              {content}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
