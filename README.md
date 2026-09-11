# Stories Canvas

Generate illustrated and narrated stories for children with the help of AI.

## Billing Model

The public gallery is free. Accounts hold prepaid funds in US dollars. A new story requires a balance of at least $10.

- Users select one of six text models, a thinking level, and optional narration.
- Each OpenRouter response supplies its actual USD cost. The app stores the response ID, model, thinking level, token usage, and cost.
- Images also use OpenRouter's reported request cost. Only ElevenLabs narration uses the saved price catalog. Generation stops if a required cost is unavailable.
- Each request creates one cost entry and one wallet debit in the same database transaction. Duplicate event IDs cannot charge twice.
- Costs and wallet amounts use integer microdollars: **$1 = 1,000,000 microdollars**. The app has no added generation markup. Provider funding and Stripe payment fees are operating costs.
- Completed request costs still apply after a later failure or cancellation. Requests already in progress can take a balance below zero. Further generation then stops.
- Initial funding options are $10, $25, and $50. Funds do not expire. Admins can change funding amounts or grant USD amounts.
- Existing credits convert at **1 credit = $1**. The old balance is saved in `legacy_credits_converted` with a conversion date. Existing credit API field names remain for compatibility; their values mean USD.

The database stores wallet balances, ledger entries, funding amounts, purchase credits, and historical story charges in `BIGINT` fields with `_usd_micros` names. Transaction functions use integer microdollars. The server converts to dollars at the API boundary. The migration converts existing decimal-dollar amounts once. Stripe amounts retain their original currency and minor units. Original provider records, legacy credit counts, and precise per-token rates remain available for audit.

## Text Provider

