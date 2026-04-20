import { Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { TodayParts } from './types';
import { colors } from '@/lib/theme';
import { styles } from './styles';

interface TaskTopBarProps {
  displayName: string;
  todayParts: TodayParts;
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

function toSuperscriptOrdinal(ordinal: string): string {
  switch (ordinal.toLowerCase()) {
    case 'st':
      return 'ˢᵗ';
    case 'nd':
      return 'ⁿᵈ';
    case 'rd':
      return 'ʳᵈ';
    default:
      return 'ᵗʰ';
  }
}

export function TaskTopBar({
  displayName,
  todayParts,
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
  const superscriptOrdinal = toSuperscriptOrdinal(todayParts.ordinal);

  return (
    <>
      <View style={styles.taskHeader}>
        <Text style={styles.taskGreeting}>Hello, {displayName}</Text>
        <View style={styles.taskDateRow}>
          <Text style={styles.taskDateIts}>It&apos;s</Text>
          <Text style={styles.taskDate}>{todayParts.dayName} {todayParts.day}{superscriptOrdinal}</Text>
          <Text style={styles.taskDate}> {todayParts.monthName}.</Text>
        </View>
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
