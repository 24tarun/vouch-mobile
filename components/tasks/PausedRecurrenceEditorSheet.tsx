import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import type { Currency, RecurrenceRule } from '@/lib/types';
import { getFailureCostBounds, isValidFailureCostCents } from '@/lib/domain/failure-cost';
import { useFriends } from '@/lib/hooks/useFriends';
import {
  buildVoucherPillOptions,
  VoucherPillSelector,
} from '@/components/tasks/VoucherPillSelector';
import {
  type PausedRecurrenceSettings,
  updatePausedRecurrenceSettings,
} from '@/lib/tasks/task-actions';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';

export type RecurrenceEditorField = 'deadline' | 'failureCost' | 'voucher' | 'requiresProof';

interface Props {
  field: RecurrenceEditorField;
  taskId: string;
  recurrenceRule: RecurrenceRule;
  currency: Currency;
  currentUserId: string;
  onClose: () => void;
  onSaved: (settings: PausedRecurrenceSettings) => void;
}

const FIELD_TITLE: Record<RecurrenceEditorField, string> = {
  deadline: 'Future deadline',
  failureCost: 'Future failure cost',
  voucher: 'Future voucher',
  requiresProof: 'Proof for future repetitions',
};

function dateForTimeOfDay(value: string): Date {
  const [hours, minutes] = value.split(':').map(Number);
  const next = new Date();
  next.setHours(
    Number.isInteger(hours) ? hours : 12,
    Number.isInteger(minutes) ? minutes : 0,
    0,
    0,
  );
  return next;
}

