import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../i18n/LanguageContext';

const RETURN_TO_KEY = 'stories-canvas:returnTo';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for OAuth error in URL params (Supabase returns errors as query params)
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const errorParam = params.get('error') || hashParams.get('error');
    const errorDescription = params.get('error_description') || hashParams.get('error_description');

    if (errorParam) {
      console.error('[AuthCallback] OAuth error:', errorParam, errorDescription);
      setError(errorDescription || errorParam);
      return;
    }

    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) {
        console.error('[AuthCallback] getSession error:', sessionError.message);
        setError(sessionError.message);
        return;
      }

      const returnTo = localStorage.getItem(RETURN_TO_KEY) || '/';
      localStorage.removeItem(RETURN_TO_KEY);

      if (session) {
        navigate(returnTo, { replace: true });
      } else {
        // If no session yet, listen for auth state change (OAuth flow may still be completing)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (event === 'SIGNED_IN' && newSession) {
            subscription.unsubscribe();
            const savedReturnTo = localStorage.getItem(RETURN_TO_KEY) || returnTo;
            localStorage.removeItem(RETURN_TO_KEY);
            navigate(savedReturnTo, { replace: true });
          }
        });

        // Timeout fallback - redirect home after 10s if nothing happens
        const timeout = setTimeout(() => {
          subscription.unsubscribe();
          console.warn('[AuthCallback] Timed out waiting for session');
          navigate('/', { replace: true });
        }, 10_000);

        return () => {
          clearTimeout(timeout);
          subscription.unsubscribe();
        };
      }
    });
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-12 h-12 mx-auto mb-4 text-red-500 dark:text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <p className="text-red-600 dark:text-red-400 text-lg font-medium mb-2">{t.authError}</p>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-primary-600 dark:text-primary-400 hover:underline text-sm"
          >
            {t.backToLogin}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-lg">{t.finalizingAuth}</p>
      </div>
    </div>
  );
}
