import React from 'react';
import { render } from '@testing-library/react-native';


import { TaskCreatorOverlay } from '@/components/tasks/TaskCreatorOverlay';
import type { GoogleEventColorId } from '@/lib/task-title-parser';
import type { RecurrenceType } from '@/components/tasks/types';

const defaultProps = {
  visible: true,
  anchor: { x: 0, y: 0, width: 300, height: 48 },
  expandProgress: { value: 1 } as any,
  screenWidth: 390,
  screenHeight: 844,
  isCreatingTask: false,
  onCancel: jest.fn(),
  onCreate: jest.fn(),
  titleInputRef: { current: null },
  title: '',
  onTitleChange: jest.fn(),
  isTitleFocused: false,
  setIsTitleFocused: jest.fn(),
  keyboardVisible: false,
  draftSubtasks: [],
  onToggleDraftSubtask: jest.fn(),
  onDeleteDraftSubtask: jest.fn(),
  isSubtaskFocused: false,
  setIsSubtaskFocused: jest.fn(),
  subtaskInputRef: { current: null },
  newSubtaskDraft: '',
  setNewSubtaskDraft: jest.fn(),
  onAddDraftSubtask: jest.fn(),
  deadlineDate: new Date('2026-05-05T12:00:00.000Z'),
  customDeadlineDate: new Date('2026-05-05T12:00:00.000Z'),
  customDeadlinePickerMode: 'date' as const,
  showCustomDeadlineAndroidPicker: false,
  onCustomDeadlineAndroidPickerChange: jest.fn(),
  onOpenDeadlinePickerFlow: jest.fn(),
  showCustomDeadlineIosModal: false,
  setShowCustomDeadlineIosModal: jest.fn(),
  showCustomDeadlineAndroidModal: false,
  setShowCustomDeadlineAndroidModal: jest.fn(),
  setCustomDeadlineDate: jest.fn(),
  onConfirmCustomDeadline: jest.fn(),
  voucherButtonRef: { current: null },
  voucherLabel: 'Self',
  voucherValue: 'self',
  onOpenVoucherPicker: jest.fn(),
  currencySymbol: '$',
  failureCostInputRef: { current: null },
  failureCostInput: '',
  setFailureCostInput: jest.fn(),
  friendsLoading: false,
  failureCostSelection: undefined,
  setFailureCostSelection: jest.fn(),
  draftReminders: [],
  onRemoveReminder: jest.fn(),
  showCustomReminderAndroidPicker: false,
  customReminderDate: new Date('2026-05-05T12:00:00.000Z'),
  customReminderPickerMode: 'date' as const,
  onCustomReminderAndroidPickerChange: jest.fn(),
  onOpenAddReminderFlow: jest.fn(),
  showCustomReminderIosModal: false,
  setShowCustomReminderIosModal: jest.fn(),
  setCustomReminderDate: jest.fn(),
  onAddCustomReminder: jest.fn(),
  recurrenceType: '' as RecurrenceType,
  showCustomRecurrenceDays: false,
  onClearRecurrence: jest.fn(),
  onResetDeadlineAndRecurrence: jest.fn(),
  onSelectRecurrenceType: jest.fn(),
  onToggleCustomRecurrenceDays: jest.fn(),
  recurrenceDays: [],
  onToggleRecurrenceDay: jest.fn(),
  isAiVoucherSelected: false,
  requiresProof: false,
  setRequiresProof: jest.fn(),
  timeBoundEnabled: false,
  setTimeBoundEnabled: jest.fn(),
  eventSyncEnabled: false,
  setEventSyncEnabled: jest.fn(),
  eventStartDate: null,
  setEventStartDate: jest.fn(),
  selectedGoogleEventColorId: '1' as GoogleEventColorId,
  setSelectedGoogleEventColorId: jest.fn(),
  suggestedStartDate: new Date('2026-05-05T12:00:00.000Z'),
  showEventStartAndroidPicker: false,
  setShowEventStartAndroidPicker: jest.fn(),
};

describe('TaskCreatorOverlay autofill prevention', () => {
  it('task title input has textContentType="none" to prevent macOS password autofill', () => {
    const { getByPlaceholderText } = render(<TaskCreatorOverlay {...defaultProps} />);

    const titleInput = getByPlaceholderText('Task title');
    expect(titleInput.props.textContentType).toBe('none');
    expect(titleInput.props.autoComplete).toBe('off');
  });

  it('subtask input has textContentType="none" to prevent macOS password autofill', () => {
    const { getByPlaceholderText } = render(<TaskCreatorOverlay {...defaultProps} />);

    const subtaskInput = getByPlaceholderText('Add subtask...');
    expect(subtaskInput.props.textContentType).toBe('none');
    expect(subtaskInput.props.autoComplete).toBe('off');
  });
});
