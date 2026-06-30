import { fetchAiVoucherQuota } from '@/lib/hooks/useAiVoucherQuota';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

describe('fetchAiVoucherQuota', () => {
  const rpc = supabase.rpc as jest.Mock;

  beforeEach(() => rpc.mockReset());

  it('maps a free quota RPC response', async () => {
    rpc.mockResolvedValue({
      data: [{
        account_tier: 'free',
        used: 4,
        pending: 1,
        monthly_limit: 5,
        remaining: 0,
        resets_at: '2026-07-01T00:00:00.000Z',
        can_start_review: false,
      }],
      error: null,
    });

    await expect(fetchAiVoucherQuota()).resolves.toEqual({
      accountTier: 'free',
      used: 4,
      pending: 1,
      limit: 5,
      remaining: 0,
      resetsAt: '2026-07-01T00:00:00.000Z',
      canStartReview: false,
    });
  });

  it('maps paid users to an unlimited quota', async () => {
    rpc.mockResolvedValue({
      data: [{
        account_tier: 'paid',
        used: 99,
        pending: 0,
        monthly_limit: null,
        remaining: null,
        resets_at: '2026-07-01T00:00:00.000Z',
        can_start_review: true,
      }],
      error: null,
    });

    const quota = await fetchAiVoucherQuota();
    expect(quota.accountTier).toBe('paid');
    expect(quota.limit).toBeNull();
    expect(quota.remaining).toBeNull();
    expect(quota.canStartReview).toBe(true);
  });

  it('surfaces RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(fetchAiVoucherQuota()).rejects.toThrow('permission denied');
  });
});
