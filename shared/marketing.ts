export interface MarketingPost {
  id: string;
  account_id: string;
  post_date: string;
  status: 'preparing' | 'publishing' | 'published' | 'failed' | 'uncertain' | 'skipped';
  story_id: string | null;
  story: MarketingCandidate | null;
  reason: string | null;
  image_url: string | null;
  container_id: string | null;
  media_id: string | null;
  published_at: string | null;
  insights: { reach?: number; views?: number } | null;
  insights_at: string | null;
  insights_error: string | null;
  error: string | null;
  attempts: number;
  updated_at: string;
}

export interface MarketingCandidate {
  id: string;
  title: string;
  excerpt: string;
  language: string;
  target_age: number | null;
  art_style: string | null;
  view_count: number;
  like_count: number;
}

export interface MarketingOverview {
  configured: boolean;
  setup: { appId: string; hasAppSecret: boolean; websiteUrl: string; redirectUri: string };
  connected: boolean;
  username: string | null;
  tokenExpiresAt: string | null;
  enabled: boolean;
  hourUtc: number;
  posts: MarketingPost[];
  logs: MarketingLog[];
}

export interface MarketingLog {
  id: string;
  run_id: string;
  post_id: string | null;
  created_at: string;
  stage: string;
  status: 'started' | 'succeeded' | 'failed' | 'info';
  message: string;
  details: { httpStatus?: number; providerCode?: string; providerTraceId?: string };
}
