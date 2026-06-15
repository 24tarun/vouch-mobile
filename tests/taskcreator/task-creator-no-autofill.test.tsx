/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const MockIcon = ({ name }: { name?: string }) => React.createElement(Text, null, name ?? 'icon');
  return {
    Feather: MockIcon,
    Ionicons: MockIcon,
  };
});

import { TaskCreatorOverlay } from '@/components/tasks/TaskCreatorOverlay';
import type { GoogleEventColorId } from '@/lib/task-title-parser';
import type { DraftReminder, RecurrenceType } from '@/components/tasks/types';

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
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

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

  it('quick deadline chips update the pending deadline', () => {
    const setCustomDeadlineDate = jest.fn();
    jest.setSystemTime(new Date('2026-05-05T12:00:30.000Z'));

    const { getByText } = render(
      <TaskCreatorOverlay
        {...defaultProps}
        showCustomDeadlineIosModal
        setCustomDeadlineDate={setCustomDeadlineDate}
      />,
    );

    fireEvent.press(getByText('In 10m'));

    expect(setCustomDeadlineDate).toHaveBeenCalledWith(new Date('2026-05-05T12:10:00.000Z'));
  });

  it('hides the final-call reminder from the visible reminder list', () => {
    const draftReminders: DraftReminder[] = [
      {
        id: 'preset-10m',
        source: 'DEFAULT_DEADLINE_10M',
        reminderAt: new Date(2026, 4, 5, 11, 50, 0, 0),
      },
      {
        id: 'preset-due',
        source: 'DEFAULT_DEADLINE_DUE',
        reminderAt: new Date(2026, 4, 5, 12, 0, 0, 0),
      },
    ];

    const { getByText, queryByText } = render(
      <TaskCreatorOverlay
        {...defaultProps}
        draftReminders={draftReminders}
      />,
    );

    expect(getByText('11:50 05/05/26')).toBeTruthy();
    expect(queryByText('12:00 05/05/26')).toBeNull();
  });
});
