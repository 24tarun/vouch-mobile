import { Alert, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMemo } from 'react';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';

import { Feather } from '@expo/vector-icons';
import type { FriendOption } from '@/lib/hooks/useFriends';
import type { AiVoucherQuota } from '@/lib/types';
import { formatAiVoucherQuotaExhaustedMessage } from '@/lib/ai-voucher-quota';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';

interface Anchor {
  pageX: number;
  pageY: number;
  width: number;
  buttonHeight: number;
}

interface VoucherPickerModalProps {
  visible: boolean;
  anchor: Anchor | null;
  safeTopInset: number;
  voucherDropdownHeight: number;
  setVoucherDropdownHeight: (height: number) => void;
  voucherSearch: string;
  setVoucherSearch: (value: string) => void;
  voucherValue: string | null;
  setVoucherValue: (value: string | null) => void;
  closeVoucherPicker: () => void;
  friendsLoading: boolean;
  friendsError: string | null;
  filteredFriends: FriendOption[];
  aiQuota: AiVoucherQuota | null;
  aiQuotaLoading: boolean;
  aiQuotaError: string | null;
}

export function VoucherPickerModal({
  visible,
  anchor,
  safeTopInset,
  voucherDropdownHeight,
  setVoucherDropdownHeight,
  voucherSearch,
  setVoucherSearch,
  voucherValue,
  setVoucherValue,
  closeVoucherPicker,
  friendsLoading,
  friendsError,
  filteredFriends,
  aiQuota,
  aiQuotaLoading,
  aiQuotaError,
}: VoucherPickerModalProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return (
    <Modal
      visible={visible && anchor != null}
      transparent
      animationType="none"
      onRequestClose={closeVoucherPicker}
      statusBarTranslucent
    >
      {anchor && (
        <>
          <Pressable style={styles.voucherBackdrop} onPress={closeVoucherPicker} />
          {(() => {
            const spacing = 6;
            const minTop = Math.max(8, safeTopInset + 4);
            const aboveTop = anchor.pageY - voucherDropdownHeight - spacing;
            const belowTop = anchor.pageY + anchor.buttonHeight + spacing;
            const top = aboveTop >= minTop ? aboveTop : belowTop;

            return (
          <View
            onLayout={(e) => setVoucherDropdownHeight(e.nativeEvent.layout.height)}
            style={[
              styles.voucherDropdown,
              {
                left: anchor.pageX,
                width: anchor.width,
                top,
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
                  onPress={() => {
                    setVoucherValue('self');
                    closeVoucherPicker();
                  }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.avatar, styles.avatarSelf]}>
                    <Feather name="user" size={14} color={colors.textMuted} />
                  </View>
                  <Text style={styles.voucherName}>Myself</Text>
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
                filteredFriends.map((friend) => {
                  const isAi = friend.id === AI_PROFILE_ID;
                  const isAiDisabled = isAi && (
                    aiQuotaLoading
                    || Boolean(aiQuotaError)
                    || !aiQuota
                    || (aiQuota.accountTier === 'free' && !aiQuota.canStartReview)
                  );
                  const aiQuotaLabel = !isAi
                    ? null
                    : aiQuotaLoading
                      ? '…/5'
                      : aiQuotaError || !aiQuota
                        ? 'Unavailable'
                        : aiQuota.accountTier === 'paid'
                          ? '∞'
                          : `${aiQuota.used}/${aiQuota.limit ?? 5}${aiQuota.pending > 0 ? ` · ${aiQuota.pending} pending` : ''}`;
                  return (
                  <TouchableOpacity
                    key={friend.id}
                    style={[styles.voucherRow, voucherValue === friend.id && styles.voucherRowSelected, isAiDisabled && { opacity: 0.4 }]}
                    onPress={() => {
                      if (isAiDisabled) {
                        if (aiQuotaLoading) {
                          Alert.alert('Checking AI credits', 'Your AI voucher balance is still loading. Please try again in a moment.');
                        } else if (aiQuotaError || !aiQuota) {
                          Alert.alert('AI credits unavailable', 'Could not load your AI voucher balance. Please close the picker and try again.');
                        } else {
                          Alert.alert('AI credits used', formatAiVoucherQuotaExhaustedMessage(aiQuota));
                        }
                        return;
                      }
                      setVoucherValue(friend.id);
                      closeVoucherPicker();
                    }}
                    activeOpacity={isAiDisabled ? 1 : 0.75}
                    accessibilityState={{ selected: voucherValue === friend.id }}
                    accessibilityLabel={isAi && aiQuotaLabel ? `${friend.username}, ${aiQuotaLabel}` : friend.username}
                    accessibilityHint={isAiDisabled ? 'Shows why AI voucher is unavailable' : 'Selects this voucher'}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{friend.initial}</Text>
                    </View>
                    <Text style={styles.voucherName}>{friend.username}</Text>
                    {aiQuotaLabel ? <Text style={styles.voucherQuota}>{aiQuotaLabel}</Text> : null}
                    {voucherValue === friend.id && (
                      <Feather name="check" size={16} color={colors.text} />
                    )}
                  </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
            );
          })()}
        </>
      )}
    </Modal>
  );
}
