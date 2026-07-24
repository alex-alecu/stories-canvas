import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminOverview,
  AdminStorySummary,
  AdminUserDetail,
  AdminUserSummary,
  BillingCheckoutMarketingPayload,
  BillingCheckoutResponse,
  BillingHistoryResponse,
  BillingOverview,
  PaginatedResponse,
  StoryMode,
  StoryPackOffer,
} from '../types';
import { getAuthHeaders } from '../lib/authHeaders';

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(input, {
    ...init,
    headers: {
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return res.json();
}

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: ['billing', 'me'],
    queryFn: () => fetchJson<BillingOverview>('/api/billing/me'),
    enabled,
  });
}

export function useBillingHistory(enabled = true) {
  return useQuery({
    queryKey: ['billing', 'history'],
    queryFn: () => fetchJson<BillingHistoryResponse>('/api/billing/history'),
    enabled,
  });
}

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: (payload: { offerSlug: StoryPackOffer['slug'] } & BillingCheckoutMarketingPayload) => fetchJson<BillingCheckoutResponse>('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  });
}

export function useAdminOverview(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => fetchJson<AdminOverview>('/api/admin/overview'),
    enabled,
  });
}

export function useAdminUsers(params: {
  query: string;
  page: number;
  pageSize: number;
}, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => fetchJson<PaginatedResponse<AdminUserSummary>>(
      `/api/admin/users?q=${encodeURIComponent(params.query)}&page=${params.page}&size=${params.pageSize}`,
    ),
    enabled,
  });
}

export function useAdminStories(params: {
  query: string;
  type: 'all' | StoryMode;
  page: number;
  pageSize: number;
}, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'stories', params],
    queryFn: () => fetchJson<PaginatedResponse<AdminStorySummary>>(
      `/api/admin/stories?q=${encodeURIComponent(params.query)}&type=${params.type}&page=${params.page}&size=${params.pageSize}`,
    ),
    enabled,
  });
}

export function useRefreshModelPrices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<AdminOverview>('/api/admin/prices/refresh', { method: 'POST' }),
    onSuccess: (overview) => {
      queryClient.setQueryData(['admin', 'overview'], overview);
    },
  });
}

export function useAdminUserDetail(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: () => fetchJson<AdminUserDetail>(`/api/admin/users/${userId}`),
    enabled: enabled && !!userId,
  });
}

export function useUpdateStoryPackOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      slug: StoryPackOffer['slug'];
      name: string;
      description: string;
      priceMinor: number;
      isActive: boolean;
    }) => fetchJson<StoryPackOffer>(`/api/admin/offers/${payload.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'me'] });
    },
  });
}

export function useGrantCredits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      userId: string;
      amount: number;
      note?: string;
    }) => fetchJson<{ ledgerId: string; availableCredits: number }>(`/api/admin/users/${payload.userId}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: payload.amount, note: payload.note }),
    }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'user', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'history'] });
    },
  });
}
