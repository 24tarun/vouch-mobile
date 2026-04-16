import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { PomoSession } from '@/lib/types';
import { PomodoroTimer } from './PomodoroTimer';

type PomoEndSource = 'manual_stop' | 'timer_completed' | 'system';
type PomoSessionWithTask = PomoSession & { task?: { id?: string; title?: string | null } | null };
type PomodoroContextType = {
  session: PomoSession | null;
  taskTitle: string | null;
  isLoading: boolean;
  minimized: boolean;
  setMinimized: (value: boolean) => void;
  startSession: (taskId: string, durationMinutes: number) => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  stopSession: (source?: PomoEndSource) => Promise<void>;
};

const MAX_POMO_DURATION_MINUTES = 120;
const PomodoroContext = createContext<PomodoroContextType | undefined>(undefined);

function normalizePomoMinutes(durationMinutes: number) {
  return Number.isFinite(durationMinutes) ? Math.trunc(durationMinutes) : NaN;
}

function isValidPomoDurationMinutes(durationMinutes: number) {
  return Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= MAX_POMO_DURATION_MINUTES;
}

export function usePomodoro() {
  const context = useContext(PomodoroContext);
  if (!context) {
    throw new Error('usePomodoro must be used within a PomodoroProvider');
  }
  return context;
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PomoSession | null>(null);
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const pomoChannelRef = useRef<RealtimeChannel | null>(null);
  const locallyStartedSessionIdRef = useRef<string | null>(null);
  const lastSeenSessionIdRef = useRef<string | null>(null);

  const clearPomoChannel = useCallback(() => {
    const channel = pomoChannelRef.current;
    if (!channel) return;
    void supabase.removeChannel(channel);
    pomoChannelRef.current = null;
  }, []);

  const refreshSession = useCallback(async () => {
    const requestStartedAtMs = Date.now();
    try {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();

      const serverNow = new Date().toISOString();
      if (!authSession?.user?.id) {
        setSession(null);
        setTaskTitle(null);
        setServerClockOffsetMs(0);
        return;
      }

      const responseReceivedAtMs = Date.now();
      const serverNowMs = new Date(serverNow).getTime();
      if (!Number.isNaN(serverNowMs)) {
        const roundTripMs = responseReceivedAtMs - requestStartedAtMs;
        const midpointClientMs = requestStartedAtMs + Math.floor(roundTripMs / 2);
        setServerClockOffsetMs(serverNowMs - midpointClientMs);
      }

      const { data } = await (supabase
        .from('pomo_sessions') as any)
        .select(`
          *,
          task:tasks(id, title)
        `)
        .eq('user_id', authSession.user.id)
        .in('status', ['ACTIVE', 'PAUSED'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const sessionData = (data as PomoSessionWithTask | null) ?? null;
      const nextSessionId = sessionData?.id ?? null;
      const previousSessionId = lastSeenSessionIdRef.current;

      if (sessionData) {
        setSession(sessionData);
        setTaskTitle(sessionData.task?.title?.trim() || 'Focus');

        if (previousSessionId !== nextSessionId) {
          const startedLocally = locallyStartedSessionIdRef.current === nextSessionId;
          setMinimized(!startedLocally);
        }
      } else {
        setSession(null);
        setTaskTitle(null);
        locallyStartedSessionIdRef.current = null;
      }

      lastSeenSessionIdRef.current = nextSessionId;
    } catch (error) {
      console.error('Failed to fetch active pomodoro session', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const subscribeToPomoSessions = (userId: string) => {
      clearPomoChannel();
      const channel = supabase
        .channel(`realtime:pomo_sessions:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'pomo_sessions',
            filter: `user_id=eq.${userId}`,
          },
          () => {
            void refreshSession();
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void refreshSession();
          }
        });

      pomoChannelRef.current = channel;
    };

    const initialize = async () => {
      await refreshSession();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!mounted) return;
      if (user?.id) {
        subscribeToPomoSessions(user.id);
      }
    };

    void initialize();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      if (authSession?.user?.id) {
        subscribeToPomoSessions(authSession.user.id);
        void refreshSession();
      } else {
        clearPomoChannel();
        setSession(null);
        setTaskTitle(null);
        locallyStartedSessionIdRef.current = null;
        lastSeenSessionIdRef.current = null;
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshSession();
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      appStateSubscription.remove();
      clearPomoChannel();
    };
  }, [clearPomoChannel, refreshSession]);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      void refreshSession();
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshSession, session]);

  const startSession = useCallback(async (taskId: string, durationMinutes: number) => {
    const normalizedDuration = normalizePomoMinutes(durationMinutes);
    if (!isValidPomoDurationMinutes(normalizedDuration)) {
      Alert.alert('Invalid pomodoro', `Pomodoro duration must be between 1 and ${MAX_POMO_DURATION_MINUTES} minutes.`);
      return;
    }

    if (session && (session.status === 'ACTIVE' || session.status === 'PAUSED')) {
      if (session.task_id !== taskId) {
        Alert.alert('Pomodoro already running', 'One pomodoro session at a time. Stop the current session first.');
      } else {
        setMinimized(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert('Not signed in', 'You need to sign in before starting a pomodoro.');
        return;
      }

      const { data: ownedTask } = await (supabase
        .from('tasks') as any)
        .select('id')
        .eq('id', taskId)
        .eq('user_id', user.id)
        .single();

      if (!ownedTask) {
        Alert.alert('Cannot start pomodoro', 'You do not have permission to start a pomodoro for this task.');
        return;
      }

      const { data: existing } = await (supabase
        .from('pomo_sessions') as any)
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['ACTIVE', 'PAUSED'])
        .maybeSingle();

      if (existing) {
        Alert.alert('Pomodoro already running', 'One pomodoro session at a time. Stop the current session first.');
        await refreshSession();
        return;
      }

      const nowIso = new Date().toISOString();
      const { data: newSession, error } = await (supabase
        .from('pomo_sessions') as any)
        .insert({
          user_id: user.id,
          task_id: taskId,
          duration_minutes: normalizedDuration,
          is_strict: false,
          status: 'ACTIVE',
          started_at: nowIso,
          elapsed_seconds: 0,
        })
        .select('id')
        .single();

      if (error) {
        Alert.alert('Could not start pomodoro', error.message);
        return;
      }

      locallyStartedSessionIdRef.current = typeof newSession?.id === 'string' ? newSession.id : null;
      await refreshSession();
      setMinimized(false);
    } finally {
      setIsLoading(false);
    }
  }, [refreshSession, session]);

  const pauseSession = useCallback(async () => {
    if (!session) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: currentSession, error: sessionError } = await (supabase
      .from('pomo_sessions') as any)
      .select('*')
      .eq('id', session.id)
      .eq('user_id', user.id)
      .single();

    if (sessionError || !currentSession) {
      Alert.alert('Could not pause pomodoro', sessionError?.message ?? 'Session not found.');
      return;
    }

    if (currentSession.status !== 'ACTIVE') {
      return;
    }

    const now = new Date();
    const startTime = new Date(currentSession.started_at);
    const additionalElapsed = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
    const nextElapsed = Number(currentSession.elapsed_seconds ?? 0) + additionalElapsed;

    const { error } = await (supabase
      .from('pomo_sessions') as any)
      .update({
        status: 'PAUSED',
        elapsed_seconds: nextElapsed,
        paused_at: now.toISOString(),
      })
      .eq('id', session.id)
      .eq('user_id', user.id);

    if (error) {
      Alert.alert('Could not pause pomodoro', error.message);
      return;
    }

    await refreshSession();
  }, [refreshSession, session]);

  const resumeSession = useCallback(async () => {
    if (!session) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await (supabase
      .from('pomo_sessions') as any)
      .update({
        status: 'ACTIVE',
        started_at: new Date().toISOString(),
        paused_at: null,
      })
      .eq('id', session.id)
      .eq('user_id', user.id)
      .eq('status', 'PAUSED');

    if (error) {
      Alert.alert('Could not resume pomodoro', error.message);
      return;
    }

    await refreshSession();
  }, [refreshSession, session]);

  const stopSession = useCallback(async (source: PomoEndSource = 'manual_stop') => {
    if (!session) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: currentSession, error: sessionError } = await (supabase
      .from('pomo_sessions') as any)
      .select('*')
      .eq('id', session.id)
      .eq('user_id', user.id)
      .single();

    if (sessionError || !currentSession) {
      Alert.alert('Could not stop pomodoro', sessionError?.message ?? 'Session not found.');
      return;
    }

    if (currentSession.status === 'COMPLETED' || currentSession.status === 'DELETED') {
      await refreshSession();
      return;
    }

    let finalElapsed = Number(currentSession.elapsed_seconds ?? 0);
    if (currentSession.status === 'ACTIVE') {
      const now = new Date();
      const startTime = new Date(currentSession.started_at);
      finalElapsed += Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
    }

    const completedAt = new Date().toISOString();
    const { error } = await (supabase
      .from('pomo_sessions') as any)
      .update({
        status: 'COMPLETED',
        elapsed_seconds: finalElapsed,
        completed_at: completedAt,
      })
      .eq('id', session.id)
      .eq('user_id', user.id);

    if (error) {
      Alert.alert('Could not stop pomodoro', error.message);
      return;
    }

    if (currentSession.task_id) {
      const { data: task } = await (supabase
        .from('tasks') as any)
        .select('id, title, status')
        .eq('id', currentSession.task_id)
        .eq('user_id', user.id)
        .single();

      if (task?.status) {
        const { error: eventError } = await (supabase.from('task_events') as any).insert({
          task_id: currentSession.task_id,
          event_type: 'POMO_COMPLETED',
          actor_id: user.id,
          from_status: task.status,
          to_status: task.status,
          metadata: {
            session_id: currentSession.id,
            duration_minutes: currentSession.duration_minutes,
            elapsed_seconds: finalElapsed,
            source,
          },
        });

        if (eventError && eventError.code !== '23505') {
          console.error('Failed to log POMO_COMPLETED event:', eventError);
        }
      }
    }

    await refreshSession();
  }, [refreshSession, session]);

  return (
    <PomodoroContext.Provider
      value={{
        session,
        taskTitle,
        isLoading,
        minimized,
        setMinimized,
        startSession,
        pauseSession,
        resumeSession,
        stopSession,
      }}
    >
      {children}
      {session && !minimized ? (
        <PomodoroTimer
          session={session}
          taskTitle={taskTitle || 'Focus'}
          serverClockOffsetMs={serverClockOffsetMs}
          onMinimize={() => setMinimized(true)}
          onPause={() => { void pauseSession(); }}
          onResume={() => { void resumeSession(); }}
          onStop={(source) => { void stopSession(source); }}
        />
      ) : null}
    </PomodoroContext.Provider>
  );
}
