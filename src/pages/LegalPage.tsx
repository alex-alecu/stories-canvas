import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getCurrentLegalProfile,
  interpolateLegalText,
  type LegalLink,
  type LegalRouteKey,
} from '../legal/legalConfig';
import {
  getMarketingConsent,
  setMarketingConsent,
} from '../lib/marketing';

function RenderLink({ link }: { link: LegalLink }) {
  if (link.external) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
      >
        {link.label}
      </a>
    );
  }

  return (
    <Link
      to={link.href}
      className="font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
    >
      {link.label}
    </Link>
  );
}

function CookieConsentControls({ profile }: { profile: ReturnType<typeof getCurrentLegalProfile> }) {
  const [marketingConsent, setMarketingConsentState] = useState(() => getMarketingConsent()?.marketing ?? false);

  const updateConsent = (marketing: boolean) => {
    setMarketingConsentState(setMarketingConsent(marketing).marketing);
  };

  return (
    <div className="mt-5 rounded-2xl border border-primary-100 bg-primary-50/70 p-4 dark:border-primary-900/50 dark:bg-primary-950/20">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {profile.marketingConsentLabel}: {marketingConsent ? profile.marketingConsentAcceptedLabel : profile.marketingConsentRejectedLabel}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => updateConsent(true)}
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
        >
          {profile.marketingAcceptLabel}
        </button>
        <button
          type="button"
          onClick={() => updateConsent(false)}
          className="rounded-xl border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:border-primary-800 dark:bg-surface-dark dark:text-primary-200 dark:hover:bg-surface-dark-accent"
        >
          {profile.marketingRejectLabel}
        </button>
      </div>
    </div>
  );
}

export default function LegalPage({ routeKey }: { routeKey: LegalRouteKey }) {
  const profile = getCurrentLegalProfile();
  const document = profile.documents[routeKey];
  const legalNavigation = useMemo(
    () => Object.values(profile.documents).map(item => ({
      label: item.title,
      href: item.route,
      active: item.route === document.route,
    })),
    [document.route, profile.documents],
  );

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-primary-100 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-primary-900/50 dark:bg-surface-dark-elevated/80">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              {profile.legalNavLabel}
            </p>
            <nav className="mt-3 space-y-1" aria-label="Legal pages">
              {legalNavigation.map(link => (
                <Link
                  key={link.href}
                  to={link.href}
                  className={`block rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                    link.active
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200'
                      : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700 dark:text-gray-300 dark:hover:bg-surface-dark-accent dark:hover:text-primary-200'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </aside>

        <article className="rounded-3xl border border-primary-100 bg-white/85 p-6 shadow-lg shadow-primary-100/40 backdrop-blur-sm dark:border-primary-900/50 dark:bg-surface-dark-elevated/85 dark:shadow-primary-950/20 md:p-8">
          <div className="border-b border-primary-100 pb-6 dark:border-primary-900/50">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-500">
              {profile.updatedLabel}: {document.updatedAt}
            </p>
            <h1 className="mt-3 text-3xl font-extrabold text-gray-900 dark:text-gray-100 md:text-4xl">
              {document.title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-gray-500 dark:text-gray-400">
              {document.description}
            </p>
          </div>

          <div className="mt-8 space-y-8">
            {document.sections.map(section => (
              <section key={section.heading}>
                <h2 className="text-xl font-extrabold text-gray-900 dark:text-gray-100">
                  {section.heading}
                </h2>
                {section.body && (
                  <div className="mt-3 space-y-3 text-base leading-7 text-gray-600 dark:text-gray-300">
                    {section.body.map(paragraph => (
                      <p key={paragraph}>
                        {interpolateLegalText(paragraph, profile)}
                      </p>
                    ))}
                  </div>
                )}
                {section.bullets && (
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-7 text-gray-600 dark:text-gray-300">
                    {section.bullets.map(item => (
                      <li key={item}>
                        {interpolateLegalText(item, profile)}
                      </li>
                    ))}
                  </ul>
                )}
                {section.links && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {section.links.map(link => (
                      <RenderLink key={`${link.href}-${link.label}`} link={link} />
                    ))}
                  </div>
                )}
                {section.showCookieControls && (
                  <CookieConsentControls profile={profile} />
                )}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
