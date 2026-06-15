import { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { makeStyles } from '@/components/settings/styles';
import { queryKeys } from '@/lib/query/keys';
import { supabase } from '@/lib/supabase';

export default function SettingsThemeScreen() {
  const router = useRouter();
  const { colors, theme, setTheme } = useTheme();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [savingAlwaysShowActiveTasks, setSavingAlwaysShowActiveTasks] = useState(false);
  const [alwaysShowActiveTasksError, setAlwaysShowActiveTasksError] = useState<string | null>(null);
  const alwaysShowActiveTasks = profile?.always_show_active_tasks ?? false;

  async function handleAlwaysShowActiveTasksChange(nextValue: boolean) {
    if (!user || savingAlwaysShowActiveTasks) return;

    setSavingAlwaysShowActiveTasks(true);
    setAlwaysShowActiveTasksError(null);
    const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));

    queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) =>
      current ? { ...current, always_show_active_tasks: nextValue } : current,
    );

    const { error } = await supabase
      .from('profiles')
      .update({ always_show_active_tasks: nextValue })
      .eq('id', user.id);

    setSavingAlwaysShowActiveTasks(false);

    if (error) {
      queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
      setAlwaysShowActiveTasksError(error.message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.manageFriendsHeader}>
        <TouchableOpacity
          style={styles.manageFriendsBackButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
          <Text style={styles.manageFriendsBackText}>Settings</Text>
        </TouchableOpacity>
        <Text style={styles.manageFriendsTitle}>Appearance</Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Appearance</Text>
          <View style={styles.card}>
            <View style={styles.themeModeRow}>
              {[
                { key: 'system', label: 'System' },
                { key: 'dark', label: 'Dark' },
                { key: 'light', label: 'Light' },
              ].map((mode) => {
                const selected = theme === mode.key;
                return (
                  <TouchableOpacity
                    key={mode.key}
                    style={[styles.themeModeButton, selected && styles.themeModeButtonActive]}
                    activeOpacity={0.85}
                    onPress={() => setTheme(mode.key as 'system' | 'dark' | 'light')}
                    accessibilityRole="button"
                    accessibilityLabel={`Set theme to ${mode.label}`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.themeModeButtonText, selected && styles.themeModeButtonTextActive]}>
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.toggleTitle}>Always show future tasks</Text>
              </View>
              <View style={styles.toggleSwitchWrap}>
                <Switch
                  value={alwaysShowActiveTasks}
                  onValueChange={handleAlwaysShowActiveTasksChange}
                  disabled={!user || savingAlwaysShowActiveTasks}
                  trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                  thumbColor={colors.text}
                />
              </View>
            </View>
            {alwaysShowActiveTasksError ? (
              <Text style={styles.errorText}>{alwaysShowActiveTasksError}</Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
