import { type EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';

export type AlarmKitAuthorizationStatus = 'authorized' | 'denied' | 'not_determined' | 'unavailable';

export type ScheduleTenMinuteAlarmInput = {
  reminderId: string;
  taskId: string;
  taskTitle: string;
  fireAtISO: string;
};

export type ScheduleTenMinuteAlarmResult = {
  nativeAlarmId: string;
};

export type OpenTaskAlarmAction = {
  taskId: string;
  reminderId: string;
  nativeAlarmId: string;
};

type NativeAlarmKitModule = {
  isAlarmKitAvailableAsync(): Promise<boolean>;
  getAlarmAuthorizationStatusAsync(): Promise<AlarmKitAuthorizationStatus>;
  requestAlarmAuthorizationAsync(): Promise<AlarmKitAuthorizationStatus>;
  scheduleTenMinuteAlarmAsync(input: ScheduleTenMinuteAlarmInput): Promise<ScheduleTenMinuteAlarmResult>;
  cancelTenMinuteAlarmAsync(input: { nativeAlarmId: string }): Promise<void>;
  consumePendingOpenTaskActionsAsync(): Promise<OpenTaskAlarmAction[]>;
  addListener(eventName: 'onOpenTask', listener: (payload: OpenTaskAlarmAction) => void): EventSubscription;
  removeListeners(count: number): void;
};

const NativeAlarmKit = requireOptionalNativeModule<NativeAlarmKitModule>('AlarmKit');

export async function isAlarmKitAvailableAsync(): Promise<boolean> {
  return NativeAlarmKit?.isAlarmKitAvailableAsync?.() ?? false;
}

export async function getAlarmAuthorizationStatusAsync(): Promise<AlarmKitAuthorizationStatus> {
  return NativeAlarmKit?.getAlarmAuthorizationStatusAsync?.() ?? 'unavailable';
}

export async function requestAlarmAuthorizationAsync(): Promise<AlarmKitAuthorizationStatus> {
  return NativeAlarmKit?.requestAlarmAuthorizationAsync?.() ?? 'unavailable';
}

export async function scheduleTenMinuteAlarmAsync(
  input: ScheduleTenMinuteAlarmInput,
): Promise<ScheduleTenMinuteAlarmResult> {
  if (!NativeAlarmKit?.scheduleTenMinuteAlarmAsync) {
    throw new Error('AlarmKit is unavailable on this platform.');
  }
  return NativeAlarmKit.scheduleTenMinuteAlarmAsync(input);
}

export async function cancelTenMinuteAlarmAsync(input: { nativeAlarmId: string }): Promise<void> {
  if (!NativeAlarmKit?.cancelTenMinuteAlarmAsync) return;
  await NativeAlarmKit.cancelTenMinuteAlarmAsync(input);
}

export async function consumePendingOpenTaskActionsAsync(): Promise<OpenTaskAlarmAction[]> {
  return NativeAlarmKit?.consumePendingOpenTaskActionsAsync?.() ?? [];
}

export function addOpenTaskListener(
  callback: (payload: OpenTaskAlarmAction) => void,
): { remove: () => void } {
  if (!NativeAlarmKit?.addListener) {
    return { remove: () => {} };
  }
  return NativeAlarmKit.addListener('onOpenTask', callback);
}
