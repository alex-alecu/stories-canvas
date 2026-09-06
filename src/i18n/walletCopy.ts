import type { Translations } from './types';

export function getWalletCopy(language: string) {
  return language === 'ro' ? {
    model: 'Model de text', thinking: 'Nivel de gândire', low: 'Redus', medium: 'Mediu', high: 'Ridicat',
    narration: 'Adaugă narațiune', minimum: 'Ai nevoie de cel puțin 10 USD pentru o poveste nouă.',
    actualCost: 'Plătești costul generării: text, imagini și narațiune.',
    moreThinking: 'Un nivel mai ridicat poate crește timpul și costul.',
    howItWorks: 'Cum se calculează costul', choose: 'Alege un model',
    chooseDetail: 'Modelul ales scrie și verifică povestea.',
    pay: 'Plătești cât folosești', payDetail: 'Fiecare cerere este scăzută din sold în dolari SUA.',
    keep: 'Fondurile nu expiră', keepDetail: 'Soldul rămas este disponibil pentru următoarea poveste.',
    usage: 'Costul poveștii', modelDefault: 'Recomandat',
  } : {
    model: 'Text model', thinking: 'Thinking level', low: 'Low', medium: 'Medium', high: 'High',
    narration: 'Add narration', minimum: 'You need at least $10 to start a new story.',
    actualCost: 'You pay the generation cost for text, images, and narration.',
    moreThinking: 'More thinking can increase the time and cost.',
    howItWorks: 'How costs work', choose: 'Choose a model',
    chooseDetail: 'The selected model writes and checks the story.',
    pay: 'Pay for use', payDetail: 'Each request cost is taken from your balance in US dollars.',
    keep: 'Funds do not expire', keepDetail: 'Use the remaining balance for your next story.',
    usage: 'Story cost', modelDefault: 'Recommended',
  };
}

// Keep billing terms consistent. Other languages use English for the changed wallet copy.
export function walletTranslations(language: string): Partial<Translations> {
  const ro = language === 'ro';
  return {
    getCredits: ro ? 'Adaugă fonduri' : 'Add funds',
    availableCredits: ro ? 'Sold disponibil (USD)' : 'Available balance (USD)',
    billingTitle: ro ? 'Fonduri pentru povești' : 'Story funds',
    billingDescription: getWalletCopy(language).minimum,
    billingStoryPacksTitle: ro ? 'Adaugă fonduri' : 'Add funds',
    billingStoryPacksDescription: getWalletCopy(language).actualCost,
    billingBuyPack: ro ? 'Adaugă fonduri' : 'Add funds',
    billingCreditHistoryTitle: ro ? 'Istoric sold' : 'Balance history',
    billingNoCreditActivity: ro ? 'Nu există tranzacții.' : 'No balance changes yet.',
    billingReasonPackPurchase: ro ? 'Fonduri adăugate' : 'Funds added',
    billingReasonAdminGrant: ro ? 'Fonduri de la administrator' : 'Funds from admin',
    profileCreditsTitle: ro ? 'Sold (USD)' : 'Balance (USD)',
    notEnoughCredits: ro ? 'Adaugă fonduri pentru a continua' : 'Add funds to continue',
    billingBannerMoreCreditsTitle: ro ? 'Adaugă fonduri' : 'Add funds',
    billingBannerMoreCreditsBody: getWalletCopy(language).minimum,
    billingBannerCheckoutCompletedBody: ro ? 'Plata a fost acceptată. Soldul se actualizează în câteva secunde.' : 'Payment accepted. Your balance will update in a few seconds.',
    billingBannerPaymentProcessingBody: ro ? 'Plata este în curs. Fondurile vor fi adăugate după confirmare.' : 'Payment is in progress. Funds will be added after confirmation.',
    billingBannerPaymentConfirmedBody: ro ? 'Fondurile au fost adăugate în cont.' : 'The funds were added to your account.',
    billingBannerPaymentFailedBody: ro ? 'Plata nu a reușit. Nu au fost adăugate fonduri.' : 'Payment failed. No funds were added.',
    billingBannerCheckoutExpiredBody: ro ? 'Plata a expirat. Poți încerca din nou.' : 'The payment session expired. You can try again.',
    billingBannerCheckoutCancelledBody: ro ? 'Plata a fost anulată.' : 'Payment cancelled.',
    pageImageRegenerationFailed: ro ? 'Generarea imaginii nu a reușit. Se aplică costurile cererilor efectuate.' : 'Image generation failed. Completed request costs still apply.',
    scriptAndAudioUpdateFailed: ro ? 'Actualizarea nu a reușit. Se aplică costurile cererilor efectuate.' : 'The update failed. Completed request costs still apply.',
    adminTitle: ro ? 'Fonduri și plăți' : 'Funds and payments',
    adminDescription: ro ? 'Gestionează plățile și soldurile în USD.' : 'Manage payments and balances in USD.',
    adminSelectUser: ro ? 'Selectează un utilizator pentru a vedea soldul.' : 'Select a user to see the balance and history.',
    adminGrantFreeCreditsTitle: ro ? 'Adaugă fonduri (USD)' : 'Add funds (USD)',
    adminGrantCredits: ro ? 'Adaugă fonduri' : 'Add funds',
    adminCreditLedgerTitle: ro ? 'Istoric sold (USD)' : 'Balance history (USD)',
  };
}
