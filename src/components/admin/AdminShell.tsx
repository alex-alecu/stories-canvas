import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBillingOverview } from '../../hooks/useBilling';
import { useLanguage } from '../../i18n/LanguageContext';

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: billingOverview, isLoading: billingLoading, error } = useBillingOverview(!!user);

  useEffect(() => {
    if (!loading && !user) {
      const returnTo = `${location.pathname}${location.search}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    }
  }, [loading, location.pathname, location.search, navigate, user]);

  const forbidden = useMemo(() => (
    !!error && error.message.toLowerCase().includes('admin')
  ), [error]);

  if (loading || billingLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-300 border-t-primary-600 dark:border-primary-700 dark:border-t-primary-400" />
      </div>
    );
  }

  if (!user) return null;

  if (forbidden || !billingOverview?.isAdmin) {
    return (
      <div className="min-h-screen p-6 md:p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/40 dark:bg-red-950/30">
          <h1 className="text-2xl font-bold text-red-700 dark:text-red-300">{t.adminAccessRequiredTitle}</h1>
          <p className="mt-2 text-sm text-red-600 dark:text-red-300/80">{t.adminAccessRequiredBody}</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/users', label: 'Users', end: false },
    { to: '/admin/stories', label: 'Stories', end: false },
  ];

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-primary-500">{t.adminLabel}</p>
              <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">Operations</h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Pricing, billing, users, and story profitability.</p>
            </div>
            <div className="rounded-2xl bg-primary-50 px-4 py-3 text-sm text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
              {t.adminSignedInAs} {user.email}
            </div>
          </div>
          <nav className="mt-5 flex gap-2 overflow-x-auto" aria-label="Admin sections">
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-primary-50 hover:text-primary-700 dark:bg-surface-dark dark:text-gray-300 dark:hover:bg-primary-900/30 dark:hover:text-primary-200'
                }`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </section>
        {children}
      </div>
    </main>
  );
}
