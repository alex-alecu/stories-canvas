import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { MarketingError } from './marketingDiagnostics.js';

export interface InstagramApp { appId: string; appSecret: string; websiteUrl: string }

export const instagramOps = { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) };

// Reuse the existing server key. No additional environment setup is needed.
function tokenKey() {
  if (!config.supabaseServiceKey) throw new MarketingError('Protect credentials', 'The server database connection is unavailable.');
  return createHash('sha256').update(`instagram-marketing:${config.supabaseServiceKey}`).digest();
}

export function encryptInstagramToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptInstagramToken(token: string): string {
  try {
  const data = Buffer.from(token, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', tokenKey(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  } catch {
    throw new MarketingError('Read saved credentials', 'Saved access cannot be read. Save the app secret again, then reconnect Instagram.');
  }
}

async function request<T>(stage: string, url: string | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await instagramOps.fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new MarketingError(stage, 'Instagram did not respond within 30 seconds. Check the connection and try again.');
  }
  const body = await response.json().catch(() => { throw new MarketingError(stage, 'Instagram returned an invalid response.', { httpStatus: response.status }); }) as {
    error?: { code?: number; error_subcode?: number; message?: string; fbtrace_id?: string }; error_type?: string; error_message?: string };
  if (!response.ok || body.error || body.error_type) {
    // Use provider text only to select fixed advice. Never store or return that text.
    const hint = body.error?.message || body.error_message || '';
    const message = /redirect.?uri|redirect (?:url|address)/i.test(hint) ? 'Meta rejected the redirect address. Copy the address from Instagram setup into the Meta app.'
      : /client.?secret|app secret/i.test(hint) ? 'Meta rejected the app secret. Save the correct secret in Instagram setup.'
      : /client.?id|app id/i.test(hint) ? 'Meta rejected the app ID. Check Instagram setup.'
      : body.error?.code === 190 ? 'Instagram access is invalid or expired. Connect Instagram again.'
      : [10, 200].includes(body.error?.code ?? 0) ? 'Instagram denied this permission. Check the Meta app access and reconnect with all requested permissions.'
      : body.error?.code === 100 ? 'Instagram rejected a request value. Check the app settings, redirect address, and image requirements.'
      : response.status === 429 ? 'Instagram has reached its request limit. Try again later.'
      : 'Instagram rejected the request. Check the provider code, app settings, and account permissions.';
    throw new MarketingError(stage, message, { httpStatus: response.status,
      providerCode: [body.error?.code, body.error?.error_subcode].filter(value => typeof value === 'number').join('/') || undefined,
      providerTraceId: typeof body.error?.fbtrace_id === 'string' && /^[\w-]{1,100}$/.test(body.error.fbtrace_id) ? body.error.fbtrace_id : undefined });
  }
  return body as T;
}

export function instagramRedirectUri(websiteUrl: string) {
  return `${websiteUrl.replace(/\/$/, '')}/admin/marketing`;
}

export async function instagramGraph<T>(path: string, token: string, params: Record<string, string> = {}, method = 'GET', stage = 'Instagram request'): Promise<T> {
  const url = new URL(`https://graph.instagram.com/v26.0/${path}`);
  if (method === 'GET') url.search = new URLSearchParams(params).toString();
  return request<T>(stage, url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(method === 'POST' ? { body: new URLSearchParams(params) } : {}),
  });
}

export async function exchangeInstagramCode(code: string, app: InstagramApp) {
  type ShortToken = { access_token: string; permissions?: string | string[] };
  const response = await request<ShortToken & { data?: ShortToken[] }>('Exchange authorization code', 'https://api.instagram.com/oauth/access_token', {
    method: 'POST', body: new URLSearchParams({
      client_id: app.appId, client_secret: app.appSecret,
      grant_type: 'authorization_code', redirect_uri: instagramRedirectUri(app.websiteUrl), code,
    }),
  });
  const short = response.data?.[0] ?? response;
  if (!short.access_token) throw new MarketingError('Exchange authorization code', 'Instagram did not grant access. Connect again.');
  const url = new URL('https://graph.instagram.com/access_token');
  url.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: app.appSecret, access_token: short.access_token }).toString();
  const token = await request<{ access_token: string; expires_in: number }>('Extend Instagram access', url);
  const profile = await instagramGraph<{ user_id: string; username: string; account_type: string }>('me', token.access_token,
    { fields: 'user_id,username,account_type' }, 'GET', 'Check Instagram account');
  if (!['BUSINESS', 'MEDIA_CREATOR'].includes(profile.account_type) || !/^\d+$/.test(profile.user_id) || !token.access_token || !(token.expires_in > 0)) {
    throw new MarketingError('Check Instagram account', 'Connect an Instagram professional account to publish Stories.');
  }
  // Fail during connection if the account cannot grant Story insights.
  const granted = short.permissions ? (Array.isArray(short.permissions) ? short.permissions : short.permissions.split(','))
    : (await instagramGraph<{ data: { permission: string; status: string }[] }>('me/permissions', token.access_token, {}, 'GET', 'Check Instagram permissions'))
      .data?.filter(item => item.status === 'granted').map(item => item.permission);
  for (const scope of INSTAGRAM_SCOPES) {
    if (!granted?.includes(scope)) {
      throw new MarketingError('Check Instagram permissions', `Instagram did not grant ${scope}. Connect again and allow this permission.`);
    }
  }
  return { token, profile };
}

export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'];

export async function refreshInstagramToken(token: string) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token }).toString();
  const result = await request<{ access_token: string; expires_in: number }>('Refresh Instagram access', url);
  if (!result.access_token || !(result.expires_in > 0)) throw new MarketingError('Refresh Instagram access', 'Connect Instagram again to renew access.');
  return result;
}
