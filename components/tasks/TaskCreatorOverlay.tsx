import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '@/lib/theme';
import { titleHasDeadlineToken } from '@/lib/task-title-parser';
import {
  formatReminderDateChip,
  formatReminderDateTimeLabel,
  formatReminderTimeChip,
} from './helpers';
import {
  type DraftReminder,
  type DraftSubtask,
  type RecurrenceType,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
} from './types';
import { styles } from './styles';

interface CreatorAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TaskCreatorOverlayProps {
  visible: boolean;
  anchor: CreatorAnchor | null;
  expandAnim: Animated.Value;
  screenWidth: number;
  screenHeight: number;
  isCreatingTask: boolean;
  onCancel: () => void;
  onCreate: () => void;
  titleInputRef: RefObject<TextInput | null>;
  title: string;
  onTitleChange: (text: string) => void;
  isTitleFocused: boolean;
  setIsTitleFocused: Dispatch<SetStateAction<boolean>>;
  androidKeyboardHeight: number;
  draftSubtasks: DraftSubtask[];
  onToggleDraftSubtask: (id: string) => void;
  onDeleteDraftSubtask: (id: string) => void;
  isSubtaskFocused: boolean;
  setIsSubtaskFocused: Dispatch<SetStateAction<boolean>>;
  subtaskInputRef: RefObject<TextInput | null>;
  newSubtaskDraft: string;
  setNewSubtaskDraft: Dispatch<SetStateAction<string>>;
  onAddDraftSubtask: () => void;
  deadlineDate: Date;
  datePickerMode: 'date' | 'time';
  setDatePickerMode: Dispatch<SetStateAction<'date' | 'time'>>;
  showAndroidPicker: boolean;
  setShowAndroidPicker: Dispatch<SetStateAction<boolean>>;
  onDatePickerChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  voucherButtonRef: RefObject<View | null>;
  voucherLabel: string;
  voucherValue: string | null;
  onOpenVoucherPicker: () => void;
  currencySymbol: string;
  failureCostInputRef: RefObject<TextInput | null>;
  failureCostInput: string;
  setFailureCostInput: Dispatch<SetStateAction<string>>;
  friendsLoading: boolean;
  failureCostSelection: { start: number; end: number } | undefined;
  setFailureCostSelection: Dispatch<SetStateAction<{ start: number; end: number } | undefined>>;
  draftReminders: DraftReminder[];
  reminderNowMs: number;
  onRemoveReminder: (reminder: DraftReminder) => void;
  showCustomReminderAndroidPicker: boolean;
  customReminderDate: Date;
  customReminderPickerMode: 'date' | 'time';
  onCustomReminderAndroidPickerChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  onOpenAddReminderFlow: () => void;
  showCustomReminderIosModal: boolean;
  setShowCustomReminderIosModal: Dispatch<SetStateAction<boolean>>;
  setCustomReminderDate: Dispatch<SetStateAction<Date>>;
  onAddCustomReminder: (input?: Date) => boolean | void;
  recurrenceType: RecurrenceType;
  showCustomRecurrenceDays: boolean;
  onSelectRecurrenceType: (type: RecurrenceType) => void;
  onToggleCustomRecurrenceDays: () => void;
  recurrenceDays: number[];
  onToggleRecurrenceDay: (day: number) => void;
  isAiVoucherSelected: boolean;
  requiresProof: boolean;
  setRequiresProof: Dispatch<SetStateAction<boolean>>;
  eventSyncEnabled: boolean;
  setEventSyncEnabled: Dispatch<SetStateAction<boolean>>;
}

