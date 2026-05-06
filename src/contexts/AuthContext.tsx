import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '../lib/supabaseConfig';

interface AuthResult {
  error: AuthError | null;
}

interface SignUpResult extends AuthResult {
  confirmEmail: boolean;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signUpWithEmail: (email: string, password: string) => Promise<SignUpResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function getSupabaseClient() {
  const { supabase } = await import('../lib/supabase');
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    async function loadSession() {
      const supabase = await getSupabaseClient();
      if (cancelled) return;

      const { data: { session: initialSession } } = await supabase.auth.getSession();
      if (cancelled) return;

      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      setLoading(false);

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
      });
      unsubscribe = () => subscription.unsubscribe();
    }

    loadSession().catch((error) => {
      console.error('Failed to initialize auth:', error);
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const supabase = await getSupabaseClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    });
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    // If identities array is empty, the email is already registered
    const confirmEmail = !error && !!data.user && !data.session;
    return { error, confirmEmail };
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/auth/callback',
    });
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = await getSupabaseClient();
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{
      user, session, loading,
      signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
