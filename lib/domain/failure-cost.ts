import type { Currency } from '@/lib/types';

export interface FailureCostBounds {
  minMajor: number;
  maxMajor: number;
  minCents: number;
  maxCents: number;
  stepMajor: number;
  stepCents: number;
}

export function getFailureCostBounds(currency: Currency): FailureCostBounds {
  if (currency === 'INR') {
    return {
      minMajor: 10,
      maxMajor: 1000,
      minCents: 1000,
      maxCents: 100000,
      stepMajor: 10,
      stepCents: 1000,
    };
  }

  return {
    minMajor: 0.25,
    maxMajor: 100,
    minCents: 25,
    maxCents: 10000,
    stepMajor: 0.25,
    stepCents: 25,
  };
}

export function isValidFailureCostCents(amountCents: number, bounds: FailureCostBounds): boolean {
  return amountCents >= bounds.minCents
    && amountCents <= bounds.maxCents
    && amountCents % bounds.stepCents === 0;
}

export function formatFailureCostFromCents(defaultFailureCostCents: number, currency: Currency): string {
  const amount = defaultFailureCostCents / 100;
  if (currency === 'INR') {
    return String(Math.round(amount));
  }
  return amount.toFixed(2).replace(/\.00$/, '');
}
