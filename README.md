# Stories Canvas

Generate illustrated and narrated stories for children with the help of AI.

## Billing Model

The public gallery is free. Accounts hold prepaid funds in US dollars. A new story requires a balance of at least $10.

- Users select one of six text models, a thinking level, and optional narration.
- Each OpenRouter response supplies its actual USD cost. The app stores the response ID, model, thinking level, token usage, and cost.
- Image and audio costs use the saved model price catalog. Generation stops if the required price is unavailable.
- Each request creates one cost entry and one wallet debit in the same database transaction. Duplicate event IDs cannot charge twice.
- Costs use six decimal places. The app has no added generation markup. Provider funding and Stripe payment fees are operating costs.
- Completed request costs still apply after a later failure or cancellation. Requests already in progress can take a balance below zero. Further generation then stops.
- Initial funding options are $10, $25, and $50. Funds do not expire. Admins can change funding amounts or grant USD amounts.
- Existing credits convert at **1 credit = $1**. The old balance is saved in `legacy_credits_converted` with a conversion date. Existing credit column names remain for API compatibility; their values now mean USD.

## Text Provider

Text generation uses [OpenRouter usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting), [structured output](https://openrouter.ai/docs/guides/features/structured-outputs), and [thinking levels](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Tool calls, web search, and image input remain supported.

The six models are defined in `shared/textModels.ts`. The default is Gemini 3.8 Flash. The selected model and thinking level apply to all text steps for a story, including reviews and later edits. Models were checked against the live catalog on 2026-09-06.

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway/pricing) was also checked. It has no token markup or platform fee. OpenRouter was selected for its common thinking control, provider routing, and response cost field. The app uses price-based provider routing within the selected model.

## How Story Generation Works

When a user submits a story idea, the app runs through four steps in order: writing the story, drawing character references, drawing each page, and recording narration.

### Step 1 — Write the Story

A large language model receives the user's idea along with the chosen language, target age, and art style. It returns a structured story: a title, a list of characters (each with a detailed appearance and clothing description), and a sequence of pages. Each page has its narration text and an image description that the model wrote specifically for that scene.

The model is limited to a maximum of 3 characters and 20 pages.

### Step 2 — Draw Character Reference Sheets

Before any scene is drawn, the app generates a **character reference sheet** for each character. This is a single image that shows the character from multiple angles (front, side, and back) along with a close-up of their face and a color palette.

These sheets are the **single source of truth** for what each character looks like. Every scene image generated later will receive these sheets as visual input so the image model knows exactly how to draw that character — same colors, same proportions, same outfit — on every page.

### Step 3 — Draw Scene Images

Pages are drawn one at a time, in order. For each page, the image model receives:

1. **Character reference sheets** — for every character that appears in that scene. These always come first and are treated as the highest authority on character appearance.
2. **The previous scene image** — used for **style and environment continuity** so the art style, lighting, furniture, objects, and spatial layout stay consistent between consecutive pages.

The text prompt that accompanies these reference images re-describes each character's full appearance, instructs the model to treat the character sheets as absolute truth (overriding any drift visible in earlier scenes), and asks for a richly detailed background. If a generation is rejected by a safety filter, the prompt is automatically softened and retried.

Before any image request is sent to a provider, the app also sanitizes the outbound prompt: branded animation-style references are originalized and exact character names are replaced with neutral aliases. This keeps the stored story content unchanged while reducing provider policy blocks.

If the current Google-backed image path remains too restrictive for some prompts, the next providers to evaluate are OpenAI GPT Image, Black Forest Labs FLUX, and Ideogram.

This layered approach — character sheets for identity, previous scene for style and environment — is what keeps the story visually consistent from the first page to the last.

### Step 4 — Record Narration

If the user selected narration, each page's text is sent to a text-to-speech model one page at a time. The app offers three family-role narrator options backed by the curated Romanian shortlist: Grandpa (Jora Slobod), Dad (Serban Popescu), and Mom (Corina Capuccina). All three use the same narration-oriented speech settings, and the resulting audio clips are saved so the story can be played back like an audiobook.

Narration is only available at story creation time in this version. Users cannot buy or add narration later to an existing story.

## Admin Features

Users with the `admin` role can open `/admin` to:

- edit live pack names, descriptions, prices, and active state
- search users and inspect their purchase and credit history
- grant USD funds with an audit note
- monitor mirrored Stripe webhook events

The first admin accounts are bootstrapped from `ADMIN_BOOTSTRAP_EMAILS`.

## Environment

Copy `.env.example` to `.env` and fill in the values you need:

- `OPENROUTER_API_KEY` enables all text generation and text review. Keep it on the server. Direct OpenAI credentials are no longer used.
- `GEMINI_API_KEY` is required for image generation. `IMAGE_MODEL` and `IMAGE_MODEL_PRO` are optional Gemini image model overrides.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_KEY` enable auth, storage, billing, and admin APIs
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` enable Checkout and webhook fulfillment
- `APP_BASE_URL` should match the browser origin used for local or deployed checkout redirects
- `SLACK_WEBHOOK_URL` enables operational alerts; leave it empty for local tests/dev unless you want real Slack posts
- `ADMIN_BOOTSTRAP_EMAILS` seeds initial admins as a comma-separated list
- `APP_DEFAULT_LANGUAGE` sets the deployment language used by the client, server fallbacks, SEO, legal/footer copy, and localized blog content. Complete blog/legal content currently exists for `ro` and `en`.
- `APP_SITE_NAME`, `APP_SITE_SHORT_NAME`, and `APP_SITE_DESCRIPTION` customize browser metadata, manifest metadata, and visible text branding.
- `VITE_DEFAULT_LANGUAGE` and `SEO_*` are still supported as backward-compatible overrides, but new deployments should prefer `APP_DEFAULT_LANGUAGE` and `APP_SITE_*`.

Apply the Supabase migrations before testing billing:

```bash
npm run migrate:railway
```

## Local Stripe Flow

1. Add your Stripe sandbox keys to `.env`.
2. Start the app with `npm run dev`.
3. Forward Stripe Checkout events to the local webhook endpoint:

```bash
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired \
  --forward-to http://localhost:3001/api/billing/webhook
```

4. Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Add funds from `/billing` and confirm the dollar balance in the UI and in `/admin`.

## Deployment and Checks

1. Stop active generation before the cutover. Back up the database.
2. Apply all migrations, including `20260906075743_openrouter_usd_wallet.sql`.
3. Set `OPENROUTER_API_KEY` and deploy the application with the migration. Existing Gemini, ElevenLabs, Supabase, and Stripe keys remain in use.
4. Remove old `STORY_PACK_*` environment defaults. USD funding amounts are now set in the admin screen.
5. Verify a Stripe sandbox purchase. A completed USD Checkout grants the exact amount in its signed snapshot, once. Old Checkout sessions retain their legacy credit value at the 1:1 conversion rate.
6. Confirm $9.99 blocks a new story and $10 allows it. Select a different model and thinking level. Check the saved settings, request cost, wallet debit, and updated balance after generation.

The balance history links each cost to its story. Text costs come from the response, with a generation-ID lookup if the inline cost is absent. If no cost is available, an incomplete event is saved and generation stops for account support review.