export function TaskCreatorOverlay({
  visible,
  anchor,
  expandAnim,
  screenWidth,
  screenHeight,
  isCreatingTask,
  onCancel,
  onCreate,
  titleInputRef,
  title,
  onTitleChange,
  isTitleFocused,
  setIsTitleFocused,
  androidKeyboardHeight,
  draftSubtasks,
  onToggleDraftSubtask,
  onDeleteDraftSubtask,
  isSubtaskFocused,
  setIsSubtaskFocused,
  subtaskInputRef,
  newSubtaskDraft,
  setNewSubtaskDraft,
  onAddDraftSubtask,
  deadlineDate,
  datePickerMode,
  setDatePickerMode,
  showAndroidPicker,
  setShowAndroidPicker,
  onDatePickerChange,
  voucherButtonRef,
  voucherLabel,
  voucherValue,
  onOpenVoucherPicker,
  currencySymbol,
  failureCostInputRef,
  failureCostInput,
  setFailureCostInput,
  friendsLoading,
  failureCostSelection,
  setFailureCostSelection,
  draftReminders,
  reminderNowMs,
  onRemoveReminder,
  showCustomReminderAndroidPicker,
  customReminderDate,
  customReminderPickerMode,
  onCustomReminderAndroidPickerChange,
  onOpenAddReminderFlow,
  showCustomReminderIosModal,
  setShowCustomReminderIosModal,
  setCustomReminderDate,
  onAddCustomReminder,
  recurrenceType,
  showCustomRecurrenceDays,
  onSelectRecurrenceType,
  onToggleCustomRecurrenceDays,
  recurrenceDays,
  onToggleRecurrenceDay,
  isAiVoucherSelected,
  requiresProof,
  setRequiresProof,
  eventSyncEnabled,
  setEventSyncEnabled,
}: TaskCreatorOverlayProps) {
  const hasDeadlineToken = useMemo(() => titleHasDeadlineToken(title), [title]);

  if (!visible || !anchor) {
    return null;
  }

  return (
    <>
      <Pressable style={styles.creatorOverlayBackdrop} onPress={onCancel} />
      <Animated.View
        style={[
          styles.creatorFloatingActions,
          {
            top: anchor.y - 78,
            opacity: expandAnim.interpolate({
              inputRange: [0.6, 1],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <View style={styles.creatorButtonStack}>
          <TouchableOpacity
            style={styles.sheetCancelButton}
            onPress={onCancel}
            activeOpacity={0.8}
          >
            <Text style={styles.sheetCancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetCreateButton, isCreatingTask && styles.sheetCreateButtonDisabled]}
            onPress={onCreate}
            disabled={isCreatingTask}
            activeOpacity={0.8}
          >
            {isCreatingTask
              ? <ActivityIndicator size="small" color={colors.primaryFg} />
              : <Text style={styles.sheetCreateButtonText}>Create</Text>
            }
          </TouchableOpacity>
        </View>
      </Animated.View>
      <Animated.View
        style={[
          styles.creatorOverlay,
          {
            top: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [anchor.y, anchor.y],
            }),
            left: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [anchor.x, 0],
            }),
            width: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [anchor.width, screenWidth],
            }),
            height: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [anchor.height, screenHeight - anchor.y],
            }),
            borderTopLeftRadius: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [radius.lg, radius.xl],
            }),
            borderTopRightRadius: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [radius.lg, radius.xl],
            }),
            borderBottomLeftRadius: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [radius.lg, 0],
            }),
            borderBottomRightRadius: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [radius.lg, 0],
            }),
            borderColor: expandAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.border, colors.borderStrong],
            }),
          },
        ]}
      >
        <Pressable
          style={[styles.inlineCreatorBar, isTitleFocused && styles.inlineCreatorBarFocused]}
          onPress={() => titleInputRef.current?.focus()}
        >
          <TextInput
            ref={titleInputRef}
            style={styles.inlineCreatorTitleInput}
            placeholder="Task title"
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={onTitleChange}
            returnKeyType="done"
            onFocus={() => setIsTitleFocused(true)}
            onBlur={() => setIsTitleFocused(false)}
          />
        </Pressable>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.sheetContent,
            androidKeyboardHeight > 0 && { paddingBottom: androidKeyboardHeight + spacing.xxl },
          ]}
        >
          <View style={styles.creatorSubtasksCard}>
            {draftSubtasks.map((subtask) => (
              <View key={subtask.id} style={styles.creatorSubtaskItemRow}>
                <TouchableOpacity
                  onPress={() => onToggleDraftSubtask(subtask.id)}
                  style={[styles.creatorSubtaskCircle, subtask.isCompleted && styles.creatorSubtaskCircleCompleted]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  {subtask.isCompleted && <Feather name="check" size={11} color={colors.success} />}
                </TouchableOpacity>
                <Text
                  style={[styles.creatorSubtaskItemTitle, subtask.isCompleted && styles.creatorSubtaskItemTitleCompleted]}
                  numberOfLines={2}
                >
                  {subtask.title}
                </Text>
                <TouchableOpacity
                  onPress={() => onDeleteDraftSubtask(subtask.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={14} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
            <Pressable
              style={[styles.creatorSubtaskComposerRow, isSubtaskFocused && styles.creatorSubtaskComposerRowFocused]}
              onPress={() => subtaskInputRef.current?.focus()}
            >
              <Feather name="plus" size={16} color={isSubtaskFocused ? colors.accentCyan : colors.textMuted} />
              <TextInput
                ref={subtaskInputRef}
                style={styles.creatorSubtaskInput}
                placeholder="Add subtask..."
                placeholderTextColor={colors.textMuted}
                value={newSubtaskDraft}
                onChangeText={setNewSubtaskDraft}
                returnKeyType="done"
                blurOnSubmit={false}
                onSubmitEditing={onAddDraftSubtask}
                onFocus={() => setIsSubtaskFocused(true)}
                onBlur={() => setIsSubtaskFocused(false)}
              />
              {newSubtaskDraft.trim().length > 0 && (
                <TouchableOpacity
                  onPress={onAddDraftSubtask}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Feather name="check" size={16} color={colors.success} />
                </TouchableOpacity>
              )}
            </Pressable>
          </View>

          <View style={styles.section}>
            <View style={styles.field}>
              <View style={styles.deadlineField}>
                <View style={styles.deadlineLabelWrap}>
                  <Text style={styles.fieldLabel}>Deadline</Text>
                  {hasDeadlineToken && <View style={styles.parsedDot} />}
                </View>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={deadlineDate}
                    mode="datetime"
                    display="compact"
                    minimumDate={new Date()}
                    onChange={onDatePickerChange}
                    themeVariant="dark"
                    accentColor={colors.warning}
                    style={styles.datePicker}
                  />
                ) : (
                  <View style={styles.deadlineChipsWrap}>
                    <TouchableOpacity
                      style={styles.reminderChip}
                      activeOpacity={0.8}
                      onPress={() => {
                        setDatePickerMode('date');
                        setShowAndroidPicker(true);
                      }}
                    >
                      <Feather name="calendar" size={14} color={colors.textMuted} />
                      <Text style={styles.reminderChipText}>{formatReminderDateChip(deadlineDate)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reminderChip}
                      activeOpacity={0.8}
                      onPress={() => {
                        setDatePickerMode('time');
                        setShowAndroidPicker(true);
                      }}
                    >
                      <Feather name="clock" size={14} color={colors.textMuted} />
                      <Text style={styles.reminderChipText}>{formatReminderTimeChip(deadlineDate)}</Text>
                    </TouchableOpacity>
                    {showAndroidPicker && (
                      <DateTimePicker
                        value={deadlineDate}
                        mode={datePickerMode}
                        display="default"
                        minimumDate={new Date()}
                        onChange={onDatePickerChange}
                      />
                    )}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.fieldsRow}>
              <View style={[styles.field, styles.fieldInRow]} ref={voucherButtonRef} collapsable={false}>
                <TouchableOpacity
                  style={styles.inlineLabeledField}
                  onPress={onOpenVoucherPicker}
                  activeOpacity={0.8}
                >
                  <Feather name="users" size={18} color={colors.textMuted} />
                  <View style={styles.inlineFieldValueWrap}>
                    <Text style={[styles.inlineFieldValue, !voucherValue && { color: colors.textSubtle }]}>
                      {voucherLabel}
                    </Text>
                    <Feather name="chevron-down" size={18} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={[styles.field, styles.fieldInRow]}>
                <Pressable style={styles.inlineLabeledField} onPress={() => failureCostInputRef.current?.focus()}>
                  <View style={styles.currencyIconsWrap}>
                    <Text style={styles.currencyIconSymbol}>{currencySymbol}</Text>
                    <Text style={styles.currencyIconSymbol}>{currencySymbol}</Text>
                  </View>
                  <TextInput
                    ref={failureCostInputRef}
                    style={styles.inlineFailureCostInput}
                    value={failureCostInput}
                    onChangeText={(text) => setFailureCostInput(text.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholder={friendsLoading ? '…' : '0'}
                    placeholderTextColor={colors.textSubtle}
                    returnKeyType="done"
                    selection={failureCostSelection}
                    onFocus={() => setFailureCostSelection({ start: failureCostInput.length, end: failureCostInput.length })}
                    onSelectionChange={() => setFailureCostSelection(undefined)}
                  />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.reminderCard}>
              <View style={styles.reminderHeaderRow}>
                <Text style={styles.placeholderRowTitle}>Reminders</Text>
              </View>
              {draftReminders.length === 0 ? (
                <Text style={styles.reminderEmpty}>No reminders set.</Text>
              ) : (
                draftReminders.map((reminder, index) => {
                  const sent = reminder.reminderAt.getTime() <= reminderNowMs;
                  return (
                    <View key={reminder.id} style={styles.reminderRow}>
                      <View style={styles.reminderIndexWrap}>
                        <Text style={styles.reminderIndex}>#{index + 1}</Text>
                      </View>
                      <View style={styles.reminderBody}>
                        <Text style={styles.reminderAt}>{formatReminderDateTimeLabel(reminder.reminderAt)}</Text>
                      </View>
                      <Text style={styles.reminderStatus}>{sent ? 'Sent' : 'Scheduled'}</Text>
                      <TouchableOpacity
                        onPress={() => onRemoveReminder(reminder)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove reminder #${index + 1}`}
                        hitSlop={8}
                      >
                        <Feather name="trash-2" size={16} color={colors.destructive} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
              <View style={styles.reminderComposer}>
                {showCustomReminderAndroidPicker && (
                  <DateTimePicker
                    value={customReminderDate}
                    mode={customReminderPickerMode}
                    display="default"
                    minimumDate={customReminderPickerMode === 'date' ? new Date() : undefined}
                    onChange={onCustomReminderAndroidPickerChange}
                  />
                )}
                <TouchableOpacity
                  style={styles.addReminderButton}
                  activeOpacity={0.85}
                  onPress={onOpenAddReminderFlow}
                  accessibilityRole="button"
                  accessibilityLabel="Add reminder"
                >
                  <Feather name="plus" size={16} color="#FBBF24" />
                  <Text style={styles.addReminderText}>Add reminder</Text>
                </TouchableOpacity>
              </View>
            </View>

            {Platform.OS === 'ios' && (
              <Modal
                visible={showCustomReminderIosModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowCustomReminderIosModal(false)}
              >
                <Pressable
                  style={styles.reminderPickerBackdrop}
                  onPress={() => setShowCustomReminderIosModal(false)}
                />
                <View style={styles.reminderPickerSheet}>
                  <Text style={styles.reminderPickerTitle}>Choose reminder</Text>
                  <DateTimePicker
                    value={customReminderDate}
                    mode="datetime"
                    display="spinner"
                    minimumDate={new Date()}
                    maximumDate={new Date(deadlineDate.getTime() - 60 * 1000)}
                    onChange={(_event, selected) => {
                      if (selected) {
                        setCustomReminderDate(selected);
                      }
                    }}
                    themeVariant="dark"
                    accentColor={colors.warning}
                  />
                  <View style={styles.reminderPickerActions}>
                    <TouchableOpacity
                      style={styles.reminderPickerCancel}
                      activeOpacity={0.8}
                      onPress={() => setShowCustomReminderIosModal(false)}
                    >
                      <Text style={styles.reminderPickerCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reminderPickerConfirm}
                      activeOpacity={0.85}
                      onPress={() => {
                        const didAdd = onAddCustomReminder(customReminderDate);
                        if (didAdd) {
                          setShowCustomReminderIosModal(false);
                        }
                      }}
                    >
                      <Text style={styles.reminderPickerConfirmText}>Add reminder</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            )}

            <View style={styles.recurrenceCard}>
              <View style={styles.recurrenceChipWrap}>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === '' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => onSelectRecurrenceType('')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === '' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>None</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === 'DAILY' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => onSelectRecurrenceType('DAILY')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === 'DAILY' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Daily</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === 'WEEKLY' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => onSelectRecurrenceType('WEEKLY')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === 'WEEKLY' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Weekly</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === 'MONTHLY' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => onSelectRecurrenceType('MONTHLY')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === 'MONTHLY' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Monthly</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={onToggleCustomRecurrenceDays}
                >
                  <Feather name="repeat" size={12} color={showCustomRecurrenceDays ? '#C084FC' : colors.textMuted} />
                  <Text style={[styles.recurrenceChipText, showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Custom</Text>
                </TouchableOpacity>
              </View>
              {showCustomRecurrenceDays && (
                <View style={styles.recurrenceDaysRow}>
                  {WEEKDAY_ORDER.map((day) => {
                    const selected = recurrenceDays.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        style={[styles.recurrenceDayBtn, selected && styles.recurrenceDayBtnActive]}
                        activeOpacity={0.8}
                        onPress={() => onToggleRecurrenceDay(day)}
                      >
                        <Text style={[styles.recurrenceDayText, selected && styles.recurrenceDayTextActive]}>
                          {WEEKDAY_SHORT[day]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.placeholderRow}>
              <View style={styles.placeholderRowTextWrap}>
                <Text style={styles.placeholderRowTitle}>Require proof</Text>
              </View>
              <Switch
                value={isAiVoucherSelected ? true : requiresProof}
                onValueChange={setRequiresProof}
                disabled={isAiVoucherSelected}
                trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                thumbColor={colors.text}
              />
            </View>

            <View style={styles.placeholderRow}>
              <View style={styles.placeholderRowTextWrap}>
                <Text style={styles.placeholderRowTitle}>Is event</Text>
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
      </Animated.View>
    </>
  );
}
