# Marketing Tracking Setup

This app tracks marketing attribution in the browser only after the user grants marketing consent, sends checkout-start funnel events from the frontend, and sends definitive purchase conversions from the Stripe webhook. Missing marketing credentials must not block checkout or purchase fulfillment.

Live ad or post publishing automation is intentionally out of scope for the current implementation. Future agents may use the credentials below for publishing only after the user gives explicit campaign, post, budget, audience, and timing instructions.

## Implementation Map

- Frontend consent, attribution capture, pixel loading, and browser funnel events: `src/lib/marketing.ts`
- Consent banner: `src/components/MarketingConsentBanner.tsx`
- Route page-view tracking: `src/components/MarketingRouteTracker.tsx`
- Checkout payload wiring: `src/components/BillingContent.tsx` and `src/hooks/useBilling.ts`
- Checkout metadata and success URL: `server/services/stripe.ts`
- Checkout route and webhook conversion trigger: `server/routes/billing.ts`
- Server-side conversion APIs: `server/services/marketingConversions.ts`

## Local And Production Secrets

Save local development values in `.env`. Save production values in the production secret store used by the deployment target. Do not commit real credentials.

Frontend/public variables:

```dotenv
VITE_GTM_ID=
VITE_GA4_MEASUREMENT_ID=
VITE_GOOGLE_ADS_CONVERSION_ID=
VITE_GOOGLE_ADS_PURCHASE_CONVERSION_LABEL=
VITE_META_PIXEL_ID=
VITE_TIKTOK_PIXEL_ID=
```

Server/private variables:

```dotenv
APP_BASE_URL=
GA4_API_SECRET=
META_PIXEL_ID=
META_CAPI_ACCESS_TOKEN=
META_TEST_EVENT_CODE=
TIKTOK_PIXEL_ID=
TIKTOK_EVENTS_ACCESS_TOKEN=
TIKTOK_ADVERTISER_ID=
TIKTOK_TEST_EVENT_CODE=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID=
GOOGLE_ADS_API_VERSION=v22
```

Optional future publishing credentials:

```dotenv
META_AD_ACCOUNT_ID=
META_PAGE_ID=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
TIKTOK_BUSINESS_ACCOUNT_ID=
GOOGLE_ADS_MANAGER_CUSTOMER_ID=
```

## Google Setup

1. Create or confirm the Google Analytics 4 property for Stories Canvas.
2. Create a web data stream for the production domain.
3. Copy the GA4 measurement ID into `VITE_GA4_MEASUREMENT_ID`.
4. In GA4 Admin, create a Measurement Protocol API secret for the web stream and save it as `GA4_API_SECRET`.
5. Create a Google Tag Manager web container and save the container ID as `VITE_GTM_ID`.
6. Link GA4 to the Google Ads account.
7. In Google Ads, create a purchase conversion action for story pack purchases. Use an upload/click conversion action if purchases will be imported through the Google Ads API.
8. Save the Google Ads conversion ID and label in `VITE_GOOGLE_ADS_CONVERSION_ID` and `VITE_GOOGLE_ADS_PURCHASE_CONVERSION_LABEL` for GTM/browser configuration.
9. Enable Google Ads API access and save the developer token as `GOOGLE_ADS_DEVELOPER_TOKEN`.
10. Create an OAuth client, generate a refresh token with the `https://www.googleapis.com/auth/adwords` scope, and save `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, and `GOOGLE_ADS_REFRESH_TOKEN`.
11. Save the target account ID as `GOOGLE_ADS_CUSTOMER_ID` without relying on UI formatting. If the account is accessed through an MCC, save the manager ID as `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
12. Save the numeric purchase conversion action ID as `GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID`.

Validation:

- Visit the site with `gclid`, `gbraid`, or `wbraid` URL parameters.
- Accept marketing consent.
- Start checkout and complete a Stripe test purchase.
- Confirm the Stripe Checkout Session metadata contains consent, attribution, and the marketing event ID.
- Confirm Google Ads conversion upload logs do not contain API errors.

## Meta, Facebook, And Instagram Setup

1. Create or confirm the Meta Business Manager.
2. Verify the production website domain in Business Settings.
3. Create or confirm the Pixel/Dataset for the website.
4. Save the pixel ID as both `VITE_META_PIXEL_ID` and `META_PIXEL_ID`.
5. Generate a Conversions API access token for the dataset and save it as `META_CAPI_ACCESS_TOKEN`.
6. For test traffic, create a test event code in Events Manager and save it as `META_TEST_EVENT_CODE`. Remove or blank it for production reporting.
7. Connect the Facebook Page and Instagram business account in Business Settings.
8. Save optional publishing IDs as `META_AD_ACCOUNT_ID`, `META_PAGE_ID`, and `INSTAGRAM_BUSINESS_ACCOUNT_ID` only if future publishing is required.

Validation:

- Use Meta Events Manager Test Events.
- Visit the site with `fbclid`, accept marketing consent, start checkout, and complete a Stripe test purchase.
- Confirm browser `PageView` and `InitiateCheckout` events appear after consent.
- Confirm the server `Purchase` event appears with the Stripe Checkout Session ID as the order ID.

## TikTok Setup

1. Create or confirm the TikTok Business Center and Ads Manager account.
2. Create a website Pixel.
3. Save the pixel code as both `VITE_TIKTOK_PIXEL_ID` and `TIKTOK_PIXEL_ID`.
4. Enable Events API for the pixel and generate an access token.
5. Save the token as `TIKTOK_EVENTS_ACCESS_TOKEN`.
6. Save the advertiser ID as `TIKTOK_ADVERTISER_ID`.
7. Create a test event code and save it as `TIKTOK_TEST_EVENT_CODE`. Remove or blank it for production reporting.
8. Save `TIKTOK_BUSINESS_ACCOUNT_ID` only if future publishing is required.

Validation:

- Use TikTok Events Manager testing tools.
- Visit the site with `ttclid`, accept marketing consent, start checkout, and complete a Stripe test purchase.
- Confirm browser `PageView` and `InitiateCheckout` events appear after consent.
- Confirm the server `CompletePayment` event includes the same event ID and purchase value.

## Stripe Setup

1. Confirm `APP_BASE_URL` is the production browser origin without a trailing slash.
2. Confirm the production webhook endpoint points to `/api/billing/webhook`.
3. Enable `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`.
4. Save the production webhook signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Confirm Stripe Checkout success redirects include `checkout=success&session_id={CHECKOUT_SESSION_ID}`.
6. Complete a test-mode checkout and confirm the webhook grants credits before checking conversion logs.

## Future Agent Rules For Ads Or Posts

- Verify account IDs in the dashboard or through a read-only API call before creating campaigns, ads, or posts.
- Require explicit user instruction before publishing anything that can spend money. The instruction must include platform, objective, budget, dates, geography, audience, landing URL, and creative/copy approval.
- Respect platform spend limits and account-level budget caps. Do not raise budgets or bid caps without explicit approval.
- Prefer drafts, paused campaigns, or scheduled posts when the user asks for setup but has not approved launch.
- Never infer regulated, sensitive, or political targeting categories. Ask for clarification when targeting could be restricted.
- After creating or updating any campaign, ad set, ad, post, creative, or asset, record the platform, account ID, object ID, status, budget, and destination URL in the handoff message.
- Do not store access tokens in code, docs, issue comments, PR descriptions, screenshots, or browser-visible configuration.
