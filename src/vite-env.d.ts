/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_DEFAULT_LANGUAGE?: string;
  readonly VITE_APP_SITE_NAME?: string;
  readonly VITE_APP_SITE_SHORT_NAME?: string;
  readonly VITE_APP_SITE_DESCRIPTION?: string;
  readonly VITE_DEFAULT_LANGUAGE?: string;
  readonly VITE_GTM_ID?: string;
  readonly VITE_GA4_MEASUREMENT_ID?: string;
  readonly VITE_GOOGLE_ADS_CONVERSION_ID?: string;
  readonly VITE_GOOGLE_ADS_PURCHASE_CONVERSION_LABEL?: string;
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_TIKTOK_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
