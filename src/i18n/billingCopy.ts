import type { BillingPurchase, CreditLedgerEntry, StoryPackOffer } from '../types';
import type { Language, Translations } from './types';

const DEFAULT_ENGLISH_OFFER_COPY: Record<StoryPackOffer['slug'], { name: string; description: string }> = {
  pack_5: {
    name: '5 stories',
    description: 'Five credits for fast stories or upgraded modes.',
  },
  pack_12: {
    name: '12 stories',
    description: 'Twelve credits for families creating stories regularly.',
  },
  pack_20: {
    name: '20 stories',
    description: 'Twenty credits for the best per-story value.',
  },
};

export function formatCredits(count: number, t: Pick<Translations, 'creditSingular' | 'creditPlural'>): string {
  return `${count} ${count === 1 ? t.creditSingular : t.creditPlural}`;
}

function normalizeCurrency(currency: string | undefined): string {
  const code = (currency || 'ron').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'RON';
}

export function formatLocalizedPrice(priceMinor: number, language: Language, currency = 'ron'): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: normalizeCurrency(currency),
  }).format(priceMinor / 100);
}

export function formatLocalizedDate(
  value: string | undefined,
  language: Language,
  fallback: string,
): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString(language);
}

export function getOfferCopy(
  offer: StoryPackOffer,
  t: Pick<
    Translations,
    'offerPack5Name' |
    'offerPack5Description' |
    'offerPack12Name' |
    'offerPack12Description' |
    'offerPack20Name' |
    'offerPack20Description'
  >,
): { name: string; description: string } {
  const localizedDefaults: Record<StoryPackOffer['slug'], { name: string; description: string }> = {
    pack_5: { name: t.offerPack5Name, description: t.offerPack5Description },
    pack_12: { name: t.offerPack12Name, description: t.offerPack12Description },
    pack_20: { name: t.offerPack20Name, description: t.offerPack20Description },
  };

  const englishDefaults = DEFAULT_ENGLISH_OFFER_COPY[offer.slug];
  const shouldLocalizeName = !offer.name || offer.name === englishDefaults.name;
  const shouldLocalizeDescription = !offer.description || offer.description === englishDefaults.description;

  return {
    name: shouldLocalizeName ? localizedDefaults[offer.slug].name : offer.name,
    description: shouldLocalizeDescription ? localizedDefaults[offer.slug].description : offer.description,
  };
}

export function getPurchaseStatusLabel(
  status: BillingPurchase['status'],
  t: Pick<Translations, 'billingStatusPending' | 'billingStatusCompleted' | 'billingStatusFailed'>,
): string {
  switch (status) {
    case 'pending':
      return t.billingStatusPending;
    case 'completed':
      return t.billingStatusCompleted;
    case 'failed':
      return t.billingStatusFailed;
  }
}

export function getWebhookStatusLabel(
  status: 'processing' | 'processed' | 'failed',
  t: Pick<Translations, 'billingStatusProcessing' | 'billingStatusProcessed' | 'billingStatusFailed'>,
): string {
  switch (status) {
    case 'processing':
      return t.billingStatusProcessing;
    case 'processed':
      return t.billingStatusProcessed;
    case 'failed':
      return t.billingStatusFailed;
  }
}

export function getLedgerReasonLabel(
  reason: CreditLedgerEntry['reason'],
  t: Pick<
    Translations,
    'billingReasonPackPurchase' |
    'billingReasonStoryCreate' |
    'billingReasonStoryAddAudio' |
    'billingReasonStoryRefund' |
    'billingReasonAdminGrant'
  >,
): string {
  switch (reason) {
    case 'pack_purchase':
      return t.billingReasonPackPurchase;
    case 'story_create':
      return t.billingReasonStoryCreate;
    case 'story_add_audio':
      return t.billingReasonStoryAddAudio;
    case 'story_refund':
      return t.billingReasonStoryRefund;
    case 'admin_grant':
      return t.billingReasonAdminGrant;
    default:
      return reason;
  }
}
