export function formatUsdMicros(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value !== 0 && Math.abs(value) < 10_000 ? 4 : 2,
    maximumFractionDigits: 6,
  }).format(value / 1_000_000);
}

export function formatMinor(value: number | null, locale: string, currency: string): string {
  if (value === null) return 'Unavailable';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 4,
  }).format(value / 100);
}

export function formatRate(value: string, unit: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '—';
  const scale = unit === 'character' ? 1_000 : 1_000_000;
  return `$${(numeric * scale).toLocaleString('en-US', { maximumFractionDigits: 6 })} / ${scale === 1_000 ? '1K' : '1M'}`;
}
