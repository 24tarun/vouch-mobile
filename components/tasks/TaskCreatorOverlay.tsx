import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { radius } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import {
  GOOGLE_EVENT_COLOR_OPTIONS,
  type GoogleEventColorId,
  titleHasDeadlineToken,
} from '@/lib/task-title-parser';
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
import { makeStyles } from './styles';

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
  keyboardHeight: number;
  keyboardVisible: boolean;
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
  timeBoundEnabled: boolean;
  setTimeBoundEnabled: Dispatch<SetStateAction<boolean>>;
  eventSyncEnabled: boolean;
  setEventSyncEnabled: Dispatch<SetStateAction<boolean>>;
  eventStartDate: Date | null;
  setEventStartDate: Dispatch<SetStateAction<Date | null>>;
  selectedGoogleEventColorId: GoogleEventColorId;
  setSelectedGoogleEventColorId: Dispatch<SetStateAction<GoogleEventColorId>>;
  suggestedStartDate: Date;
  showEventStartAndroidPicker: boolean;
  setShowEventStartAndroidPicker: Dispatch<SetStateAction<boolean>>;
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
  keyboardHeight,
  keyboardVisible,
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
  timeBoundEnabled,
  setTimeBoundEnabled,
  eventSyncEnabled,
  setEventSyncEnabled,
  eventStartDate,
  setEventStartDate,
  selectedGoogleEventColorId,
  setSelectedGoogleEventColorId,
  suggestedStartDate,
  showEventStartAndroidPicker,
  setShowEventStartAndroidPicker,
}: TaskCreatorOverlayProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const hasDeadlineToken = useMemo(() => titleHasDeadlineToken(title), [title]);
  const footerBottomOffset = keyboardVisible ? keyboardHeight : 0;

  function handleDismissGesture() {
    if (keyboardVisible) {
      Keyboard.dismiss();
      return;
    }
    onCancel();
  }

  if (!visible || !anchor) {
    return null;
  }

  const footerActions = (
    <View style={styles.creatorFooterActions}>
      <TouchableOpacity
        style={styles.creatorFooterCancelButton}
        onPress={onCancel}
        activeOpacity={0.8}
      >
        <BlurView intensity={38} tint="dark" style={styles.creatorFooterButtonBlur} />
        <View style={styles.creatorFooterButtonContent}>
          <Text style={styles.creatorFooterCancelButtonText}>Cancel</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.creatorFooterCreateButton, isCreatingTask && styles.sheetCreateButtonDisabled]}
        onPress={onCreate}
        disabled={isCreatingTask}
        activeOpacity={0.8}
      >
        <BlurView intensity={42} tint="light" style={styles.creatorFooterButtonBlur} />
        <View style={styles.creatorFooterCreateTintOverlay} pointerEvents="none" />
        <View style={styles.creatorFooterButtonContent}>
          {isCreatingTask
            ? <ActivityIndicator size="small" color={colors.primaryFg} />
            : <Text style={styles.creatorFooterCreateButtonText}>Create</Text>
          }
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <Pressable style={styles.creatorOverlayBackdrop} onPress={handleDismissGesture} />
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
        <KeyboardAwareScrollView
          style={styles.creatorBody}
          enableOnAndroid
          extraHeight={70}
          extraScrollHeight={24}
          keyboardOpeningTime={0}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.sheetContent}
        >
          <View style={styles.creatorTopFields}>
            <Pressable
              style={[styles.creatorTitleField, isTitleFocused && styles.creatorTitleFieldFocused]}
              onPress={() => titleInputRef.current?.focus()}
            >
              <TextInput
                ref={titleInputRef}
                style={styles.creatorTitleInput}
                placeholder="Task title"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={onTitleChange}
                returnKeyType="done"
                onFocus={() => setIsTitleFocused(true)}
                onBlur={() => setIsTitleFocused(false)}
              />
            </Pressable>

            <View style={styles.creatorSubtasksCard}>
              {draftSubtasks.map((subtask) => (
                <View key={subtask.id} style={styles.creatorSubtaskItemRow}>
                  <View style={styles.creatorSubtaskLeadingSlot}>
                    <TouchableOpacity
                      onPress={() => onToggleDraftSubtask(subtask.id)}
                      style={[styles.creatorSubtaskCircle, subtask.isCompleted && styles.creatorSubtaskCircleCompleted]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      {subtask.isCompleted && <Feather name="check" size={11} color={colors.success} />}
                    </TouchableOpacity>
                  </View>
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
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              ))}
              <Pressable
                style={[styles.creatorSubtaskComposerRow, isSubtaskFocused && styles.creatorSubtaskComposerRowFocused]}
                onPress={() => subtaskInputRef.current?.focus()}
              >
                <View style={styles.creatorSubtaskLeadingSlot}>
                  <TouchableOpacity
                    onPress={onAddDraftSubtask}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Add subtask"
                  >
                    <Feather name="plus" size={16} color={isSubtaskFocused ? colors.accentCyan : colors.textMuted} />
                  </TouchableOpacity>
                </View>
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
                    onPress={() => setNewSubtaskDraft('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Clear subtask draft"
                  >
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </TouchableOpacity>
                )}
              </Pressable>
            </View>
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
                <TouchableOpacity
                  style={styles.addReminderButton}
                  activeOpacity={0.85}
                  onPress={onOpenAddReminderFlow}
                  accessibilityRole="button"
                  accessibilityLabel="Add reminders"
                >
                  <Text style={styles.addReminderText}>Add reminders</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reminderActionSlot}
                  activeOpacity={0.85}
                  onPress={onOpenAddReminderFlow}
                  accessibilityRole="button"
                  accessibilityLabel="Add reminder"
                  hitSlop={8}
                >
                  <Feather name="plus" size={16} color="#FBBF24" />
                </TouchableOpacity>
              </View>
              {draftReminders.length === 0 ? (
                <Text style={styles.reminderEmpty}>No reminders set.</Text>
              ) : (
                <View style={styles.reminderRows}>
                  {draftReminders.map((reminder, index) => (
                    <View key={reminder.id} style={styles.reminderRow}>
                      <View style={styles.reminderBody}>
                        <Text style={styles.reminderAt}>{formatReminderDateTimeLabel(reminder.reminderAt)}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.reminderActionSlot}
                        onPress={() => onRemoveReminder(reminder)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove reminder #${index + 1}`}
                        hitSlop={8}
                      >
                        <Feather name="trash-2" size={16} color={colors.destructive} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              {showCustomReminderAndroidPicker ? (
                <DateTimePicker
                  value={customReminderDate}
                  mode={customReminderPickerMode}
                  display="default"
                  minimumDate={customReminderPickerMode === 'date' ? new Date() : undefined}
                  onChange={onCustomReminderAndroidPickerChange}
                />
              ) : null}
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
                <Text style={styles.placeholderRowTitle}>Time bound</Text>
              </View>
              <Switch
                value={timeBoundEnabled}
                onValueChange={(v) => {
                  setTimeBoundEnabled(v);
                  if (!v && !eventSyncEnabled) {
                    setEventStartDate(null);
                  }
                }}
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
                onValueChange={(v) => {
                  setEventSyncEnabled(v);
                  if (!v && !timeBoundEnabled) {
                    setEventStartDate(null);
                  }
                }}
                trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                thumbColor={colors.text}
              />
            </View>

            {(timeBoundEnabled || eventSyncEnabled) ? (() => {
              const pickerDate = eventStartDate ?? suggestedStartDate;
              const hasManualStartDate = Boolean(eventStartDate);

              return (
                <View style={styles.placeholderRow}>
                  <View style={styles.placeholderRowTextWrap}>
                    <Text style={styles.placeholderRowTitle}>Start time</Text>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>
                      Optional — defaults to deadline − duration
                    </Text>
                  </View>
                  {Platform.OS === 'ios' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <DateTimePicker
                        value={pickerDate}
                        mode="datetime"
                        display="compact"
                        onChange={(_e, d) => { if (d) setEventStartDate(d); }}
                        themeVariant="dark"
                        accentColor={colors.accentCyan}
                        style={{ width: 160 }}
                      />
                      {hasManualStartDate ? (
                        <TouchableOpacity
                          onPress={() => setEventStartDate(null)}
                          activeOpacity={0.75}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface2 }}
                        >
                          <Text style={{ fontSize: 12, color: colors.accentCyan }}>
                            Default
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity
                        style={styles.reminderChip}
                        activeOpacity={0.8}
                        onPress={() => setShowEventStartAndroidPicker(true)}
                      >
                        <Feather name="clock" size={14} color={colors.textMuted} />
                        <Text style={styles.reminderChipText}>{formatReminderTimeChip(pickerDate)}</Text>
                      </TouchableOpacity>
                      {hasManualStartDate ? (
                        <TouchableOpacity
                          onPress={() => setEventStartDate(null)}
                          activeOpacity={0.75}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface2 }}
                        >
                          <Text style={{ fontSize: 12, color: colors.accentCyan }}>
                            Default
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {showEventStartAndroidPicker ? (
                        <DateTimePicker
                          value={pickerDate}
                          mode="datetime"
                          display="default"
                          onChange={(_e, d) => {
                            setShowEventStartAndroidPicker(false);
                            if (d) setEventStartDate(d);
                          }}
                        />
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })() : null}

            {eventSyncEnabled ? (
              <View style={styles.eventColorCard}>
                <View style={styles.placeholderRowTextWrap}>
                  <Text style={styles.placeholderRowTitle}>Event color</Text>
                  <Text style={styles.eventColorSubtitle}>
                    Pick the Google Calendar color for this event.
                  </Text>
                </View>
                <View style={styles.eventColorOptionsWrap}>
                  {GOOGLE_EVENT_COLOR_OPTIONS.map((option) => {
                    const isSelected = selectedGoogleEventColorId === option.colorId;
                    return (
                      <TouchableOpacity
                        key={option.colorId}
                        style={[
                          styles.eventColorDotButton,
                          isSelected && styles.eventColorDotButtonSelected,
                        ]}
                        activeOpacity={0.85}
                        onPress={() => setSelectedGoogleEventColorId(option.colorId)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${option.nativeToken.replace('-', '')} event color`}
                      >
                        <View
                          style={[
                            styles.eventColorDotSwatch,
                            { backgroundColor: option.swatchHex },
                          ]}
                        >
                          {isSelected ? (
                            <Feather name="check" size={12} color="#FFFFFF" />
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
          {!keyboardVisible ? (
            <View style={styles.creatorFooterInline}>
              {footerActions}
            </View>
          ) : null}
        </KeyboardAwareScrollView>

        {keyboardVisible ? (
          <View style={[styles.creatorFooter, { bottom: footerBottomOffset }]}>
            {footerActions}
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}
