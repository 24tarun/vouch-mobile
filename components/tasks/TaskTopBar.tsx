import { Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { TodayParts } from './types';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

type TasksSegment = 'active' | 'future' | 'past';

interface TaskTopBarProps {
  displayName: string;
  todayParts: TodayParts;
  selectedSegment: TasksSegment;
  onChangeSegment: (segment: TasksSegment) => void;
  activeCount: number;
  futureCount: number;
  creatorAnchorRef: React.RefObject<View | null>;
  sortButtonRef: React.RefObject<View | null>;
  searchInputRef: React.RefObject<TextInput | null>;
  isSearchOpen: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  setIsSearchOpen: (value: boolean) => void;
  expandCreator: () => void;
  openSortMenu: () => void;
}

function OrdinalSuffix({ ordinal }: { ordinal: string }): React.ReactElement {
  return (
    <Text style={{ fontSize: 10, lineHeight: 12, marginBottom: 4, transform: [{ translateY: -2 }] }}>
      {ordinal.toLowerCase()}
    </Text>
  );
}

export function TaskTopBar({
  displayName,
  todayParts,
  selectedSegment,
  onChangeSegment,
  activeCount,
  futureCount,
  creatorAnchorRef,
  sortButtonRef,
  searchInputRef,
  isSearchOpen,
  searchQuery,
  setSearchQuery,
  setIsSearchOpen,
  expandCreator,
  openSortMenu,
}: TaskTopBarProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <>
      <View style={styles.taskHeader}>
        <Text style={styles.taskGreeting}>Hello, {displayName}</Text>
        <View style={styles.taskDateRow}>
          <Text style={styles.taskDateIts}>It&apos;s</Text>
          <Text style={styles.taskDate}>{todayParts.dayName} {todayParts.day}<OrdinalSuffix ordinal={todayParts.ordinal} /></Text>
          <Text style={styles.taskDate}> {todayParts.monthName}.</Text>
        </View>
      </View>

      <View style={styles.taskSegmenterInlineWrap}>
        <SegmentedControl
          items={[
            { key: 'active', label: 'Active', badgeCount: activeCount, color: '#22C55E' },
            { key: 'future', label: 'Future', badgeCount: futureCount, color: '#F97316' },
            { key: 'past', label: 'Past', showBadge: false, color: '#EF4444' },
          ]}
          activeKey={selectedSegment}
          onChange={(key) => onChangeSegment(key as TasksSegment)}
          variant="traffic"
          trafficOrientation="horizontal"
          trafficStandalone
        />
      </View>

      <View ref={creatorAnchorRef} collapsable={false} style={styles.inlineCreatorWrap}>
        <Pressable
          style={styles.inlineCreatorBar}
          onPress={expandCreator}
          android_ripple={{ color: colors.inputBg, radius: 0 }}
        >
          {isSearchOpen ? (
            <View style={styles.inlineCreatorSearchArea}>
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
            </View>
          ) : (
            <View style={styles.inlineCreatorMain} pointerEvents="none">
              <Text style={styles.inlineCreatorPlaceholder}>Add, sort, search tasks</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.sortTriggerButton}
            onPress={expandCreator}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add a new task"
          >
            <Feather name="plus" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <View ref={sortButtonRef} collapsable={false}>
            <TouchableOpacity
              style={styles.sortTriggerButton}
              onPress={openSortMenu}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sort tasks"
            >
              <Ionicons name="swap-vertical-outline" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.searchIconButton}
            onPress={isSearchOpen
              ? () => {
                setSearchQuery('');
                setIsSearchOpen(false);
              }
              : () => setIsSearchOpen(true)
            }
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={isSearchOpen ? 'Close search' : 'Open task search'}
          >
            <Feather name={isSearchOpen ? 'x' : 'search'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </Pressable>
      </View>
    </>
  );
}
