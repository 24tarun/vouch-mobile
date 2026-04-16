import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const CLIENT_NAME = 'vouch-mobile';
const CLIENT_INSTANCE_STORAGE_KEY = 'vouch_mobile_client_instance_key_v1';

const cachedInstanceIdByUserId = new Map<string, string>();

function getClientPlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function buildClientInstanceKey(): string {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `m-${Date.now().toString(36)}-${randomPart}`;
}

async function getOrCreateLocalClientInstanceKey(): Promise<string> {
  const existing = await AsyncStorage.getItem(CLIENT_INSTANCE_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }

  const next = buildClientInstanceKey();
  await AsyncStorage.setItem(CLIENT_INSTANCE_STORAGE_KEY, next);
  return next;
}

export async function resolveUserClientInstanceId(userId: string): Promise<string | null> {
  if (!userId) return null;

  const cached = cachedInstanceIdByUserId.get(userId);
  if (cached) return cached;

  try {
    const platform = getClientPlatform();
    const instanceKey = await getOrCreateLocalClientInstanceKey();
    const nowIso = new Date().toISOString();
    const appVersion = Constants.expoConfig?.version ?? null;
    const metadata = {
      instance_key: instanceKey,
      app_ownership: Constants.appOwnership ?? null,
      execution_environment: Constants.executionEnvironment ?? null,
    };

    const { data: existing, error: selectError } = await supabase
      .from('user_client_instances')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('client_name', CLIENT_NAME)
      .contains('metadata', { instance_key: instanceKey })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      return null;
    }

    if (existing?.id) {
      cachedInstanceIdByUserId.set(userId, existing.id);
      await supabase
        .from('user_client_instances')
        .update({
          last_seen_at: nowIso,
          app_version: appVersion,
          metadata,
        } as any)
        .eq('id', existing.id)
        .eq('user_id', userId);
      return existing.id;
    }

    const { data: created, error: createError } = await supabase
      .from('user_client_instances')
      .insert({
        user_id: userId,
        platform,
        client_name: CLIENT_NAME,
        device_label: null,
        app_version: appVersion,
        metadata,
        last_seen_at: nowIso,
      } as any)
      .select('id')
      .single();

    if (createError || !created?.id) {
      return null;
    }

    cachedInstanceIdByUserId.set(userId, created.id);
    return created.id;
  } catch {
    return null;
  }
}
