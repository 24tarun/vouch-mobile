import { Text, View } from 'react-native';
import { useMemo } from 'react';

import type { TodayParts } from './types';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { ReputationBar } from '@/components/ReputationBar';
import type { ReputationScoreData } from '@/lib/reputation/types';

interface TaskTopBarProps {
  displayName: string;
  todayParts: TodayParts;
  reputationScore: ReputationScoreData | null | undefined;
  showReputationBar: boolean;
}

export function TaskTopBar({
  displayName,
  todayParts,
  reputationScore,
  showReputationBar,
}: TaskTopBarProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  return (
    <>
      <View style={styles.taskHeader}>
        <Text style={styles.taskGreeting}>Hello, {displayName}</Text>
        <View style={styles.taskDateRow}>
          <Text style={styles.taskDateIts}>It&apos;s</Text>
          <Text style={styles.taskDate}> {todayParts.dayName} {todayParts.day} {todayParts.monthName}</Text>
        </View>
      </View>

      {showReputationBar && reputationScore != null && (
        <View style={styles.reputationBarWrap}>
          <ReputationBar data={reputationScore} />
        </View>
      )}
    </>
  );
}
