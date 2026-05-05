import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import BillingContent from '../components/BillingContent';
import DeviceDownloadsPanel from '../components/DeviceDownloadsPanel';

export default function Profile() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
    }
  }, [loading, user, navigate, location.pathname, location.search]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || t.user;
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const email = user.email;

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Profile header */}
        <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg shadow-primary-100/50 dark:shadow-primary-900/30 border border-primary-100 dark:border-primary-800/50 p-6 md:p-8 mb-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col sm:flex-row items-center gap-6 flex-1">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-20 h-20 rounded-full border-4 border-primary-200 dark:border-primary-700 shadow-md"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-center sm:text-left flex-1">
                <h1 className="text-2xl font-extrabold text-gray-800 dark:text-gray-100">{displayName}</h1>
                {email && <p className="text-gray-500 dark:text-gray-400">{email}</p>}
              </div>
            </div>

            <div className="flex">
              <button
                onClick={handleSignOut}
                className="self-center bg-gray-100 dark:bg-surface-dark-accent hover:bg-gray-200 dark:hover:bg-surface-dark text-gray-700 dark:text-gray-200 font-bold py-2.5 px-6 rounded-xl transition-colors text-sm"
              >
                {t.logout}
              </button>
            </div>
          </div>
        </div>

        <DeviceDownloadsPanel />
        <BillingContent />
      </div>
    </div>
  );
}
