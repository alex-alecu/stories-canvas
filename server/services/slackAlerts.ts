const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/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';
const SLACK_TIMEOUT_MS = 2_500;
const MAX_FIELD_LENGTH = 280;
const MAX_MESSAGE_LENGTH = 500;

type SlackText = {
  type: 'mrkdwn' | 'plain_text';
  text: string;
};

type SlackBlock =
  | {
      type: 'section';
      text?: SlackText;
      fields?: SlackText[];
    }
  | {
      type: 'context';
      elements: SlackText[];
    };

type SlackPayload = {
  text: string;
  blocks: SlackBlock[];
};

export type StoryBlockAlertKind =
  | 'insufficient_credits'
  | 'generation_slot_limit'
  | 'safety_block'
  | 'pipeline_failure'
  | 'provider_block'
  | 'service_unavailable';

export interface StoryBlockAlertParams {
  blockType: StoryBlockAlertKind;
  action: string;
  message: string;
  userId?: string;
  userEmail?: string;
  storyId?: string;
  storyUrl?: string;
  reasonCode?: string;
  requiredCredits?: number;
  availableCredits?: number;
  pageNumber?: number;
  failedPages?: number[];
  activeGenerations?: number;
  maxActiveGenerations?: number;
  retryAfterSeconds?: number;
  error?: unknown;
}

export type PaymentAlertType = 'checkout_created' | 'payment_fulfilled';

export interface PaymentAlertParams {
  type: PaymentAlertType;
  userId: string;
  email?: string;
  offerSlug: string;
  amountMinor: number;
  currency: string;
  credits?: number;
  availableCredits?: number | null;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  stripeCustomerId?: string;
  purchaseId?: string;
}

function escapeSlackText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk_(?:live|test)_[A-Za-z0-9_]+/g, 'sk_[redacted]')
    .replace(/pk_(?:live|test)_[A-Za-z0-9_]+/g, 'pk_[redacted]')
    .replace(/whsec_[A-Za-z0-9_]+/g, 'whsec_[redacted]')
    .replace(/https:\/\/hooks\.slack\.com\/services\/\S+/g, '[slack webhook]');
}

function compactText(value: unknown, maxLength = MAX_FIELD_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === 'string' ? value : String(value);
  const compacted = redactSensitiveText(raw).replace(/\s+/g, ' ').trim();
  if (!compacted) return undefined;
  return compacted.length > maxLength ? `${compacted.slice(0, Math.max(0, maxLength - 3))}...` : compacted;
}

function formatError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return compactText(error.message, MAX_MESSAGE_LENGTH);
  }
  return compactText(error, MAX_MESSAGE_LENGTH);
}

function formatCredits(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMoney(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

function blockTypeLabel(type: StoryBlockAlertKind): string {
  switch (type) {
    case 'insufficient_credits':
      return 'Insufficient credits';
    case 'generation_slot_limit':
      return 'Generation slot limit';
    case 'safety_block':
      return 'Safety block';
    case 'pipeline_failure':
      return 'Pipeline failure';
    case 'provider_block':
      return 'Provider block';
    case 'service_unavailable':
      return 'Service unavailable';
  }
}

function paymentTypeLabel(type: PaymentAlertType): string {
  return type === 'checkout_created' ? 'Checkout created' : 'Payment fulfilled';
}

function field(label: string, value: unknown): SlackText | undefined {
  const compacted = compactText(value);
  if (!compacted) return undefined;
  return {
    type: 'mrkdwn',
    text: `*${escapeSlackText(label)}*\n${escapeSlackText(compacted)}`,
  };
}

function fieldsBlock(fields: Array<SlackText | undefined>): SlackBlock[] {
  const compacted = fields.filter((item): item is SlackText => Boolean(item));
  const blocks: SlackBlock[] = [];

  for (let i = 0; i < compacted.length; i += 10) {
    blocks.push({
      type: 'section',
      fields: compacted.slice(i, i + 10),
    });
  }

  return blocks;
}

async function postSlackPayload(payload: SlackPayload, timeoutMs = SLACK_TIMEOUT_MS): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const bodySummary = compactText(body, 160);
      console.error(
        `Slack alert failed: ${response.status} ${response.statusText}${bodySummary ? ` ${bodySummary}` : ''}`,
      );
    }
  } catch (error) {
    console.error('Slack alert request failed:', formatError(error) ?? 'unknown error');
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendStoryBlockAlert(params: StoryBlockAlertParams): Promise<void> {
  const title = blockTypeLabel(params.blockType);
  const message = compactText(params.message, MAX_MESSAGE_LENGTH) ?? title;
  const errorMessage = formatError(params.error);
  const failedPages = params.failedPages?.length ? params.failedPages.join(', ') : undefined;

  await postSlackPayload({
    text: `[Stories Canvas] ${title}: ${message}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stories Canvas: ${escapeSlackText(title)}*\n${escapeSlackText(message)}`,
        },
      },
      ...fieldsBlock([
        field('Action', params.action),
        field('User email', params.userEmail),
        field('User ID', params.userId),
        field('Story ID', params.storyId),
        field('Story URL', params.storyUrl),
        field('Reason code', params.reasonCode),
        field('Required credits', formatCredits(params.requiredCredits)),
        field('Available credits', formatCredits(params.availableCredits)),
        field('Page number', params.pageNumber),
        field('Failed pages', failedPages),
        field('Active generations', params.activeGenerations),
        field('Max generations', params.maxActiveGenerations),
        field('Retry after seconds', params.retryAfterSeconds),
        field('Error', errorMessage),
      ]),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Sent ${escapeSlackText(new Date().toISOString())}`,
          },
        ],
      },
    ],
  });
}

export async function sendPaymentAlert(params: PaymentAlertParams): Promise<void> {
  const title = paymentTypeLabel(params.type);

  await postSlackPayload({
    text: `[Stories Canvas] ${title}: ${params.email ?? params.userId} ${params.offerSlug}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stories Canvas: ${escapeSlackText(title)}*\n${escapeSlackText(params.email ?? params.userId)}`,
        },
      },
      ...fieldsBlock([
        field('User email', params.email),
        field('User ID', params.userId),
        field('Offer', params.offerSlug),
        field('Amount', formatMoney(params.amountMinor, params.currency)),
        field('Credits', formatCredits(params.credits)),
        field('Available credits', formatCredits(params.availableCredits ?? undefined)),
        field('Checkout session', params.stripeCheckoutSessionId),
        field('Payment intent', params.stripePaymentIntentId),
        field('Stripe customer', params.stripeCustomerId),
        field('Purchase ID', params.purchaseId),
      ]),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Sent ${escapeSlackText(new Date().toISOString())}`,
          },
        ],
      },
    ],
  });
}

export const slackAlertTestExports = {
  SLACK_WEBHOOK_URL,
  postSlackPayload,
};
