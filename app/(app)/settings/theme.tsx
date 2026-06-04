import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/settings/styles';

export default function SettingsThemeScreen() {
  const router = useRouter();
  const { colors, theme, setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
