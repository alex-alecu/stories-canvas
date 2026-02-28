import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../i18n/LanguageContext';

const RETURN_TO_KEY = 'stories-canvas:returnTo';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
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
          navigate('/', { replace: true });
        }, 10_000);

        return () => {
          clearTimeout(timeout);
          subscription.unsubscribe();
        };
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-lg">{t.finalizingAuth}</p>
      </div>
    </div>
  );
}
