import { Link } from 'react-router-dom';
import {
  getCurrentLegalProfile,
  interpolateLegalText,
  type LegalLink,
} from '../legal/legalConfig';
import { clientSiteConfig } from '../lib/siteConfig';

function FooterLink({ link }: { link: LegalLink }) {
  if (link.external) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-gray-500 transition-colors hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-300"
      >
        {link.label}
      </a>
    );
  }

  return (
    <Link
      to={link.href}
      className="text-sm text-gray-500 transition-colors hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-300"
    >
      {link.label}
    </Link>
  );
}

export default function Footer() {
  const profile = getCurrentLegalProfile();
  const currentYear = new Date().getFullYear();
  const operatorName = interpolateLegalText('{operator.name}', profile);
  const operatorLegalForm = interpolateLegalText('{operator.legalForm}', profile);
  const operatorTaxId = interpolateLegalText('{operator.taxId}', profile);
  const operatorRegistration = interpolateLegalText('{operator.registrationNumber}', profile);

  return (
    <footer className="relative z-10 border-t border-primary-100 bg-white/70 px-4 py-8 backdrop-blur-sm dark:border-primary-900/50 dark:bg-surface-dark/70 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.2fr_1.8fr]">
        <div>
          <p className="text-base font-extrabold text-gray-900 dark:text-gray-100">
            {clientSiteConfig.siteName}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            {profile.footerDescription}
          </p>
          <div className="mt-4 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            <p>
              © {currentYear} {operatorName} {operatorLegalForm}
            </p>
            <p>
              {operatorRegistration} · {operatorTaxId}
            </p>
          </div>
        </div>

        <nav className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" aria-label="Footer navigation">
          {profile.footerGroups.map(group => (
            <div key={group.title}>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                {group.title}
              </p>
              <ul className="mt-3 space-y-2">
                {group.links.map(link => (
                  <li key={`${link.href}-${link.label}`}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
