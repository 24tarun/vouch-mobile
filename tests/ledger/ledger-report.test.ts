/* eslint-disable import/first */
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

import { decodeLedgerReportResponse } from '@/lib/ledger-report';

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => body,
  };
}

describe('ledger report response decoding', () => {
  it('returns the successful email confirmation', async () => {
    await expect(decodeLedgerReportResponse(response(200, JSON.stringify({
      success: true,
      message: 'Current month ledger email sent.',
    })))).resolves.toEqual({
      success: true,
      message: 'Current month ledger email sent.',
    });
  });

  it('preserves a JSON service error', async () => {
    await expect(decodeLedgerReportResponse(response(500, JSON.stringify({
      success: false,
      error: 'Could not send the ledger email.',
    })))).resolves.toEqual({
      success: false,
      error: 'Could not send the ledger email.',
    });
  });

  it('handles an HTML gateway response without exposing a JSON parse error', async () => {
    const result = await decodeLedgerReportResponse(response(429, '<!doctype html><title>Security checkpoint</title>'));

    expect(result).toEqual({
      success: false,
      error: 'The ledger service returned an invalid HTTP 429. Please try again.',
    });
  });
});
