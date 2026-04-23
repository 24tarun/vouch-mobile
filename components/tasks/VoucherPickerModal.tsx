import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { FriendOption } from '@/lib/hooks/useFriends';
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
}

export function VoucherPickerModal({
  visible,
  anchor,
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
}: VoucherPickerModalProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
          <View
            onLayout={(e) => setVoucherDropdownHeight(e.nativeEvent.layout.height)}
            style={[
              styles.voucherDropdown,
              {
                left: anchor.pageX,
                width: anchor.width,
                top: Math.max(8, anchor.pageY - voucherDropdownHeight - 6),
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
                    onPress={() => {
                      setVoucherValue(friend.id);
                      closeVoucherPicker();
                    }}
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
    </Modal>
  );
}
