import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Profile } from '@/lib/types';
import { fetchCurrentProfile } from '@/lib/hooks/useCurrentProfile';
import { queryKeys } from '@/lib/query/keys';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  authInitialized: boolean;
  loading: boolean;
}

let globalChannelNonce = 0;

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  authInitialized: false,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const queryClient = useQueryClient();
  const mountedRef = useRef(true);
  useEffect(() => {
    let profileChannel: ReturnType<typeof supabase.channel> | null = null;
    let activeUserId: string | null = null;
    let channelSetupDone = false;

    async function bindProfile(userId: string) {
      if (activeUserId !== userId) {
        activeUserId = userId;
        channelSetupDone = false;
        if (profileChannel) {
          void supabase.removeChannel(profileChannel);
          profileChannel = null;
        }
      }

      if (!mountedRef.current) return;
      setLoading(true);
      try {
        const nextProfile = await queryClient.fetchQuery({
          queryKey: queryKeys.currentProfile(userId),
          queryFn: () => fetchCurrentProfile(userId),
        });
        if (mountedRef.current && activeUserId === userId) {
          setProfile(nextProfile);
        }
      } finally {
        if (mountedRef.current && activeUserId === userId) {
          setLoading(false);
        }
      }

      if (activeUserId !== userId || channelSetupDone) return;
      channelSetupDone = true;

      globalChannelNonce += 1;
      profileChannel = supabase
        .channel(`auth-profile:${userId}:${globalChannelNonce}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
          (payload) => {
            const nextProfile = payload.new as Profile;
            queryClient.setQueryData(queryKeys.currentProfile(userId), nextProfile);
            if (mountedRef.current) {
              setProfile(nextProfile);
            }
          },
        )
        .subscribe();
    }

    // onAuthStateChange fires immediately with INITIAL_SESSION in supabase-js v2,
    // so getSession() is redundant and was causing two concurrent bindProfile calls.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setAuthInitialized(true);
        if (session?.user) {
          void bindProfile(session.user.id);
        } else {
          activeUserId = null;
          channelSetupDone = false;
          if (profileChannel) {
            void supabase.removeChannel(profileChannel);
            profileChannel = null;
          }
          if (mountedRef.current) {
            setProfile(null);
            setLoading(false);
          }
        }
      },
    );

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      if (profileChannel) {
        void supabase.removeChannel(profileChannel);
      }
    };
  }, [queryClient]);

  // Keep AuthContext.profile in sync with React Query cache writes.
  // Settings applies optimistic profile updates via setQueryData(currentProfile),
  // and this bridge ensures those updates are reflected immediately in screens
  // that consume useAuth().profile.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const key = queryKeys.currentProfile(userId);
    const cachedProfile = queryClient.getQueryData<Profile | null>(key);
    if (cachedProfile !== undefined) {
      setProfile(cachedProfile ?? null);
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (!event?.query) return;
      const queryKey = event.query.queryKey;
      if (!Array.isArray(queryKey) || queryKey[0] !== 'current-profile' || queryKey[1] !== userId) {
        return;
      }
      const next = event.query.state.data as Profile | null | undefined;
      if (next !== undefined) {
        setProfile(next ?? null);
      }
    });

    return unsubscribe;
  }, [queryClient, session?.user?.id]);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, profile, authInitialized, loading }),
    [session, profile, authInitialized, loading],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
