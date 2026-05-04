declare module 'react-native-ui-datepicker' {
  import type { ComponentType } from 'react';

  export interface UiDatePickerChangeEvent {
    date?: Date | string | number | null;
  }

  export interface UiDatePickerProps {
    mode?: 'single' | string;
    date?: Date;
    minDate?: Date;
    maxDate?: Date;
    disableMonthPicker?: boolean;
    disableYearPicker?: boolean;
    timePicker?: boolean;
    onChange?: (event: UiDatePickerChangeEvent) => void;
    styles?: Record<string, unknown>;
    style?: unknown;
  }

  const DateTimePicker: ComponentType<UiDatePickerProps>;
  export default DateTimePicker;
}

declare module 'react-native-ui-datepicker/lib/commonjs/components/time-picker/wheel-picker/wheel-picker' {
  import type { ComponentType } from 'react';

  export interface WheelPickerOption {
    value: number;
    text: string;
  }

  export interface WheelPickerProps {
    value: number;
    options: WheelPickerOption[];
    onChange: (value: number) => void;
    itemHeight?: number;
    visibleRest?: number;
    decelerationRate?: 'fast' | 'normal' | number;
    itemTextStyle?: unknown;
    selectedIndicatorStyle?: unknown;
    containerStyle?: unknown;
    flatListProps?: unknown;
  }

  const WheelPicker: ComponentType<WheelPickerProps>;
  export default WheelPicker;
}