Text generation uses [OpenRouter usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting), [structured output](https://openrouter.ai/docs/guides/features/structured-outputs), and [thinking levels](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Tool calls, web search, and image input remain supported.

The six models are defined in `shared/textModels.ts`. The default is Gemini 3.8 Flash. The selected model and thinking level apply to all text steps for a story, including reviews and later edits. Models were checked against the live catalog on 2026-09-06.

The model list includes Gemini 3.8 Flash, GPT-6 Astra, Claude Fable 5.1, Claude Opus 5, Qwen 3.8 Max, and Grok 4.6. Price levels and input/output rates appear only inside the open model dropdown, including on touch screens. The display snapshot comes from the [OpenRouter model catalog](https://openrouter.ai/api/v1/models), checked on 2026-09-06. Refresh it when the model list or provider prices change. Price levels compare one million input plus one million output tokens: `$` is up to $10, `$$` is up to $40, and `$$$` is above $40. Long-context rates appear in the price details. These display rates do not set wallet charges; the provider response cost does.

Story Tools shows the story's saved text model and thinking level. Older stories use their saved scenario model when available. Missing settings show as "Not recorded".

Fable supports tools but does not list `tool_choice` on its OpenRouter endpoints. Its agent requests omit that parameter. The writer must submit a complete script through the validation tool before the app accepts it.

Saved stories can still use their original GPT-5.6 Sol or Claude Sonnet 5 settings. These models are not available for new stories.

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway/pricing) was also checked. It has no token markup or platform fee. OpenRouter was selected for its common thinking control, provider routing, and response cost field. The app uses price-based provider routing within the selected model.

## How Story Generation Works

When a user submits a story idea, the app runs through four steps in order: writing the story, drawing character references, drawing each page, and recording narration.

### Step 1 — Write the Story

The official [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/running-agents) runs the writer through its Chat Completions model with OpenRouter. The SDK handles the run loop, tool calls, and cancellation. The app supplies one submission tool. It checks the full script and returns validation errors for correction. A run stops after at most ten model turns. Confirmed HTTP 429 and 5xx failures can receive two retries. Lost connections and failed cost records stop the run. The old custom runtime and delegation protocol have been removed.

The writer receives the idea, language, age, and art style. It returns a title, character definitions, and pages with narration text and image descriptions. The sequence is **write → review → fix → illustrate**. One review checks the valid script. If it reports issues or low scores, the editor receives the complete script and all findings for one correction. The corrected script must pass format and page validation. If needed, the writer receives the exact validation errors for one repair attempt. The app then continues to illustration without another quality review. Review findings do not cause a failed story. This stage uses at most three generation calls before HTTP retries: one review, one correction, and one validation repair. Provider errors, invalid review data, invalid corrected scripts, failed cost records, and user cancellation still stop generation. Progress messages show the review and correction steps. All requests retain usage records and the cancellation signal. OpenAI trace export is disabled; request usage stays in the app's own cost records.

The model is limited to a maximum of 3 characters and 20 pages.

To test only text with real provider calls, set `OPENROUTER_API_KEY` in the shell or `.env`, then run `npm run test:text:live`. The command tests four briefs with Gemini Flash, GPT-6 Astra, and Claude Fable. It saves scripts, per-request usage, costs, and a summary under `artifacts/text-smoke/`. It does not call image or audio generation, update user balances, or send alerts. Each case stops after 12 minutes or after recorded costs reach $2. A request already in progress can exceed that cost limit.

To repeat one case, use `npm run test:text:live -- --case=romanian-retelling --budget=6 --minutes=20`. These options change only the local test limits. The command also saves text request and response bodies for validation checks. It never saves authorization headers.

To test the reported "Sarea în bucate" request, use `npm run test:text:live -- --case=romanian-sarea-in-bucate --budget=10 --minutes=40`. This case uses Romanian, age 5, GPT-6 Astra, and high thinking. It is excluded from the default four-case run. It uses the current text pipeline and provider configuration, with production storage, balance updates, images, audio, and alerts disabled.

Text requests allow up to 15 minutes for response headers. User cancellation still stops the active request. A timeout with an unknown cost does not trigger an automatic retry. The live test saves response bodies in the background so logging does not extend the connection timeout over the full response body.

To test the reported "Capra cu trei iezi" request, use `npm run test:text:live -- --case=romanian-capra-cu-trei-iezi --budget=2 --minutes=15`. This case uses Romanian, age 5, Gemini 3.8 Flash, and high thinking. It is excluded from the default run and uses the same text-only test safeguards.

Text requests allow up to 128,000 completion tokens where the selected model supports them. Gemini models use their 65,536-token maximum. The allowance is shared between reasoning and visible output for each response. These are output limits; the model's context window is separate. A content block or response length limit stops the request without an automatic retry. The story owner can see the saved error after a page reload.

If generation fails before a script is saved, the story owner can select **Retry** on the story page. The retry starts with the saved request, language, age, style, model, thinking level, and audio settings. It keeps the story ID and records new usage as retry costs. Access, balance, and active-generation limits still apply. Deploying a fix does not automatically retry failed stories.

### Step 2 — Draw Character Reference Sheets

Before any scene is drawn, the app generates a **character reference sheet** for each character. This is a single image that shows the character from multiple angles (front, side, and back) along with a close-up of their face and a color palette.

These sheets are the **single source of truth** for what each character looks like. Every scene image generated later will receive these sheets as visual input so the image model knows exactly how to draw that character — same colors, same proportions, same outfit — on every page.

### Step 3 — Draw Scene Images

Pages are drawn one at a time, in order. For each page, the image model receives:

1. **Character reference sheets** — for every character that appears in that scene. These always come first and are treated as the highest authority on character appearance.
2. **The previous scene image** — used for **style and environment continuity** so the art style, lighting, furniture, objects, and spatial layout stay consistent between consecutive pages.

The text prompt that accompanies these reference images re-describes each character's full appearance, instructs the model to treat the character sheets as absolute truth (overriding any drift visible in earlier scenes), and asks for a richly detailed background. If a generation is rejected by a safety filter, the prompt is automatically softened and retried.

Before any image request is sent to a provider, the app also sanitizes the outbound prompt: branded animation-style references are originalized and exact character names are replaced with neutral aliases. This keeps the stored story content unchanged while reducing provider policy blocks.

Images use the [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation). Select an image model when you create a story or change a page image. The app saves the selected model for later requests. The default is Gemini 3.1 Flash Image.

The list contains Fast and Pro options from Google, OpenAI, ByteDance Seed, and Black Forest Labs. The model IDs and request limits were checked against the [OpenRouter image catalog](https://openrouter.ai/api/v1/images/models) on 2026-09-11. FLUX.2 Klein 4B provides an open-weight option.

Requests use the 4:3 format and save PNG files. Google and Seedream Pro use 1K resolution. Seedream Lite uses 2K. OpenAI and FLUX use their default resolution. Character references have priority over scene references when the model limits the number of input images. Cancellation stops active requests and further retries.

This layered approach — character sheets for identity, previous scene for style and environment — is what keeps the story visually consistent from the first page to the last.

### Step 4 — Record Narration

The app sends each page's text to the selected speech model and saves MP3 audio. Select the model when you create a story, add narration, or change a page's narration. The app saves the model and voice before generation starts. Retries use these saved settings.

ElevenLabs remains the default. It keeps the existing family-role voices. The four OpenRouter options are Gemini 3.1 Flash TTS Preview, MAI-Voice-2, MiniMax Speech 2.8 HD, and Kokoro 82M. OpenRouter models use their own voice lists. The models were checked against the [OpenRouter speech catalog](https://openrouter.ai/api/v1/models?output_modalities=speech) on 2026-09-11.

The selector shows language limits. Google and MiniMax include Romanian and English. MAI-Voice-2 is limited to the English, Spanish, French, and German voices listed by OpenRouter. Kokoro supports English, Spanish, French, Hindi, Italian, Japanese, Portuguese, and Chinese. It does not support Romanian.

OpenRouter speech uses the [Speech API](https://openrouter.ai/docs/guides/overview/multimodal/tts). Its MP3 response includes a generation ID. The app uses that ID to read the actual request cost. A missing cost stops further OpenRouter audio requests. ElevenLabs can continue without a price record; any configured ElevenLabs estimate remains in use. ElevenLabs costs are separate from the displayed OpenRouter total.

## Admin Features

Users with the `admin` role can open `/admin` to:

- edit live pack names, descriptions, prices, and active state
- search users and inspect their purchase and credit history
- grant USD funds with an audit note
- monitor mirrored Stripe webhook events

The first admin accounts are bootstrapped from `ADMIN_BOOTSTRAP_EMAILS`.

## Environment

Copy `.env.example` to `.env` and fill in the values you need:

- `OPENROUTER_API_KEY` enables text, images, speech, and reviews. Keep it on the server. Direct OpenAI and Gemini keys are no longer used.
- Image models are selected in the app. `IMAGE_MODEL` and `IMAGE_MODEL_PRO` are no longer used. Saved Gemini model IDs remain supported for existing stories.
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
2. Apply all migrations, including `20260906075743_openrouter_usd_wallet.sql`, `20260906100130_openrouter_image_usage.sql`, `20260907150817_wallet_microdollars.sql`, and `20260911072001_openrouter_audio_usage.sql`.
3. Set `OPENROUTER_API_KEY` and deploy the application with the migrations. Remove the old Gemini key. Existing ElevenLabs, Supabase, and Stripe keys remain in use.
4. Remove old `STORY_PACK_*` environment defaults. USD funding amounts are now set in the admin screen.
5. Verify a Stripe sandbox purchase. A completed USD Checkout grants the exact amount in its signed snapshot, once. Old Checkout sessions retain their legacy credit value at the 1:1 conversion rate.
6. Confirm $9.99 blocks a new story and $10 allows it. Select a different model and thinking level. Check the saved settings, request cost, wallet debit, and updated balance after generation.

The balance history links each cost to its story. Text costs come from the response, with a generation-ID lookup if the inline cost is absent. If no cost is available, an incomplete event is saved and generation stops for account support review.

Image costs use the same response-cost lookup. Paid responses are never repeated because of a cost-recording or image-decoding failure. A lost connection saves an unknown cost and stops the request without a retry. The direct Google SDK, Gemini image service, safety-setting overrides, old live text/image price fetchers, and fixed-credit calculations have been removed. Historical usage rows and their price snapshots remain available for reports.
