import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { FriendOption } from '@/lib/hooks/useFriends';
import type { AiVoucherQuota } from '@/lib/types';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';

export type VoucherPillIcon = 'cpu' | 'user' | 'user-check';

export interface VoucherPillOption {
  value: string;
  label: string;
  icon: VoucherPillIcon;
  quotaLabel?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}

interface AiVoucherPillState {
  quotaLabel: string;
  accessibilityLabel: string;
  disabled: boolean;
}

interface BuildVoucherPillOptionsInput {
  defaultVoucherValue: string | null;
  friends: FriendOption[];
  aiState: AiVoucherPillState;
}

interface VoucherPillSelectorProps {
  options: VoucherPillOption[];
  selectedValue: string | null;
  loading: boolean;
  onSelect: (value: string) => void;
}

export function getAiVoucherPillState(
  quota: AiVoucherQuota | null,
  loading: boolean,
  error: string | null,
): AiVoucherPillState {
  if (loading) {
    return {
      quotaLabel: '…/5',
      accessibilityLabel: 'AI, checking credits',
      disabled: true,
    };
  }

  if (error || !quota) {
    return {
      quotaLabel: 'Unavailable',
      accessibilityLabel: 'AI, credits unavailable',
      disabled: true,
    };
  }

  if (quota.accountTier === 'paid') {
    return {
      quotaLabel: '∞',
      accessibilityLabel: `AI, unlimited${quota.pending > 0 ? `, ${quota.pending} pending` : ''}`,
      disabled: false,
    };
  }

  const quotaLabel = `${quota.used}/${quota.limit ?? 5}`;
  return {
    quotaLabel,
    accessibilityLabel: `AI, ${quotaLabel}${quota.pending > 0 ? `, ${quota.pending} pending` : ''}`,
    disabled: !quota.canStartReview,
  };
}

export function buildVoucherPillOptions({
  defaultVoucherValue,
  friends,
  aiState,
}: BuildVoucherPillOptionsInput): VoucherPillOption[] {
  const friendById = new Map(friends.map((friend) => [friend.id, friend]));
  const aiFriend = friendById.get(AI_PROFILE_ID);
  const resolvedDefault = defaultVoucherValue === 'self' || friendById.has(defaultVoucherValue ?? '')
    ? defaultVoucherValue
    : 'self';
  const options: VoucherPillOption[] = [];
  const added = new Set<string>();

  const addSelf = () => {
    if (added.has('self')) return;
    options.push({ value: 'self', label: 'Myself', icon: 'user-check' });
    added.add('self');
  };

  const addFriend = (friend: FriendOption) => {
    if (added.has(friend.id)) return;
    const isAi = friend.id === AI_PROFILE_ID;
    options.push({
      value: friend.id,
      label: friend.username,
      icon: isAi ? 'cpu' : 'user',
      quotaLabel: isAi ? aiState.quotaLabel : undefined,
      disabled: isAi ? aiState.disabled : false,
      accessibilityLabel: isAi ? aiState.accessibilityLabel : friend.username,
    });
    added.add(friend.id);
  };

  if (resolvedDefault === 'self') {
    addSelf();
  } else {
    const defaultFriend = resolvedDefault ? friendById.get(resolvedDefault) : null;
    if (defaultFriend) addFriend(defaultFriend);
    else addSelf();
  }

  if (aiFriend) addFriend(aiFriend);
  addSelf();

  friends
    .filter((friend) => friend.id !== AI_PROFILE_ID)
    .sort((a, b) => a.username.localeCompare(b.username))
    .forEach(addFriend);

  return options;
}

export function useVoucherSelection(visible: boolean, defaultVoucherValue: string | null) {
  const [voucherValue, setVoucherValue] = useState<string | null>(null);
  const initializedForCurrentOpen = useRef(false);

  useEffect(() => {
    if (!visible) {
      initializedForCurrentOpen.current = false;
      setVoucherValue(null);
      return;
    }
    if (initializedForCurrentOpen.current || defaultVoucherValue === null) return;

    setVoucherValue(defaultVoucherValue);
    initializedForCurrentOpen.current = true;
  }, [defaultVoucherValue, visible]);

  return [voucherValue, setVoucherValue] as const;
}

export const VoucherPillSelector = memo(function VoucherPillSelector({
  options,
  selectedValue,
  loading,
  onSelect,
}: VoucherPillSelectorProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (selectedValue === null || selectedValue !== options[0]?.value) return;
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [options, selectedValue]);

  if (loading) {
    return (
      <View style={styles.voucherPillLoading} accessibilityLabel="Loading vouchers">
        <ActivityIndicator size="small" color={colors.textMuted} />
        <Text style={styles.voucherPillLoadingText}>Loading vouchers…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      testID="voucher-pill-scroll"
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.voucherPillContent}
      onContentSizeChange={() => {
        if (selectedValue === options[0]?.value) {
          scrollRef.current?.scrollTo({ x: 0, animated: false });
        }
      }}
    >
      {options.map((option) => {
        const selected = selectedValue === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.voucherPill,
              selected && styles.voucherPillSelected,
              option.disabled && styles.voucherPillDisabled,
            ]}
            onPress={() => onSelect(option.value)}
            activeOpacity={option.disabled ? 1 : 0.75}
            hitSlop={{ top: 5, bottom: 5 }}
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityHint={option.disabled ? 'Shows why this voucher is unavailable' : 'Selects this voucher'}
            accessibilityState={{ selected }}
          >
            <Feather
              name={option.icon}
              size={15}
              color={selected ? colors.accentCyan : colors.textMuted}
            />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.voucherPillText, selected && styles.voucherPillTextSelected]}
            >
              {option.label}
              {option.quotaLabel ? ` · ${option.quotaLabel}` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
});
