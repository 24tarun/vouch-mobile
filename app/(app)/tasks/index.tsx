import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { TaskRow } from '@/components/TaskRow';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { StatusPill } from '@/components/StatusPill';
import { parseTitleForDeadline, titleHasDeadlineToken } from '@/lib/task-title-parser';
import { useFriends } from '@/lib/hooks/useFriends';
import { useTasks, type DashboardSortMode } from '@/lib/hooks/useTasks';
import { supabase } from '@/lib/supabase';
import type { TaskRowData } from '@/components/TaskRow';
import { useAuth } from '@/hooks/useAuth';


function getOrdinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

function formatTodayHeading(): string {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const monthName = now.toLocaleDateString('en-GB', { month: 'long' });
  return `${dayName} ${getOrdinal(now.getDate())} ${monthName}`;
}

const SORT_OPTIONS: { mode: DashboardSortMode; label: string }[] = [
  { mode: 'deadline_asc', label: 'Sort by deadline ascending' },
  { mode: 'deadline_desc', label: 'Sort by deadline descending' },
  { mode: 'created_asc', label: 'Sort by time created ascending' },
  { mode: 'created_desc', label: 'Sort by time created descending' },
];

export default function TasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: authProfile, user } = useAuth();
  const titleInputRef = useRef<TextInput | null>(null);
  const [sortMode, setSortMode] = useState<DashboardSortMode>('deadline_asc');
  const {
    dueSoonTasks,
    futureTasks,
    pastTasks,
    hasMorePast,
    loadingMore,
    refetch: refetchTasks,
    loadMorePastTasks,
  } = useTasks(sortMode);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<TaskRowData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);
  const searchSlideAnim = useRef(new Animated.Value(0)).current;
  const sortButtonRef = useRef<View | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<{ pageX: number; pageY: number; width: number; height: number } | null>(null);

  const [title, setTitle] = useState('');
  const [deadlineDate, setDeadlineDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return d;
  });
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  // voucherValue: null = unset, 'self' = self-vouch, otherwise a friend's user id
  const [voucherValue, setVoucherValue] = useState<string | null>(null);
  const [voucherSearch, setVoucherSearch] = useState('');
  // failureCostCents stored as string so the TextInput can be freeform
  const [failureCostInput, setFailureCostInput] = useState('');

  const { friends, currentUserId, profile, loading: friendsLoading, error: friendsError } = useFriends();

  // Pre-fill failure cost from profile default once loaded
  useEffect(() => {
    if (profile && !failureCostInput) {
      const amount = profile.default_failure_cost_cents / 100;
      setFailureCostInput(String(amount % 1 === 0 ? Math.round(amount) : amount.toFixed(2)));
    }
  }, [profile]);

  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [repetitionsEnabled, setRepetitionsEnabled] = useState(false);
  const [eventSyncEnabled, setEventSyncEnabled] = useState(false);
  const trimmedSearchQuery = searchQuery.trim();
  const isSearchActive = trimmedSearchQuery.length > 0;

  useEffect(() => {
    if (!isSearchActive) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          if (!cancelled) {
            setSearchResults([]);
            setSearchLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, deadline, status')
          .eq('user_id', userId)
          .neq('status', 'DELETED')
          .ilike('title', `%${trimmedSearchQuery}%`)
          .order('updated_at', { ascending: false })
          .limit(100);

        if (cancelled) return;
        if (error) {
          setSearchResults([]);
          setSearchError(error.message || 'Search failed');
          setSearchLoading(false);
          return;
        }

        setSearchResults((data as TaskRowData[]) ?? []);
        setSearchError(null);
        setSearchLoading(false);
      } catch (error: any) {
        if (cancelled) return;
        setSearchResults([]);
        setSearchError(error?.message ?? 'Search failed');
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isSearchActive, trimmedSearchQuery]);

  function handleTitleChange(text: string) {
    setTitle(text);
    const parsed = parseTitleForDeadline(text, deadlineDate);
    if (parsed) setDeadlineDate(parsed);
  }

  function handleDatePickerChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (!selected) return;
    if (datePickerMode === 'date') {
      const next = new Date(selected);
      next.setHours(deadlineDate.getHours(), deadlineDate.getMinutes(), 0, 0);
      setDeadlineDate(next);
      if (Platform.OS === 'android') {
        setDatePickerMode('time');
        setShowAndroidPicker(true);
      }
    } else {
      const next = new Date(deadlineDate);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      setDeadlineDate(next);
    }
  }

  useEffect(() => {
    if (!creatorOpen) return;
    const id = setTimeout(() => titleInputRef.current?.focus(), 180);
    return () => clearTimeout(id);
  }, [creatorOpen]);

  const voucherLabel = useMemo(() => {
    if (!voucherValue) return 'Select voucher';
    if (voucherValue === 'self') return 'Self vouch';
    return friends.find((f) => f.id === voucherValue)?.username ?? 'Select voucher';
  }, [voucherValue, friends]);

  const filteredFriends = useMemo(() => {
    const q = voucherSearch.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.username.toLowerCase().includes(q));
  }, [friends, voucherSearch]);

  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
  const voucherButtonRef = useRef<View>(null);
  const [voucherAnchor, setVoucherAnchor] = useState<{ pageX: number; pageY: number; width: number } | null>(null);
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const maxSearchWidth = Math.max(180, screenWidth - spacing.lg * 2 - 44);
  const sortMenuWidth = Math.min(screenWidth - spacing.lg * 2, 320);

  function openSortMenu() {
    sortButtonRef.current?.measureInWindow((x, y, width, height) => {
      setSortAnchor({ pageX: x, pageY: y, width, height });
      setSortMenuOpen(true);
    });
  }

  useEffect(() => {
    Animated.timing(searchSlideAnim, {
      toValue: isSearchOpen ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();

    if (isSearchOpen) {
      const focusTimeout = setTimeout(() => searchInputRef.current?.focus(), 120);
      return () => clearTimeout(focusTimeout);
    }
    searchInputRef.current?.blur();
  }, [isSearchOpen, searchSlideAnim]);

  function closeVoucherPicker() {
    setVoucherPickerOpen(false);
    setVoucherSearch('');
  }

  function closeCreator() {
    closeVoucherPicker();
    setCreatorOpen(false);
  }

  function openVoucherPicker() {
    // measureInWindow gives true screen coords even from inside a Modal
    voucherButtonRef.current?.measureInWindow((x, y, width) => {
      setVoucherAnchor({ pageX: x, pageY: y, width });
      setVoucherPickerOpen(true);
    });
  }

  const currencySymbol = profile?.currency === 'EUR' ? '€'
    : profile?.currency === 'INR' ? '₹'
    : '$';
  const displayName = (authProfile?.username || user?.email?.split('@')[0] || 'there').trim();
  const todayLabel = formatTodayHeading();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.taskHeader}>
        <View style={styles.taskHeaderTopRow}>
          <Text style={styles.taskGreeting}>Hello, {displayName}</Text>
          <View style={styles.searchRow}>
            <View ref={sortButtonRef} collapsable={false}>
              <TouchableOpacity
                style={styles.sortTriggerButton}
                onPress={openSortMenu}
                accessibilityRole="button"
                accessibilityLabel="Sort tasks"
                activeOpacity={0.8}
              >
                <Ionicons name="swap-vertical-outline" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {!isSearchOpen && (
              <TouchableOpacity
                style={styles.searchIconButton}
                onPress={() => setIsSearchOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Open task search"
                activeOpacity={0.8}
              >
                <Feather name="search" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {isSearchOpen && (
              <Animated.View
                style={[
                  styles.searchAnimatedWrap,
                  {
                    width: searchSlideAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, maxSearchWidth],
                    }),
                  },
                ]}
              >
                <View style={styles.searchContainer}>
                  <TouchableOpacity
                    style={styles.searchIconButton}
                    onPress={() => {
                      setSearchQuery('');
                      setIsSearchOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Close task search"
                    activeOpacity={0.8}
                  >
                    <Feather name="search" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TextInput
                    ref={searchInputRef}
                    style={styles.searchInput}
                    placeholderTextColor={colors.textMuted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setSearchQuery('');
                        setIsSearchOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Clear task search"
                      hitSlop={8}
                    >
                      <Feather name="x-circle" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              </Animated.View>
            )}
          </View>
        </View>
        <Text style={styles.taskDate}>Its {todayLabel}.</Text>
      </View>
      {sortMenuOpen && sortAnchor && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSortMenuOpen(false)} />
          <View
            style={[
              styles.sortDropdown,
              {
                top: sortAnchor.pageY + sortAnchor.height + 8,
                left: Math.max(spacing.lg, sortAnchor.pageX + sortAnchor.width - sortMenuWidth),
                width: sortMenuWidth,
              },
            ]}
          >
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.mode}
                style={styles.sortDropdownItem}
                activeOpacity={0.75}
                onPress={() => {
                  setSortMode(option.mode);
                  setSortMenuOpen(false);
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
      )}
      <ScrollView style={styles.body} contentContainerStyle={styles.taskList}>
        {isSearchActive ? (
          <>
            {searchLoading ? (
              <Text style={styles.placeholder}>Searching tasks…</Text>
            ) : searchError ? (
              <Text style={[styles.placeholder, { color: colors.destructive }]}>{searchError}</Text>
            ) : searchResults.length === 0 ? (
              <Text style={styles.placeholder}>No matching tasks found.</Text>
            ) : (
              searchResults.map((task) => (
                <TouchableOpacity
                  key={`search-${task.id}`}
                  style={styles.searchResultRow}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/tasks/${task.id}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={task.title}
                >
                  <Text style={styles.searchResultTitle} numberOfLines={2}>
                    {task.title}
                  </Text>
                  <View style={styles.searchResultMeta}>
                    {task.status && <StatusPill status={task.status} />}
                    <Feather name="external-link" size={14} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : dueSoonTasks.length === 0 && futureTasks.length === 0 && pastTasks.length === 0 ? (
          <Text style={styles.placeholder}>Your tasks will appear here.</Text>
        ) : (
          <>
            {dueSoonTasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
            <CollapsibleSection title="Future" tasks={futureTasks} />
            <CollapsibleSection
              title="Past"
              tasks={pastTasks}
              hasMore={hasMorePast}
              loadingMore={loadingMore}
              onLoadMore={loadMorePastTasks}
            />
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 72 }]}
        onPress={() => setCreatorOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Create task"
      >
        <Feather name="plus" size={24} color={colors.primaryFg} />
      </TouchableOpacity>

      <Modal
        visible={creatorOpen}
        animationType="slide"
        transparent
        onRequestClose={closeCreator}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.backdropTapTarget} onPress={closeCreator} />

          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Create Task</Text>
              <TouchableOpacity
                onPress={closeCreator}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Close task creator"
              >
                <Feather name="x" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetContent}
            >
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Core Fields</Text>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Task title</Text>
                  <TextInput
                    ref={titleInputRef}
                    style={styles.textInput}
                    placeholder="What do you need to finish?"
                    placeholderTextColor={colors.textSubtle}
                    value={title}
                    onChangeText={handleTitleChange}
                    returnKeyType="done"
                    autoFocus
                  />
                </View>

                <View style={styles.field}>
                  <View style={styles.fieldLabelRow}>
                    <Text style={styles.fieldLabel}>Deadline</Text>
                    {titleHasDeadlineToken(title) && (
                      <View style={styles.parsedDot} />
                    )}
                  </View>
                  {Platform.OS === 'ios' ? (
                    <DateTimePicker
                      value={deadlineDate}
                      mode="datetime"
                      display="compact"
                      minimumDate={new Date()}
                      onChange={handleDatePickerChange}
                      themeVariant="dark"
                      accentColor={colors.warning}
                      style={styles.datePicker}
                    />
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.selectButton}
                        onPress={() => { setDatePickerMode('date'); setShowAndroidPicker(true); }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.selectLabel}>
                          {deadlineDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          {'  '}
                          {deadlineDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </Text>
                        <Feather name="calendar" size={18} color={colors.warning} />
                      </TouchableOpacity>
                      {showAndroidPicker && (
                        <DateTimePicker
                          value={deadlineDate}
                          mode={datePickerMode}
                          display="default"
                          minimumDate={new Date()}
                          onChange={handleDatePickerChange}
                        />
                      )}
                    </>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Voucher</Text>
                  <View ref={voucherButtonRef} collapsable={false}>
                    <TouchableOpacity
                      style={styles.selectButton}
                      onPress={openVoucherPicker}
                      activeOpacity={0.8}
                    >
                      {voucherValue && voucherValue !== 'self' ? (
                        <View style={styles.selectedFriendRow}>
                          <View style={styles.avatarSmall}>
                            <Text style={styles.avatarSmallText}>
                              {friends.find(f => f.id === voucherValue)?.initial ?? '?'}
                            </Text>
                          </View>
                          <Text style={styles.selectLabel}>{voucherLabel}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.selectLabel, !voucherValue && { color: colors.textSubtle }]}>
                          {voucherLabel}
                        </Text>
                      )}
                      <Feather name="chevron-down" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Failure cost</Text>
                  <View style={styles.failureCostRow}>
                    <View style={styles.currencyBadge}>
                      <Text style={styles.currencySymbol}>{currencySymbol}</Text>
                    </View>
                    <TextInput
                      style={styles.failureCostInput}
                      value={failureCostInput}
                      onChangeText={(t) => setFailureCostInput(t.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder={friendsLoading ? '…' : '0'}
                      placeholderTextColor={colors.textSubtle}
                      returnKeyType="done"
                    />
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>More Options (Placeholder)</Text>

                <View style={styles.placeholderRow}>
                  <View style={styles.placeholderRowTextWrap}>
                    <Text style={styles.placeholderRowTitle}>Reminders</Text>
                    <Text style={styles.placeholderRowSub}>
                      Placeholder controls for reminder offsets.
                    </Text>
                  </View>
                  <Switch
                    value={remindersEnabled}
                    onValueChange={setRemindersEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>

                <View style={styles.placeholderRow}>
                  <View style={styles.placeholderRowTextWrap}>
                    <Text style={styles.placeholderRowTitle}>Repetitions</Text>
                    <Text style={styles.placeholderRowSub}>
                      Placeholder recurrence controls.
                    </Text>
                  </View>
                  <Switch
                    value={repetitionsEnabled}
                    onValueChange={setRepetitionsEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>

                <View style={styles.placeholderRow}>
                  <View style={styles.placeholderRowTextWrap}>
                    <Text style={styles.placeholderRowTitle}>Event Toggle</Text>
                    <Text style={styles.placeholderRowSub}>
                      Placeholder calendar event sync toggle.
                    </Text>
                  </View>
                  <Switch
                    value={eventSyncEnabled}
                    onValueChange={setEventSyncEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
          {voucherPickerOpen && voucherAnchor && (
            <>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeVoucherPicker} />
              <View
                style={[
                  styles.voucherDropdown,
                  {
                    left: voucherAnchor.pageX,
                    width: voucherAnchor.width,
                    bottom: screenHeight - voucherAnchor.pageY + 6,
                  },
                ]}
              >
                <View style={styles.voucherSearch}>
                  <Feather name="search" size={14} color={colors.textMuted} />
                  <TextInput
                    style={styles.voucherSearchInput}
                    placeholder="Search friends..."
                    placeholderTextColor={colors.textMuted}
                    value={voucherSearch}
                    onChangeText={setVoucherSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {voucherSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setVoucherSearch('')} hitSlop={8}>
                      <Feather name="x-circle" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.voucherDropdownScroll}
                >
                  {!voucherSearch && (
                    <TouchableOpacity
                      style={[styles.voucherRow, voucherValue === 'self' && styles.voucherRowSelected]}
                      onPress={() => { setVoucherValue('self'); closeVoucherPicker(); }}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.avatar, styles.avatarSelf]}>
                        <Feather name="user" size={14} color={colors.textMuted} />
                      </View>
                      <View style={styles.voucherRowText}>
                        <Text style={styles.voucherName}>Self vouch</Text>
                        <Text style={styles.voucherSub}>Only you can verify</Text>
                      </View>
                      {voucherValue === 'self' && (
                        <Feather name="check" size={16} color={colors.text} />
                      )}
                    </TouchableOpacity>
                  )}

                  {friendsLoading ? (
                    <Text style={styles.voucherHint}>Loading friends…</Text>
                  ) : friendsError ? (
                    <Text style={[styles.voucherHint, { color: colors.destructive }]}>{friendsError}</Text>
                  ) : filteredFriends.length === 0 ? (
                    <Text style={styles.voucherHint}>
                      {voucherSearch ? 'No matches.' : 'No friends yet.'}
                    </Text>
                  ) : (
                    filteredFriends.map((friend) => (
                      <TouchableOpacity
                        key={friend.id}
                        style={[styles.voucherRow, voucherValue === friend.id && styles.voucherRowSelected]}
                        onPress={() => { setVoucherValue(friend.id); closeVoucherPicker(); }}
                        activeOpacity={0.75}
                      >
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>{friend.initial}</Text>
                        </View>
                        <Text style={styles.voucherName}>{friend.username}</Text>
                        {voucherValue === friend.id && (
                          <Feather name="check" size={16} color={colors.text} />
                        )}
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  taskHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 2,
  },
  taskHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  taskGreeting: {
    flexShrink: 1,
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  taskDate: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sortTriggerButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchAnimatedWrap: {
    overflow: 'hidden',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.sm,
    paddingVertical: 0,
  },
  body: {
    flex: 1,
  },
  taskList: {
    flexGrow: 1,
  },
  placeholder: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultTitle: {
    flex: 1,
    fontSize: typography.base,
    color: colors.text,
  },
  searchResultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  sortDropdown: {
    position: 'absolute',
    backgroundColor: '#0b1a38',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#20345d',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
    zIndex: 30,
  },
  sortDropdownItem: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sortDropdownText: {
    flex: 1,
    fontSize: typography.base,
    color: '#d7dce8',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdropTapTarget: {
    flex: 1,
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    paddingTop: spacing.md,
  },
  sheetHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: typography.lg,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  sheetContent: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: typography.semibold,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  parsedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  textInput: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: typography.base,
  },
  selectButton: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectLabel: {
    fontSize: typography.base,
    color: colors.text,
    flex: 1,
    paddingRight: spacing.sm,
  },
  datePicker: {
    alignSelf: 'flex-start',
  },
  placeholderRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  placeholderRowTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  placeholderRowTitle: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.medium,
  },
  placeholderRowSub: {
    fontSize: typography.sm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  // Failure cost
  failureCostRow: {
    flexDirection: 'row',
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    overflow: 'hidden',
  },
  currencyBadge: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.inputBorder,
    backgroundColor: colors.surface2,
  },
  currencySymbol: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  failureCostInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    fontSize: typography.base,
    color: colors.text,
  },
  // Voucher dropdown
  selectedFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  avatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmallText: {
    fontSize: typography.xs,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  voucherDropdown: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
    overflow: 'hidden',
  },
  voucherDropdownScroll: {
    maxHeight: 260,
  },
  voucherSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.sm,
    paddingHorizontal: spacing.sm,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    gap: spacing.sm,
  },
  voucherSearchInput: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text,
    paddingVertical: 0,
  },
  voucherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  voucherRowSelected: {
    backgroundColor: colors.surface2,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarSelf: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  avatarText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  voucherRowText: {
    flex: 1,
    gap: 1,
  },
  voucherName: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text,
  },
  voucherSub: {
    fontSize: typography.xs,
    color: colors.textMuted,
  },
  voucherHint: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
