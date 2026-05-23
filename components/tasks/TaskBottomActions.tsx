import { TouchableOpacity, View } from 'react-native';
import { useMemo } from 'react';

import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';

interface TaskBottomActionsProps {
  creatorAnchorRef: React.RefObject<View | null>;
  sortButtonRef: React.RefObject<View | null>;
  onOpenSearchSheet: () => void;
  onOpenCreateSheet: () => void;
  onOpenSortMenu: () => void;
  onMeasuredHeight?: (height: number) => void;
  overlayOpen: boolean;
  bottomOffset: number;
}

export function TaskBottomActions({
  creatorAnchorRef,
  sortButtonRef,
  onOpenSearchSheet,
  onOpenCreateSheet,
  onOpenSortMenu,
  onMeasuredHeight,
  overlayOpen,
  bottomOffset,
}: TaskBottomActionsProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const trafficIconColor = isDark ? '#0b1329' : '#0f172a';
  const actionDisabled = overlayOpen;

  return (
    <View pointerEvents="box-none" style={[styles.bottomActionsHost, { bottom: bottomOffset }]}>
      <View
        ref={creatorAnchorRef}
        collapsable={false}
        onLayout={(event) => onMeasuredHeight?.(event.nativeEvent.layout.height)}
        pointerEvents={overlayOpen ? 'none' : 'auto'}
        style={[styles.bottomActionsBar, overlayOpen && styles.bottomActionsBarDisabled]}
      >
        <TouchableOpacity
          style={[styles.bottomActionButton, styles.bottomActionButtonRed]}
          onPress={onOpenSearchSheet}
          activeOpacity={0.8}
          disabled={actionDisabled}
          accessibilityRole="button"
          accessibilityLabel="Open task search"
        >
          <Feather name="search" size={17} color={trafficIconColor} />
        </TouchableOpacity>

        <View ref={sortButtonRef} collapsable={false}>
          <TouchableOpacity
            style={[styles.bottomActionButton, styles.bottomActionButtonAmber]}
            onPress={onOpenSortMenu}
            activeOpacity={0.8}
            disabled={actionDisabled}
            accessibilityRole="button"
            accessibilityLabel="Sort tasks"
          >
            <Ionicons name="swap-vertical-outline" size={17} color={trafficIconColor} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.bottomActionButton, styles.bottomActionButtonGreen]}
          onPress={onOpenCreateSheet}
          activeOpacity={0.8}
          disabled={actionDisabled}
          accessibilityRole="button"
          accessibilityLabel="Add a new task"
        >
          <Feather name="plus" size={17} color={trafficIconColor} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
