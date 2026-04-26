import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, interpolate, interpolateColor, type SharedValue } from 'react-native-reanimated';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Feather } from '@expo/vector-icons';
import { radius } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import {
  GOOGLE_EVENT_COLOR_OPTIONS,
  type GoogleEventColorId,
} from '@/lib/task-title-parser';
import {
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
  expandProgress: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
  targetTop?: number;
  targetHeight?: number;
  isCreatingTask: boolean;
  onCancel: () => void;
  onCreate: () => void;
  titleInputRef: RefObject<TextInput | null>;
  title: string;
  onTitleChange: (text: string) => void;
  isTitleFocused: boolean;
  setIsTitleFocused: Dispatch<SetStateAction<boolean>>;
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
  customDeadlineDate: Date;
  customDeadlinePickerMode: 'date' | 'time';
  showCustomDeadlineAndroidPicker: boolean;
  onCustomDeadlineAndroidPickerChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  onOpenDeadlinePickerFlow: () => void;
  showCustomDeadlineIosModal: boolean;
  setShowCustomDeadlineIosModal: Dispatch<SetStateAction<boolean>>;
  setCustomDeadlineDate: Dispatch<SetStateAction<Date>>;
  onConfirmCustomDeadline: (input?: Date) => boolean | void;
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
  onClearRecurrence: () => void;
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
  expandProgress,
  screenWidth,
  screenHeight,
  targetTop,
  targetHeight,
  isCreatingTask,
  onCancel,
  onCreate,
  titleInputRef,
  title,
  onTitleChange,
  isTitleFocused,
  setIsTitleFocused,
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
  customDeadlineDate,
  customDeadlinePickerMode,
  showCustomDeadlineAndroidPicker,
  onCustomDeadlineAndroidPickerChange,
  onOpenDeadlinePickerFlow,
  showCustomDeadlineIosModal,
  setShowCustomDeadlineIosModal,
  setCustomDeadlineDate,
  onConfirmCustomDeadline,
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
  onClearRecurrence,
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
  const trafficIconColor = colors.bg;
  const [startTimePlacement, setStartTimePlacement] = useState<'timeBound' | 'event'>('timeBound');
  const [expandedControl, setExpandedControl] = useState<'timeBound' | 'eventSync' | null>(null);
  const [isCostEditing, setIsCostEditing] = useState(false);
  const isRepeatEnabled = recurrenceType !== '' || showCustomRecurrenceDays;
  const isProofEnabled = isAiVoucherSelected ? true : requiresProof;
  const sanitizedSuggestedStartDate = useMemo(() => {
    const ts = suggestedStartDate?.getTime?.() ?? NaN;
    if (!Number.isFinite(ts) || ts <= 0) {
      const fallback = new Date();
      fallback.setSeconds(0, 0);
      return fallback;
    }
    return suggestedStartDate;
  }, [suggestedStartDate]);

  // Computed before early return so hooks are always called unconditionally
  const resolvedTargetTop = targetTop ?? (anchor?.y ?? 0);
  const resolvedTargetHeight = targetHeight ?? (screenHeight - resolvedTargetTop);

  const animatedOverlayStyle = useAnimatedStyle(() => ({
    top: interpolate(expandProgress.value, [0, 1], [anchor?.y ?? 0, resolvedTargetTop]),
    left: interpolate(expandProgress.value, [0, 1], [anchor?.x ?? 0, 0]),
    width: interpolate(expandProgress.value, [0, 1], [anchor?.width ?? screenWidth, screenWidth]),
    height: interpolate(expandProgress.value, [0, 1], [anchor?.height ?? 0, resolvedTargetHeight]),
    borderTopLeftRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, radius.xl]),
    borderTopRightRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, radius.xl]),
    borderBottomLeftRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, 0]),
    borderBottomRightRadius: interpolate(expandProgress.value, [0, 1], [radius.lg, 0]),
    borderColor: interpolateColor(expandProgress.value, [0, 1], [colors.border, colors.borderStrong]),
  }));

  useEffect(() => {
    if (timeBoundEnabled && !eventSyncEnabled) {
      setStartTimePlacement('timeBound');
      return;
    }
    if (eventSyncEnabled && !timeBoundEnabled) {
      setStartTimePlacement('event');
      return;
    }
    if (!timeBoundEnabled && !eventSyncEnabled) {
      setStartTimePlacement('timeBound');
    }
  }, [timeBoundEnabled, eventSyncEnabled]);

  useEffect(() => {
    if (!visible) {
      setExpandedControl(null);
      setIsCostEditing(false);
    }
  }, [visible]);

  useEffect(() => {
    if (expandedControl === 'timeBound' && !timeBoundEnabled) {
      setExpandedControl(null);
      return;
    }
    if (expandedControl === 'eventSync' && !eventSyncEnabled) {
      setExpandedControl(null);
    }
  }, [expandedControl, isRepeatEnabled, timeBoundEnabled, eventSyncEnabled]);

  function handleDismissGesture() {
    Keyboard.dismiss();
    onCancel();
  }

  function prepareIconInteraction() {
    if (keyboardVisible) {
      Keyboard.dismiss();
    }
  }

  function handleProofIconPress() {
    prepareIconInteraction();
    if (isAiVoucherSelected) return;
    setRequiresProof((prev) => !prev);
  }

  function handleTimeBoundIconPress() {
    prepareIconInteraction();
    if (!timeBoundEnabled) {
      setStartTimePlacement('timeBound');
      setTimeBoundEnabled(true);
      setExpandedControl('timeBound');
      return;
    }
    if (expandedControl === 'timeBound') {
      setTimeBoundEnabled(false);
      if (!eventSyncEnabled) {
        setEventStartDate(null);
      }
      setExpandedControl(null);
      return;
    }
    setStartTimePlacement('timeBound');
    setExpandedControl('timeBound');
  }

  function handleEventSyncIconPress() {
    prepareIconInteraction();
    if (!eventSyncEnabled) {
      setStartTimePlacement('event');
      setEventSyncEnabled(true);
      setExpandedControl('eventSync');
      return;
    }
    if (expandedControl === 'eventSync') {
      setEventSyncEnabled(false);
      if (!timeBoundEnabled) {
        setEventStartDate(null);
      }
      setExpandedControl(null);
      return;
    }
    setStartTimePlacement('event');
    setExpandedControl('eventSync');
  }

  if (!visible || !anchor) {
    return null;
  }

  const startTimeExpandedContent = (() => {
    const hasValidManualStartDate = Boolean(eventStartDate && Number.isFinite(eventStartDate.getTime()) && eventStartDate.getTime() > 0);
    const pickerDate = hasValidManualStartDate ? eventStartDate! : sanitizedSuggestedStartDate;

    return (
      <View style={styles.optionsPanelRow}>
        <View style={styles.optionsPanelTextWrap}>
          <Text style={styles.optionsPanelLabel}>Start time</Text>
        </View>
        {Platform.OS === 'ios' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <DateTimePicker
              value={pickerDate}
              mode="datetime"
              display="compact"
              minimumDate={new Date()}
              onChange={(_e, d) => { if (d) setEventStartDate(d); }}
              themeVariant="dark"
              accentColor={colors.accentCyan}
              style={{ width: 160 }}
            />
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
            {showEventStartAndroidPicker ? (
              <DateTimePicker
                value={pickerDate}
                mode="datetime"
                display="default"
                minimumDate={new Date()}
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
  })();

  return (
    <>
      <Pressable style={styles.creatorOverlayBackdrop} onPress={handleDismissGesture} />
      <Animated.View style={[styles.creatorOverlay, animatedOverlayStyle]}>
        <KeyboardAwareScrollView
          style={styles.creatorBody}
          enableOnAndroid
          extraHeight={120}
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
                onSubmitEditing={onCreate}
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
                  onSubmitEditing={() => newSubtaskDraft.trim().length === 0 ? onCreate() : onAddDraftSubtask()}
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
              <View style={styles.deadlineInlineRow}>
                <TouchableOpacity
                  style={styles.deadlinePickerTrigger}
                  activeOpacity={0.85}
                  onPress={onOpenDeadlinePickerFlow}
                  accessibilityRole="button"
                  accessibilityLabel="Change deadline"
                >
                  <Feather name="calendar" size={20} color="#FBBF24" />
                  <Text style={styles.deadlinePickerTriggerText}>{formatReminderDateTimeLabel(deadlineDate)}</Text>
                  <Feather
                    name="repeat"
                    size={isRepeatEnabled ? 19 : 17}
                    color={isRepeatEnabled ? '#C084FC' : colors.textMuted}
                    style={[styles.deadlinePickerAuxIcon, isRepeatEnabled && styles.deadlinePickerAuxIconActive]}
                  />
                </TouchableOpacity>
                <View style={styles.deadlineInlineDivider} />
                <View ref={voucherButtonRef} collapsable={false} style={styles.deadlineVoucherAnchor}>
                  <TouchableOpacity
                    style={styles.deadlineVoucherButton}
                    onPress={onOpenVoucherPicker}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Select voucher"
                  >
                    <Feather name="users" size={16} color={colors.textMuted} />
                    <Text style={[styles.deadlineVoucherText, !voucherValue && { color: colors.textSubtle }]}>
                      {voucherLabel}
                    </Text>
                    <Feather name="chevron-down" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                {showCustomDeadlineAndroidPicker ? (
                  <DateTimePicker
                    value={customDeadlineDate}
                    mode={customDeadlinePickerMode}
                    display="default"
                    minimumDate={customDeadlinePickerMode === 'date' ? new Date() : undefined}
                    onChange={onCustomDeadlineAndroidPickerChange}
                  />
                ) : null}
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
            {Platform.OS === 'ios' && (
              <Modal
                visible={showCustomDeadlineIosModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowCustomDeadlineIosModal(false)}
              >
                <Pressable
                  style={styles.reminderPickerBackdrop}
                  onPress={() => setShowCustomDeadlineIosModal(false)}
                />
                <View style={styles.reminderPickerSheet}>
                  <Text style={styles.reminderPickerTitle}>Choose deadline and repetitions</Text>
                  <DateTimePicker
                    value={customDeadlineDate}
                    mode="datetime"
                    display="spinner"
                    minimumDate={new Date()}
                    onChange={(_event, selected) => {
                      if (selected) {
                        setCustomDeadlineDate(selected);
                      }
                    }}
                    themeVariant="dark"
                    accentColor={colors.warning}
                  />
                  <View style={styles.deadlineRecurrenceRows}>
                    {(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const).map((option) => {
                      const isSelected = option === 'CUSTOM'
                        ? showCustomRecurrenceDays
                        : recurrenceType === option && !showCustomRecurrenceDays;

                      return (
                        <TouchableOpacity
                          key={option}
                          style={[styles.deadlineRecurrenceRow, isSelected && styles.deadlineRecurrenceRowActive]}
                          activeOpacity={0.8}
                          onPress={() => {
                            if (option === 'CUSTOM') {
                              if (showCustomRecurrenceDays) {
                                onClearRecurrence();
                                return;
                              }
                              onToggleCustomRecurrenceDays();
                              return;
                            }
                            if (isSelected) {
                              onClearRecurrence();
                              return;
                            }
                            onSelectRecurrenceType(option);
                          }}
                        >
                          <Text style={[styles.deadlineRecurrenceRowText, isSelected && styles.deadlineRecurrenceRowTextActive]}>
                            {option === 'CUSTOM' ? 'Custom' : option.charAt(0) + option.slice(1).toLowerCase()}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {showCustomRecurrenceDays ? (
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
                  ) : null}
                  <View style={styles.reminderPickerActions}>
                    <TouchableOpacity
                      style={styles.reminderPickerCancel}
                      activeOpacity={0.8}
                      onPress={() => setShowCustomDeadlineIosModal(false)}
                    >
                      <Text style={styles.reminderPickerCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reminderPickerConfirm}
                      activeOpacity={0.85}
                      onPress={() => {
                        const didSet = onConfirmCustomDeadline(customDeadlineDate);
                        if (didSet) {
                          setShowCustomDeadlineIosModal(false);
                        }
                      }}
                    >
                      <Text style={styles.reminderPickerConfirmText}>Set deadline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            )}

            <View style={styles.optionRail}>
              <TouchableOpacity
                style={[styles.creatorTrafficFooterBtn, styles.creatorTrafficFooterBtnRed]}
                onPress={onCancel}
                disabled={isCreatingTask}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Cancel task creation"
              >
                <Feather name="x" size={20} color={trafficIconColor} />
              </TouchableOpacity>

              <Pressable
                style={styles.optionCostButton}
                onPress={() => {
                  setIsCostEditing(true);
                  setTimeout(() => failureCostInputRef.current?.focus(), 0);
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit failure cost"
              >
                <View style={styles.optionCostInline}>
                  <Text style={styles.optionCostCurrency}>{currencySymbol}</Text>
                  {isCostEditing ? (
                    <TextInput
                      ref={failureCostInputRef}
                      style={styles.optionCostInput}
                      value={failureCostInput}
                      onChangeText={(text) => setFailureCostInput(text.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder={friendsLoading ? '…' : '0'}
                      placeholderTextColor={colors.bg}
                      returnKeyType="done"
                      selection={failureCostSelection}
                      onFocus={() => setFailureCostSelection({ start: failureCostInput.length, end: failureCostInput.length })}
                      onSelectionChange={() => setFailureCostSelection(undefined)}
                      onBlur={() => setIsCostEditing(false)}
                      onSubmitEditing={() => setIsCostEditing(false)}
                    />
                  ) : (
                    <Text style={styles.optionCostValueText}>
                      {failureCostInput.trim().length > 0 ? failureCostInput : '0'}
                    </Text>
                  )}
                </View>
              </Pressable>

              <TouchableOpacity
                style={[
                  styles.optionIconButton,
                  isProofEnabled && styles.optionIconButtonProofActive,
                  isAiVoucherSelected && styles.optionIconButtonDisabled,
                ]}
                activeOpacity={0.8}
                onPress={handleProofIconPress}
                disabled={isAiVoucherSelected}
                accessibilityRole="button"
                accessibilityLabel={isProofEnabled ? 'Disable proof requirement' : 'Enable proof requirement'}
              >
                <Feather name="camera" size={18} color={isProofEnabled ? colors.bg : colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionIconButton,
                  timeBoundEnabled && styles.optionIconButtonActive,
                  expandedControl === 'timeBound' && styles.optionIconButtonPanelSelected,
                ]}
                activeOpacity={0.8}
                onPress={handleTimeBoundIconPress}
                accessibilityRole="button"
                accessibilityLabel={timeBoundEnabled ? 'Edit time bound options' : 'Enable time bound options'}
              >
                <Feather name="clock" size={18} color={timeBoundEnabled ? colors.bg : colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionIconButton,
                  eventSyncEnabled && styles.optionIconButtonActive,
                  expandedControl === 'eventSync' && styles.optionIconButtonPanelSelected,
                ]}
                activeOpacity={0.8}
                onPress={handleEventSyncIconPress}
                accessibilityRole="button"
                accessibilityLabel={eventSyncEnabled ? 'Edit event options' : 'Enable event options'}
              >
                <Feather name="calendar" size={18} color={eventSyncEnabled ? colors.bg : colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.creatorTrafficFooterBtn, styles.creatorTrafficFooterBtnGreen, isCreatingTask && styles.sheetCreateButtonDisabled]}
                onPress={onCreate}
                disabled={isCreatingTask}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Create task"
              >
                {isCreatingTask
                  ? <ActivityIndicator size="small" color={trafficIconColor} />
                  : <Feather name="check" size={20} color={trafficIconColor} />
                }
              </TouchableOpacity>
            </View>

            {expandedControl ? (
              <View style={styles.optionsPanel}>
                <View style={styles.optionsPanelHeader}>
                  <Text style={styles.optionsPanelTitle}>
                    {expandedControl === 'timeBound'
                        ? 'Time bound'
                        : 'Is event'}
                  </Text>
                  <TouchableOpacity
                    style={styles.optionsPanelCloseBtn}
                    onPress={() => setExpandedControl(null)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Close options panel"
                  >
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {expandedControl === 'timeBound' && (timeBoundEnabled || eventSyncEnabled) && startTimePlacement === 'timeBound'
                  ? startTimeExpandedContent
                  : null}
                {expandedControl === 'eventSync' && (timeBoundEnabled || eventSyncEnabled) && startTimePlacement === 'event'
                  ? startTimeExpandedContent
                  : null}

                {expandedControl === 'eventSync' && eventSyncEnabled ? (
                  <View style={styles.optionsPanelEventColorRow}>
                    <View style={styles.optionsPanelTextWrap}>
                      <Text style={styles.optionsPanelLabel}>Event color</Text>
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
            ) : null}
          </View>
        </KeyboardAwareScrollView>
      </Animated.View>
    </>
  );
}
