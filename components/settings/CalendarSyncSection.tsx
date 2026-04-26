import { useState } from 'react';
import { ActivityIndicator, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { useGoogleCalendarConnection } from '@/hooks/useGoogleCalendarConnection';
import { GOOGLE_EVENT_COLOR_OPTIONS, type GoogleEventColorId } from '@/lib/task-title-parser';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface CalendarSyncSectionProps {
  onSavingStateChange?: (saving: boolean) => void;
  onSaveSuccess?: () => void;
}

export function CalendarSyncSection({ onSavingStateChange, onSaveSuccess }: CalendarSyncSectionProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading } = useGoogleCalendarConnection();
  const [savingColorId, setSavingColorId] = useState<GoogleEventColorId | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const syncReady = Boolean(data?.readyForAppToGoogleSync);

  async function handleSelectDefaultColor(nextColorId: GoogleEventColorId) {
    if (!user?.id || !data?.connected || savingColorId === nextColorId) return;

    setSavingColorId(nextColorId);
    onSavingStateChange?.(true);
    setColorError(null);

    const { error } = await (supabase.from('google_calendar_connections') as any)
      .update({ default_event_color_id: nextColorId })
      .eq('user_id', user.id);

    if (error) {
      setColorError(error.message || 'Could not update default Google event color.');
      setSavingColorId(null);
      onSavingStateChange?.(false);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['google-calendar-connection', user.id] });
    setSavingColorId(null);
    onSavingStateChange?.(false);
    onSaveSuccess?.();
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Google Calendar</Text>
      <Text style={styles.settingsHelpText}>Please manage calendar connections on the website tas.tarunh.com.</Text>
      <View style={styles.card}>
        {isLoading ? (
          <View style={[styles.row, { justifyContent: 'center' }]}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        ) : (
          <>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel}>Connected</Text>
                  {data?.accountEmail ? (
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>{data.accountEmail}</Text>
                  ) : null}
                  {data?.selectedCalendarSummary ? (
                    <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                      Calendar: {data.selectedCalendarSummary}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Switch
                value={Boolean(data?.connected)}
                disabled
                trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                thumbColor={colors.text}
              />
            </View>
            <View style={styles.cardDivider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel}>{'vouch --> google calendar'}</Text>
                </View>
              </View>
              <Switch
                value={syncReady}
                disabled
                trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                thumbColor={colors.text}
              />
            </View>

            {data?.connected ? (
              <>
                <View style={styles.cardDivider} />
                <View style={styles.settingsBlock}>
                  <Text style={styles.rowLabel}>Default mobile event color</Text>
                  <View style={styles.eventColorOptionsWrap}>
                    {GOOGLE_EVENT_COLOR_OPTIONS.map((option) => {
                      const isSelected = data?.defaultEventColorId === option.colorId;
                      const isSaving = savingColorId === option.colorId;

                      return (
                        <TouchableOpacity
                          key={option.colorId}
                          style={[
                            styles.eventColorDotButton,
                            isSelected && styles.eventColorDotButtonSelected,
                            savingColorId && savingColorId !== option.colorId ? styles.rowDisabled : null,
                          ]}
                          activeOpacity={0.85}
                          onPress={() => handleSelectDefaultColor(option.colorId)}
                          disabled={Boolean(savingColorId)}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${option.nativeToken.replace('-', '')} as the default Google event color`}
                        >
                          <View
                            style={[
                              styles.eventColorDotSwatch,
                              { backgroundColor: option.swatchHex },
                            ]}
                          >
                            {isSaving ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : isSelected ? (
                              <Feather name="check" size={12} color="#FFFFFF" />
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {colorError ? (
                    <Text style={styles.errorText}>{colorError}</Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {data?.lastError ? (
              <>
                <View style={styles.cardDivider} />
                <View style={styles.rowTinted}>
                  <View style={styles.rowLeft}>
                    <Feather name="alert-triangle" size={18} color={colors.destructive} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowLabel}>Last Google Calendar error</Text>
                      <Text style={{ fontSize: 12, color: colors.textMuted }}>{data.lastError}</Text>
                    </View>
                  </View>
                </View>
              </>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
