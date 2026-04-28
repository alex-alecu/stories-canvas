# Stories Canvas

Generate illustrated and narrated stories for children with the help of AI.

## Billing Model

The public gallery stays free and ad-free. Billing only applies when a signed-in user creates a new story.

- `Fast` story: `1` credit
- `Pro` story: `2` credits
- `Pro + Audio` story: `3` credits
- Story packs: `5`, `12`, and `20` credits

Credits do not expire. Pack pricing and descriptions are managed from the in-app admin panel, not the Stripe dashboard.

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

If the user selected the `Pro + Audio` mode, each page's text is sent to a text-to-speech model one page at a time. The app offers three family-role narrator options backed by the curated Romanian shortlist: Grandpa (Jora Slobod), Dad (Serban Popescu), and Mom (Corina Capuccina). All three use the same narration-oriented speech settings, and the resulting audio clips are saved so the story can be played back like an audiobook.

Narration is only available at story creation time in this version. Users cannot buy or add narration later to an existing story.

## Admin Features

Users with the `admin` role can open `/admin` to:

- edit live pack names, descriptions, prices, and active state
- search users and inspect their purchase and credit history
- grant free credits with an audit note
- monitor mirrored Stripe webhook events

The first admin accounts are bootstrapped from `ADMIN_BOOTSTRAP_EMAILS`.

## Environment

Copy `.env.example` to `.env` and fill in the values you need:

- `GEMINI_API_KEY` is required
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_KEY` enable auth, storage, billing, and admin APIs
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` enable Checkout and webhook fulfillment
- `APP_BASE_URL` should match the browser origin used for local or deployed checkout redirects
- `ADMIN_BOOTSTRAP_EMAILS` seeds initial admins as a comma-separated list

Apply the Supabase migrations before testing billing:

```bash
npm run migrate:railway
```

## Local Stripe Flow

1. Add your Stripe sandbox keys to `.env`.
2. Start the app with `npm run dev`.
3. Forward Stripe events to the local webhook endpoint:

```bash
stripe listen --forward-to http://localhost:3001/api/billing/webhook
```

4. Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Buy a pack from `/billing` and confirm the credits appear in the UI and in `/admin`.

## Manual Smoke Checks

- Buy each pack and verify it grants `5`, `12`, or `20` credits exactly once.
- Create `Fast`, `Pro`, and `Pro + Audio` stories and verify the debit is `1`, `2`, and `3` credits.
- Cancel or fail a story before the first illustration completes and verify the credits are refunded.
- Confirm completed stories with at least one finished illustration do not refund credits on cancel.
- Verify `/api/stories/:id/generate-audio` charges 1 credit and adds narration for completed owner stories without audio.