function formatFailureCostInput(cents: number): string {
  const major = cents / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

export function PausedRecurrenceEditorSheet({
  field,
  taskId,
  recurrenceRule,
  currency,
  currentUserId,
  onClose,
  onSaved,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { friends, loading: friendsLoading } = useFriends();
  const initialTime = recurrenceRule.rule_config.time_of_day;
  const [deadlineTime, setDeadlineTime] = useState(() => dateForTimeOfDay(initialTime));
  const [failureCost, setFailureCost] = useState(() => formatFailureCostInput(recurrenceRule.failure_cost_cents));
  const [voucherValue, setVoucherValue] = useState(
    recurrenceRule.voucher_id === currentUserId ? 'self' : recurrenceRule.voucher_id,
  );
  const [requiresProof, setRequiresProof] = useState(Boolean(recurrenceRule.requires_proof));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voucherOptions = useMemo(
    () => buildVoucherPillOptions({
      defaultVoucherValue: recurrenceRule.voucher_id === currentUserId ? 'self' : recurrenceRule.voucher_id,
      friends,
      aiState: {
        quotaLabel: '',
        accessibilityLabel: 'AI voucher',
        disabled: false,
      },
    }),
    [currentUserId, friends, recurrenceRule.voucher_id],
  );
  const selectedVoucherId = voucherValue === 'self' ? currentUserId : voucherValue;
  const aiVoucherSelected = selectedVoucherId === AI_PROFILE_ID;
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'INR' ? '₹' : '$';

  function handleTimeChange(event: DateTimePickerEvent, value?: Date) {
    if (event.type === 'dismissed' || !value) return;
    setDeadlineTime(value);
  }

  async function save() {
    if (saving) return;
    setError(null);

    let patch:
      | { timeOfDay: string }
      | { failureCostCents: number }
      | { voucherId: string }
      | { requiresProof: boolean };

    if (field === 'deadline') {
      const hours = String(deadlineTime.getHours()).padStart(2, '0');
      const minutes = String(deadlineTime.getMinutes()).padStart(2, '0');
      patch = { timeOfDay: `${hours}:${minutes}` };
    } else if (field === 'failureCost') {
      const major = Number(failureCost.trim());
      const cents = Math.round(major * 100);
      const bounds = getFailureCostBounds(currency);
      if (!Number.isFinite(major) || !isValidFailureCostCents(cents, bounds)) {
        setError(`Enter an amount between ${currencySymbol}${bounds.minMajor} and ${currencySymbol}${bounds.maxMajor}, in ${currencySymbol}${bounds.stepMajor} increments.`);
        return;
      }
      patch = { failureCostCents: cents };
    } else if (field === 'voucher') {
      if (!selectedVoucherId) {
        setError('Choose a voucher.');
        return;
      }
      patch = { voucherId: selectedVoucherId };
    } else {
      patch = { requiresProof: aiVoucherSelected ? true : requiresProof };
    }

    setSaving(true);
    try {
      const result = await updatePausedRecurrenceSettings(taskId, patch);
      if (!result.success || !result.settings) {
        setError(result.error ?? 'Could not update future repetitions.');
        return;
      }
      onSaved(result.settings);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close editor" />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>PAUSED REPETITION</Text>
              <Text style={styles.title}>{FIELD_TITLE[field]}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.description}>
            This changes future repetitions only. Existing iterations keep their original values.
          </Text>

          {field === 'deadline' ? (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={deadlineTime}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minuteInterval={1}
                onChange={handleTimeChange}
              />
            </View>
          ) : null}

          {field === 'failureCost' ? (
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>{currencySymbol}</Text>
              <TextInput
                value={failureCost}
                onChangeText={setFailureCost}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={styles.input}
                accessibilityLabel="Failure cost for future repetitions"
              />
            </View>
          ) : null}

          {field === 'voucher' ? (
            <View style={styles.voucherWrap}>
              <VoucherPillSelector
                options={voucherOptions}
                selectedValue={voucherValue}
                loading={friendsLoading}
                onSelect={setVoucherValue}
              />
              {aiVoucherSelected ? (
                <Text style={styles.helper}>AI-vouched repetitions always require proof.</Text>
              ) : null}
            </View>
          ) : null}

          {field === 'requiresProof' ? (
            <View style={styles.booleanRow}>
              {[
                { value: true, label: 'True' },
                { value: false, label: 'False' },
              ].map((option) => {
                const disabled = aiVoucherSelected && !option.value;
                const selected = (aiVoucherSelected ? true : requiresProof) === option.value;
                return (
                  <TouchableOpacity
                    key={String(option.value)}
                    style={[
                      styles.booleanButton,
                      selected && styles.booleanButtonSelected,
                      disabled && styles.disabled,
                    ]}
                    onPress={() => {
                      if (!disabled) setRequiresProof(option.value);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled }}
                  >
                    <Text style={[styles.booleanText, selected && styles.booleanTextSelected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.disabled]}
            onPress={() => void save()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save future repetition setting"
          >
            {saving ? <ActivityIndicator size="small" color="#020617" /> : <Feather name="check" size={18} color="#020617" />}
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save for future repetitions'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors, _isDark: boolean) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: typography.bold,
    color: '#C084FC',
  },
  title: {
    marginTop: 3,
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: colors.text,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.surface2,
  },
  description: {
    fontSize: typography.sm,
    lineHeight: 19,
    color: colors.textMuted,
  },
  pickerWrap: {
    minHeight: Platform.OS === 'ios' ? 180 : 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  inputWrap: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
  },
  inputPrefix: {
    marginRight: spacing.xs,
    fontSize: typography.lg,
    color: colors.textMuted,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: typography.lg,
    color: colors.text,
  },
  voucherWrap: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  helper: {
    fontSize: typography.xs,
    color: '#C084FC',
  },
  booleanRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  booleanButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  booleanButtonSelected: {
    borderColor: '#C084FC',
    backgroundColor: '#C084FC1F',
  },
  booleanText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.textMuted,
  },
  booleanTextSelected: {
    color: '#D8B4FE',
  },
  error: {
    fontSize: typography.sm,
    color: colors.destructive,
  },
  saveButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: '#C084FC',
  },
  saveText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    color: '#020617',
  },
  disabled: {
    opacity: 0.45,
  },
});
