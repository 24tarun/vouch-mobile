import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-worklets', () => ({
  NativeWorklets: {},
  Worklets: { defaultContext: {} },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

jest.mock('react-native-keyboard-aware-scroll-view', () => ({
  KeyboardAwareScrollView: 'KeyboardAwareScrollView',
}));

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-ui-datepicker', () => 'UiDateTimePicker');
jest.mock('react-native-ui-datepicker/lib/commonjs/components/time-picker/wheel-picker/wheel-picker', () => 'WheelPicker', { virtual: true });

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
