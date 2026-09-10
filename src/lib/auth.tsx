import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, type Profile } from '@/lib/supabase';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  setupError: string | null;
  signUp: (email: string, password: string, displayName: string, phone: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SETUP_MSG =
  'Database tables missing. Open Supabase SQL Editor and run the full file: supabase/remote_setup.sql — then refresh and login again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);

  const fetchProfile = async (uid: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) {
      if (/profiles|schema cache|PGRST205/i.test(error.message + (error.code || ''))) {
        setSetupError(SETUP_MSG);
      }
      setProfile(null);
      return;
    }
    setSetupError(null);
    if (data) {
      setProfile(data as Profile);
      return;
    }
    // Logged in but no profile row yet — create one
    const meta = (await supabase.auth.getUser()).data.user?.user_metadata || {};
    const { data: created, error: insertErr } = await supabase
      .from('profiles')
      .insert({
        id: uid,
        display_name: meta.display_name || 'Player',
        phone: meta.phone || '',
        coins: 1000,
        is_admin: false,
      })
      .select('*')
      .maybeSingle();
    if (insertErr) {
      if (/profiles|schema cache|PGRST205/i.test(insertErr.message)) setSetupError(SETUP_MSG);
      setProfile(null);
      return;
    }
    setProfile(created as Profile);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      (async () => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          await fetchProfile(s.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, displayName: string, phone: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, phone } },
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    // Profile load happens via onAuthStateChange; briefly probe tables
    const { error: probe } = await supabase.from('profiles').select('id').limit(1);
    if (probe && /profiles|schema cache|PGRST205/i.test(probe.message)) {
      return { error: SETUP_MSG };
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setUser(null);
    setSetupError(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, setupError, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
