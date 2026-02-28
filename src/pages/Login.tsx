import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';

const RETURN_TO_KEY = 'stories-canvas:returnTo';

type Mode = 'signIn' | 'signUp' | 'forgotPassword';

export default function Login() {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = searchParams.get('returnTo') || '/';
  const { t } = useLanguage();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Save returnTo so it persists through OAuth redirect
  useEffect(() => {
    localStorage.setItem(RETURN_TO_KEY, returnTo);
  }, [returnTo]);

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      navigate(returnTo, { replace: true });
    }
  }, [loading, user, returnTo, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      if (mode === 'forgotPassword') {
        const { error: resetError } = await resetPassword(email);
        if (resetError) {
          setError(resetError.message);
        } else {
          setMessage(t.resetPasswordSent);
        }
      } else if (mode === 'signUp') {
        const { error: signUpError, confirmEmail } = await signUpWithEmail(email, password);
        if (signUpError) {
          setError(signUpError.message);
        } else if (confirmEmail) {
          setMessage(t.checkEmailForConfirmation);
        }
      } else {
        const { error: signInError } = await signInWithEmail(email, password);
        if (signInError) {
          setError(signInError.message);
        }
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary-300 border-t-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-primary-100/50 border border-primary-100 p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-primary-600 via-primary-500 to-warm-500 bg-clip-text text-transparent mb-2">
              {t.loginTitle}
            </h1>
            <p className="text-gray-500">
              {t.loginSubtitle}
            </p>
          </div>

          {/* Email / Password form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                {t.email}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-400 focus:outline-none transition-colors"
                placeholder={t.email}
              />
            </div>

            {mode !== 'forgotPassword' && (
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  {t.password}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-400 focus:outline-none transition-colors"
                  placeholder={t.password}
                  minLength={6}
                />
              </div>
            )}

            {error && (
              <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {message && (
              <div className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-bold py-3 px-6 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                </span>
              ) : mode === 'forgotPassword' ? (
                t.forgotPassword.replace('?', '')
              ) : mode === 'signUp' ? (
                t.signUp
              ) : (
                t.signIn
              )}
            </button>
          </form>

          {/* Mode toggles */}
          <div className="mt-4 text-center text-sm space-y-2">
            {mode === 'signIn' && (
              <>
                <button
                  onClick={() => { setMode('forgotPassword'); setError(''); setMessage(''); }}
                  className="text-primary-500 hover:text-primary-600 transition-colors"
                >
                  {t.forgotPassword}
                </button>
                <p className="text-gray-500">
                  {t.noAccountYet}{' '}
                  <button
                    onClick={() => { setMode('signUp'); setError(''); setMessage(''); }}
                    className="text-primary-500 hover:text-primary-600 font-medium transition-colors"
                  >
                    {t.signUp}
                  </button>
                </p>
              </>
            )}
            {mode === 'signUp' && (
              <p className="text-gray-500">
                {t.alreadyHaveAccount}{' '}
                <button
                  onClick={() => { setMode('signIn'); setError(''); setMessage(''); }}
                  className="text-primary-500 hover:text-primary-600 font-medium transition-colors"
                >
                  {t.signIn}
                </button>
              </p>
            )}
            {mode === 'forgotPassword' && (
              <p className="text-gray-500">
                <button
                  onClick={() => { setMode('signIn'); setError(''); setMessage(''); }}
                  className="text-primary-500 hover:text-primary-600 font-medium transition-colors"
                >
                  {t.signIn}
                </button>
              </p>
            )}
          </div>

          {/* Divider */}
          {mode !== 'forgotPassword' && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-gray-400">{t.orContinueWith}</span>
                </div>
              </div>

              {/* Google OAuth */}
              <button
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 border-2 border-gray-200 hover:border-gray-300 text-gray-700 font-bold py-3 px-6 rounded-xl transition-all transform hover:scale-[1.01] active:scale-[0.99]"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {t.continueWithGoogle}
              </button>
            </>
          )}

          <div className="mt-8 text-center">
            <Link
              to="/"
              className="text-primary-500 hover:text-primary-600 font-medium text-sm transition-colors"
            >
              &larr; {t.backHome}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
