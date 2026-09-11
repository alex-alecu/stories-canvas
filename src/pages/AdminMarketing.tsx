import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminShell } from '../components/admin/AdminShell';
import { useAuth } from '../contexts/AuthContext';
import { useBillingOverview } from '../hooks/useBilling';
import { getAuthHeaders } from '../lib/authHeaders';
import type { MarketingOverview } from '../../shared/marketing';

async function request<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/marketing${path}`, { method,
    headers: { ...await getAuthHeaders(), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).catch(() => { throw new Error('Cannot reach the server. Check the connection and try again.'); });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error([data?.error || `The server returned HTTP ${response.status}. Try again.`,
    data?.diagnostic?.providerCode && `Provider code: ${data.diagnostic.providerCode}`,
    data?.diagnostic?.httpStatus && `Provider HTTP: ${data.diagnostic.httpStatus}`,
    data?.diagnostic?.runId && `Run: ${data.diagnostic.runId}`].filter(Boolean).join(' · '));
  return data;
}

const button = 'rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50';
const panel = 'rounded-3xl border border-primary-100 bg-white p-5 text-gray-900 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated dark:text-gray-100 md:p-6';
const input = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-surface-dark';

export default function AdminMarketing() {
  const { user } = useAuth();
  const { data: access } = useBillingOverview(!!user);
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const callbackStarted = useRef(false);
  const [hour, setHour] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [appSecret, setAppSecret] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['admin', 'marketing'],
    queryFn: () => request<MarketingOverview>(), enabled: !!access?.isAdmin, refetchInterval: 3_000 });
  const action = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method?: string; body?: unknown }) => request<MarketingOverview>(path, method || 'POST', body),
    onMutate: () => setNotice(''),
    onSuccess: value => { client.setQueryData(['admin', 'marketing'], value); setNotice('Changes saved.'); },
    onSettled: () => { void client.invalidateQueries({ queryKey: ['admin', 'marketing'] }); },
  });
  const connect = useMutation({ mutationFn: () => request<{ url: string }>('/connect', 'POST'),
    onMutate: () => { setNotice(''); action.reset(); },
    onSettled: () => { void client.invalidateQueries({ queryKey: ['admin', 'marketing'] }); },
    onSuccess: result => window.location.assign(result.url) });
  useEffect(() => {
    if (!access?.isAdmin || callbackStarted.current) return;
    const code = params.get('code');
    const state = params.get('state');
    if (!code && !params.has('error')) return;
    callbackStarted.current = true;
    const next = new URLSearchParams(params);
    ['code', 'state', 'error', 'error_reason', 'error_description'].forEach(key => next.delete(key));
    setParams(next, { replace: true });
    if (code && state) {
      action.mutate({ path: '/callback', body: { code, state } }, { onSuccess: () => setNotice('Instagram is connected. Set the time and enable daily posts.') });
    } else action.mutate({ path: '/callback', body: { error: 'access_denied' } });
  }, [access?.isAdmin, params, setParams, action.mutate]);
  const busy = action.isPending || connect.isPending;
  const failure = action.error || connect.error || error;
  const setupDirty = appId !== null || websiteUrl !== null || !!appSecret;

  return <AdminShell>
    <section className={panel}>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Marketing</h2>
      <p className="mt-2 text-gray-600 dark:text-gray-300">Post one public story to Instagram each day. AI uses recent results to select the story.</p>
      {isLoading && <p className="mt-4" role="status">Loading Marketing...</p>}
      {failure && <p role="alert" className="mt-4 break-words text-red-600 dark:text-red-300">{failure.message}</p>}
      {notice && <p role="status" className="mt-4 text-primary-700 dark:text-primary-200">{notice}</p>}
      {data && <form className="mt-6 space-y-4 border-b border-gray-100 pb-6 dark:border-gray-800" onSubmit={event => {
        event.preventDefault();
        action.mutate({ path: '/setup', method: 'PUT', body: {
          appId: appId ?? data.setup.appId,
          ...(appSecret ? { appSecret } : {}),
          websiteUrl: websiteUrl ?? (data.setup.websiteUrl || (window.location.protocol === 'https:' ? window.location.origin : '')),
        } }, { onSuccess: () => { setAppSecret(''); setAppId(null); setWebsiteUrl(null); setNotice('Instagram setup saved. Connect the account next.'); } });
      }}>
        <h3 className="text-lg font-bold">1. Instagram app setup</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">Open your <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="text-primary-600 underline dark:text-primary-300">Meta app</a>, add Instagram API with Instagram Login, and copy its Instagram app ID and app secret here. Meta requires this app registration.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <label>Instagram app ID<input className={input} inputMode="numeric" required value={appId ?? data.setup.appId} onChange={event => setAppId(event.target.value)} /></label>
          <label>Instagram app secret<input className={input} type="password" autoComplete="new-password" required={!data.setup.hasAppSecret}
            value={appSecret} onChange={event => setAppSecret(event.target.value)} placeholder={data.setup.hasAppSecret ? 'Saved. Leave empty to keep it.' : 'Enter app secret'} /></label>
          <label>Public website address<input className={input} type="url" required placeholder="https://your-website.com"
            value={websiteUrl ?? (data.setup.websiteUrl || (window.location.protocol === 'https:' ? window.location.origin : ''))} onChange={event => setWebsiteUrl(event.target.value)} /></label>
        </div>
        <button type="submit" className={button} disabled={busy}>Save Instagram setup</button>
        <p className="text-sm text-gray-500 dark:text-gray-400">A change to this setup stops daily posts. Connect the account again after the change.</p>
        {data.setup.redirectUri && <label className="block text-sm">Copy this exact redirect address into the Instagram Login settings in Meta:
          <input className={`${input} font-mono`} readOnly value={data.setup.redirectUri} onFocus={event => event.target.select()} />
        </label>}
      </form>}
      {data && <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-lg font-bold">2. Connect Instagram</h3>
          <p>{data.username ? `@${data.username}` : 'No account connected.'} {data.username && (data.connected ? '(Connected)' : '(Disconnected)')}</p>
          {data.tokenExpiresAt && <p className="text-sm text-gray-500 dark:text-gray-400">Access expires: {new Date(data.tokenExpiresAt).toLocaleString()}</p>}
          {(!data.configured || setupDirty) && <p className="text-sm text-amber-700 dark:text-amber-300">Save the app setup above before you connect.</p>}
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy || !data.configured || setupDirty} onClick={() => connect.mutate()}>{data.connected ? 'Reconnect Instagram' : 'Connect Instagram'}</button>
            {data.connected && <button className={button} disabled={busy} onClick={() => action.mutate({ path: '/disconnect' })}>Disconnect</button>}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Add your professional Instagram account to the Meta app. Allow basic access, publishing, and insights when you connect.</p>
        </div>
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          action.mutate({ path: '', method: 'PATCH', body: { enabled: enabled ?? data.enabled, hourUtc: hour ?? data.hourUtc } },
            { onSuccess: () => { setHour(null); setEnabled(null); } });
        }}>
          <h3 className="text-lg font-bold">3. Daily posts</h3>
          <label className="flex items-center gap-2"><input type="checkbox" checked={enabled ?? data.enabled}
            disabled={busy || !data.connected} onChange={event => setEnabled(event.target.checked)} />Enable daily posts</label>
          <label className="block">Daily time (UTC)
            <select value={hour ?? data.hourUtc} onChange={event => setHour(Number(event.target.value))}
              className="ml-3 rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-surface-dark">
              {Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, '0')}:00</option>)}
            </select>
          </label>
          <p className="text-sm text-gray-500 dark:text-gray-400">The server posts at or after this time. It must remain online.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={button} disabled={busy || !data.configured}>Save schedule</button>
            <button type="button" className={button} disabled={busy || !data.connected || data.posts.some(p => p.post_date === new Date().toISOString().slice(0, 10) && ['published', 'publishing', 'uncertain', 'skipped'].includes(p.status))}
              onClick={() => action.mutate({ path: '/run' }, { onSuccess: () => setNotice('Check the activity log and post history for today\'s result.') })}>Publish today</button>
          </div>
          {busy && <p role="status" className="text-sm">Request in progress...</p>}
        </form>
      </div>}
    </section>
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-bold">Activity log</h3>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={errorsOnly} onChange={event => setErrorsOnly(event.target.checked)} />Errors only</label>
          <button className={button} onClick={() => void refetch()}>Refresh log</button>
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Latest 100 entries. The log updates every 3 seconds. Use the run ID to find the same entry in the server logs.</p>
      {!data?.logs.length && <p className="mt-4 text-sm">No activity yet. Start with Instagram app setup.</p>}
      <ol className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto" aria-label="Marketing activity">
        {data?.logs.filter(log => !errorsOnly || log.status === 'failed').map(log => <li key={log.id} className="border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <time className="text-gray-500 dark:text-gray-400" dateTime={log.created_at}>{new Date(log.created_at).toLocaleString()}</time>
            <strong>{log.stage}</strong>
            <span className={log.status === 'failed' ? 'font-semibold text-red-600 dark:text-red-300' : log.status === 'succeeded' ? 'text-green-700 dark:text-green-300' : 'text-primary-700 dark:text-primary-300'}>{log.status}</span>
          </div>
          <p className="mt-1 break-words">{log.message}</p>
          <p className="mt-1 break-all text-gray-500 dark:text-gray-400">Run: {log.run_id}
            {log.details.httpStatus && ` · HTTP ${log.details.httpStatus}`}{log.details.providerCode && ` · Provider code: ${log.details.providerCode}`}
            {log.details.providerTraceId && ` · Meta trace: ${log.details.providerTraceId}`}
          </p>
          {log.post_id && <a className="text-primary-600 underline dark:text-primary-300" href={`#post-${log.post_id}`}>View post</a>}
        </li>)}
      </ol>
    </section>
    <section className={panel}>
      <h3 className="text-xl font-bold">Post history</h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">AI selects from up to 20 stories. Stories used in the past 14 days are excluded. Results are saved each hour.</p>
      {!data?.posts.length && <p className="mt-4 text-gray-500 dark:text-gray-400">No daily posts yet.</p>}
      <div className="mt-4 space-y-4">{data?.posts.map(post => <article key={post.id} id={`post-${post.id}`} className="flex flex-col gap-4 border-t border-gray-100 pt-4 dark:border-gray-800 sm:flex-row">
        {post.image_url && <a href={post.image_url} target="_blank" rel="noreferrer" className="shrink-0"><img src={post.image_url} alt="Published Story image" className="w-24 rounded-lg" loading="lazy" /></a>}
        <div className="min-w-0 space-y-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">{post.post_date} UTC · {post.status} · Attempt {post.attempts}/3</p>
          {post.story && <p className="font-semibold">{post.story_id ? <Link className="text-primary-600 hover:underline dark:text-primary-300" to={`/story/${post.story_id}`}>{post.story.title}</Link> : post.story.title}</p>}
          {post.reason && <p className="text-sm">{post.reason}</p>}
          {post.error && <p className="text-sm text-red-600 dark:text-red-300">{post.error}</p>}
          {post.status === 'failed' && <p className="text-sm">The server can retry after 15 minutes, up to three attempts per day.</p>}
          {post.status === 'published' && <p className="text-sm">Reach: {post.insights?.reach ?? 'Unavailable'} · Views: {post.insights?.views ?? 'Unavailable'}</p>}
          {post.insights_at && <p className="text-sm text-gray-500 dark:text-gray-400">Results checked: {new Date(post.insights_at).toLocaleString()}</p>}
          {post.insights_error && <p className="text-sm text-gray-500 dark:text-gray-400">{post.insights_error}</p>}
        </div>
      </article>)}</div>
    </section>
  </AdminShell>;
}
