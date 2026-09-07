import type { BillingPurchase, CreditLedgerEntry, StoryPackOffer } from '../types';
import type { Language, Translations } from './types';

const DEFAULT_ENGLISH_OFFER_COPY: Record<StoryPackOffer['slug'], { name: string; description: string }> = {
  pack_5: {
    name: '5 credits',
    description: 'Up to 50 fast pages, 25 pro pages, or 50 audio pages.',
  },
  pack_12: {
    name: '12 credits',
    description: 'Up to 120 fast pages, 60 pro pages, or 120 audio pages.',
  },
  pack_20: {
    name: '20 credits',
    description: 'Up to 200 fast pages, 100 pro pages, or 200 audio pages.',
  },
};

const LEGACY_ENGLISH_OFFER_COPY: Record<StoryPackOffer['slug'], { name: string; description: string }> = {
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: Math.abs(count) > 0 && Math.abs(count) < 0.01 ? 6 : 2 }).format(count);
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
  const legacyDefaults = LEGACY_ENGLISH_OFFER_COPY[offer.slug];
  const shouldLocalizeName = !offer.name || offer.name === englishDefaults.name || offer.name === legacyDefaults.name;
  const shouldLocalizeDescription = !offer.description
    || offer.description === englishDefaults.description
    || offer.description === legacyDefaults.description;

  return {
    name: shouldLocalizeName ? localizedDefaults[offer.slug].name : offer.name,
    description: shouldLocalizeDescription ? localizedDefaults[offer.slug].description : offer.description,
  };
}

export function getPurchaseStatusLabel(
  status: BillingPurchase['status'],
  t: Pick<Translations, 'billingStatusPending' | 'billingStatusCompleted' | 'billingStatusFailed' | 'billingStatusExpired'>,
): string {
  switch (status) {
    case 'pending':
      return t.billingStatusPending;
    case 'completed':
      return t.billingStatusCompleted;
    case 'failed':
      return t.billingStatusFailed;
    case 'expired':
      return t.billingStatusExpired;
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
    'billingReasonStoryRegenerateAssets' |
    'billingReasonStoryRegenerateImage' |
    'billingReasonStoryRegenerateAudio' |
    'billingReasonStoryRefund' |
    'billingReasonAdminGrant'
  >,
): string {
  switch (reason) {
    case 'pack_purchase':
      return t.billingReasonPackPurchase;
    case 'story_usage':
      return t.billingReasonStoryCreate;
    case 'story_create':
      return t.billingReasonStoryCreate;
    case 'story_add_audio':
      return t.billingReasonStoryAddAudio;
    case 'story_regenerate_assets':
      return t.billingReasonStoryRegenerateAssets;
    case 'story_regenerate_image':
      return t.billingReasonStoryRegenerateImage;
    case 'story_regenerate_audio':
      return t.billingReasonStoryRegenerateAudio;
    case 'story_refund':
      return t.billingReasonStoryRefund;
    case 'admin_grant':
      return t.billingReasonAdminGrant;
    default:
      return reason;
  }
}
