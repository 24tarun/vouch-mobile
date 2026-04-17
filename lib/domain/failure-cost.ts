import type { Currency } from '@/lib/types';

export interface FailureCostBounds {
  minMajor: number;
  maxMajor: number;
  minCents: number;
  maxCents: number;
}

export function getFailureCostBounds(currency: Currency): FailureCostBounds {
  if (currency === 'INR') {
    return {
      minMajor: 50,
      maxMajor: 1000,
      minCents: 5000,
      maxCents: 100000,
    };
  }

  return {
    minMajor: 1,
    maxMajor: 100,
    minCents: 100,
    maxCents: 10000,
  };
}

export function formatFailureCostFromCents(defaultFailureCostCents: number, currency: Currency): string {
  const amount = defaultFailureCostCents / 100;
  if (currency === 'INR') {
    return String(Math.round(amount));
  }
  return amount.toFixed(2).replace(/\.00$/, '');
}
