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
  const lastPayloadRef = useRef<unknown>(null);
  const realtimeChannelName = useMemo(
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
      label: realtimeChannelName,
      callback: () => {
        onPayloadRef.current?.(lastPayloadRef.current);
        for (const queryKey of invalidateKeysRef.current) {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
      maxRunsPerWindow: maxInvalidationsPerMinute,
      minIntervalMs: minInvalidateIntervalMs,
    });
    const channel = supabase.channel(realtimeChannelName);
    for (const subscription of activeSubscriptions) {
      channel.on(
        'postgres_changes',
        {
          event: subscription.event ?? '*',
          schema: 'public',
          table: subscription.table,
          ...(subscription.filter ? { filter: subscription.filter } : {}),
        },
        (payload) => {
          lastPayloadRef.current = payload;
          rateLimiter.trigger();
        },
      );
    }

    channel.subscribe();

    return () => {
      rateLimiter.dispose();
      void supabase.removeChannel(channel);
    };
  }, [
    enabled,
    maxInvalidationsPerMinute,
    minInvalidateIntervalMs,
    queryClient,
    realtimeChannelName,
    subscriptionsSignature,
  ]);
}
