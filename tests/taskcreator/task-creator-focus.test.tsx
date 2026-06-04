import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.useAnimatedReaction = (prepare: () => number, reactFn: (value: number) => void) => {
    reactFn(prepare());
  };
  Reanimated.runOnJS = (fn: (...args: unknown[]) => unknown) => fn;
  return Reanimated;
});

jest.mock('react-native-keyboard-aware-scroll-view', () => ({
  KeyboardAwareScrollView: 'KeyboardAwareScrollView',
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-ui-datepicker', () => 'UiDateTimePicker');
jest.mock('react-native-ui-datepicker/lib/commonjs/components/time-picker/wheel-picker/wheel-picker', () => 'WheelPicker', { virtual: true });

import { TaskCreatorOverlay } from '@/components/tasks/TaskCreatorOverlay';

describe('TaskCreatorOverlay keyboard focus behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('focuses title input after opening interactions complete', async () => {
    const callbacks: Array<() => void> = [];
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task?: Parameters<typeof InteractionManager.runAfterInteractions>[0]) => {
      if (typeof task === 'function') {
        callbacks.push(task);
      }
      return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() } as ReturnType<typeof InteractionManager.runAfterInteractions>;
    });

    const titleInputRef = { current: null } as React.RefObject<any>;
    const titleFocusMock = jest.fn();

    render(
      <TaskCreatorOverlay
        visible
        anchor={{ x: 0, y: 0, width: 300, height: 48 }}
        expandProgress={{ value: 1 } as any}
        screenWidth={390}
        screenHeight={844}
        isCreatingTask={false}
        onCancel={jest.fn()}
        onCreate={jest.fn()}
        titleInputRef={titleInputRef}
        title=""
        onTitleChange={jest.fn()}
        isTitleFocused={false}
        setIsTitleFocused={jest.fn()}
        keyboardVisible={false}
        draftSubtasks={[]}
        onToggleDraftSubtask={jest.fn()}
        onDeleteDraftSubtask={jest.fn()}
        isSubtaskFocused={false}
        setIsSubtaskFocused={jest.fn()}
        subtaskInputRef={{ current: null }}
        newSubtaskDraft=""
        setNewSubtaskDraft={jest.fn()}
        onAddDraftSubtask={jest.fn()}
        deadlineDate={new Date('2026-05-05T12:00:00.000Z')}
        customDeadlineDate={new Date('2026-05-05T12:00:00.000Z')}
        customDeadlinePickerMode="date"
        showCustomDeadlineAndroidPicker={false}
        onCustomDeadlineAndroidPickerChange={jest.fn()}
        onOpenDeadlinePickerFlow={jest.fn()}
        showCustomDeadlineIosModal={false}
        setShowCustomDeadlineIosModal={jest.fn()}
        showCustomDeadlineAndroidModal={false}
        setShowCustomDeadlineAndroidModal={jest.fn()}
        setCustomDeadlineDate={jest.fn()}
        onConfirmCustomDeadline={jest.fn()}
        voucherButtonRef={{ current: null }}
        voucherLabel="Self"
        voucherValue="self"
        onOpenVoucherPicker={jest.fn()}
        currencySymbol="$"
        failureCostInputRef={{ current: null }}
        failureCostInput=""
        setFailureCostInput={jest.fn()}
        friendsLoading={false}
        failureCostSelection={undefined}
        setFailureCostSelection={jest.fn()}
        draftReminders={[]}
        onRemoveReminder={jest.fn()}
        showCustomReminderAndroidPicker={false}
        customReminderDate={new Date('2026-05-05T12:00:00.000Z')}
        customReminderPickerMode="date"
        onCustomReminderAndroidPickerChange={jest.fn()}
        onOpenAddReminderFlow={jest.fn()}
        showCustomReminderIosModal={false}
        setShowCustomReminderIosModal={jest.fn()}
        setCustomReminderDate={jest.fn()}
        onAddCustomReminder={jest.fn()}
        recurrenceType=""
        showCustomRecurrenceDays={false}
        onClearRecurrence={jest.fn()}
        onResetDeadlineAndRecurrence={jest.fn()}
        onSelectRecurrenceType={jest.fn()}
        onToggleCustomRecurrenceDays={jest.fn()}
        recurrenceDays={[]}
        onToggleRecurrenceDay={jest.fn()}
        isAiVoucherSelected={false}
        requiresProof={false}
        setRequiresProof={jest.fn()}
        timeBoundEnabled={false}
        setTimeBoundEnabled={jest.fn()}
        eventSyncEnabled={false}
        setEventSyncEnabled={jest.fn()}
        eventStartDate={null}
        setEventStartDate={jest.fn()}
        selectedGoogleEventColorId="1"
        setSelectedGoogleEventColorId={jest.fn()}
        suggestedStartDate={new Date('2026-05-05T12:00:00.000Z')}
        showEventStartAndroidPicker={false}
        setShowEventStartAndroidPicker={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(callbacks.length).toBeGreaterThan(0);
    });

    titleInputRef.current = { focus: titleFocusMock };
    callbacks.forEach((cb) => cb());

    await waitFor(() => {
      expect(titleFocusMock).toHaveBeenCalled();
    });
  });
});
