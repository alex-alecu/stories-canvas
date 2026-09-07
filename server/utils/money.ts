const MICRODOLLARS_PER_USD = 1_000_000;

export function readMicrodollars(value: unknown): number {
  const amount = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new Error('USD microdollars must be a safe integer.');
  }
  return amount;
}

export function toMicrodollars(usd: number): number {
  if (!Number.isFinite(usd)) throw new Error('USD amount must be finite.');
  const amount = readMicrodollars(Math.sign(usd) * Math.round(Math.abs(usd) * MICRODOLLARS_PER_USD));
  return amount === 0 ? 0 : amount;
}

export function fromMicrodollars(value: unknown): number {
  return readMicrodollars(value) / MICRODOLLARS_PER_USD;
}
