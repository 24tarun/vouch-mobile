import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
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
	  const statusIcon = syncReady ? 'check-circle' : 'alert-circle';
	  const statusColor = syncReady ? colors.success : colors.textMuted;
	  const statusLabel = syncReady
	    ? 'vouch --> google calendar'
	    : data?.connected
	      ? (data.syncAppToGoogleEnabled
	        ? 'Choose a Google calendar on the website to sync mobile event tasks.'
	        : 'Vouch to Google sync is off on the website, so mobile event tasks will not sync yet.')
	      : 'Connect Google Calendar on the website to sync mobile event tasks.';

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
      <View style={styles.card}>
        {isLoading ? (
          <View style={[styles.row, { justifyContent: 'center' }]}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        ) : data?.connected ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Feather name="check-circle" size={18} color={colors.success} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel}>Connected</Text>
                  {data.accountEmail ? (
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>{data.accountEmail}</Text>
                  ) : null}
                  {data.selectedCalendarSummary ? (
                    <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                      Calendar: {data.selectedCalendarSummary}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
            <View style={styles.cardDivider} />
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Feather name={statusIcon} size={18} color={statusColor} />
                <View style={{ flex: 1, minWidth: 0 }}>
	                  <Text style={styles.rowLabel}>{statusLabel}</Text>
	                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
	                    please manage calendar connects on the website tas.tarunh.com
	                  </Text>
	                </View>
	              </View>
	            </View>
            <View style={styles.cardDivider} />
            <View style={styles.settingsBlock}>
              <Text style={styles.rowLabel}>Default mobile event color</Text>
              <View style={styles.eventColorOptionsWrap}>
                {GOOGLE_EVENT_COLOR_OPTIONS.map((option) => {
                  const isSelected = data.defaultEventColorId === option.colorId;
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
            {data.lastError ? (
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
        ) : (
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Feather name="calendar" size={18} color={colors.textMuted} />
	              <View style={{ flex: 1, minWidth: 0 }}>
	                <Text style={styles.rowLabel}>Please manage calendar connections on the website.</Text>
	                <Text style={{ fontSize: 12, color: colors.textMuted }}>
	                  please manage calendar connects on the website tas.tarunh.com
	                </Text>
	              </View>
	            </View>
	          </View>
        )}
      </View>
    </View>
  );
}
