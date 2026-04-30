import { useEffect, useMemo, useRef } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { createRealtimeRateLimiter } from '@/lib/query/realtimeRateLimiter';

interface RealtimeSubscription {
  table: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  filter?: string;
}

interface UseRealtimeInvalidationOptions {
  channelName: string;
  enabled: boolean;
  subscriptions: RealtimeSubscription[];
  invalidateKeys?: QueryKey[];
  onPayload?: (payload: unknown) => void;
  maxInvalidationsPerMinute?: number;
  minInvalidateIntervalMs?: number;
}

export function useRealtimeInvalidation({
  channelName,
  enabled,
  subscriptions,
  invalidateKeys = [],
  onPayload,
  maxInvalidationsPerMinute = 20,
  minInvalidateIntervalMs = 750,
}: UseRealtimeInvalidationOptions) {
  const queryClient = useQueryClient();
  const instanceIdRef = useRef(Math.random().toString(36).slice(2, 10));
  const subscriptionsRef = useRef(subscriptions);
  const invalidateKeysRef = useRef(invalidateKeys);
  const onPayloadRef = useRef(onPayload);
  const channelBaseName = useMemo(
    () => `${channelName}:${instanceIdRef.current}`,
    [channelName],
  );
  const subscriptionsSignature = useMemo(
    () =>
      subscriptions
        .map((subscription) => [
          subscription.table,
          subscription.event ?? '*',
          subscription.filter ?? '',
        ].join(':'))
        .join('|'),
    [subscriptions],
  );

  useEffect(() => {
    subscriptionsRef.current = subscriptions;
  }, [subscriptions, subscriptionsSignature]);

  useEffect(() => {
    invalidateKeysRef.current = invalidateKeys;
  }, [invalidateKeys]);

  useEffect(() => {
    onPayloadRef.current = onPayload;
  }, [onPayload]);

  useEffect(() => {
    const activeSubscriptions = subscriptionsRef.current;
    if (!enabled || activeSubscriptions.length === 0) return;

    const rateLimiter = createRealtimeRateLimiter({
      label: channelBaseName,
      callback: () => {
        for (const queryKey of invalidateKeysRef.current) {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
      maxRunsPerWindow: maxInvalidationsPerMinute,
      minIntervalMs: minInvalidateIntervalMs,
    });

    // One channel per subscription: Supabase's postgres_changes is unreliable
    // when multiple filters are multiplexed onto a single channel — some
    // listeners silently drop events during re-subscribe handshakes.
    const channels = activeSubscriptions.map((subscription, index) => {
      const channel = supabase.channel(
        `${channelBaseName}:${subscription.table}:${index}`,
      );
      channel.on(
        'postgres_changes',
        {
          event: subscription.event ?? '*',
          schema: 'public',
          table: subscription.table,
          ...(subscription.filter ? { filter: subscription.filter } : {}),
        },
        (payload) => {
          // onPayload fires immediately for every event so consumers that
          // patch cache state (e.g. handleTaskListPayload) never miss one.
          // Cache-invalidation stays rate-limited to avoid refetch storms.
          onPayloadRef.current?.(payload);
          rateLimiter.trigger();
        },
      );
      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[realtime] Channel ${channelBaseName}:${subscription.table} subscribe error`);
        }
      });
      return channel;
    });

    return () => {
      rateLimiter.dispose();
      for (const channel of channels) {
        void supabase.removeChannel(channel);
      }
    };
  }, [
    enabled,
    maxInvalidationsPerMinute,
    minInvalidateIntervalMs,
    queryClient,
    channelBaseName,
    subscriptionsSignature,
  ]);
}
