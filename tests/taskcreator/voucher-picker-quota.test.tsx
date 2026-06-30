/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name?: string }) => React.createElement(Text, null, name ?? 'icon'),
  };
});

import { VoucherPickerModal } from '@/components/tasks/VoucherPickerModal';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';
import type { AiVoucherQuota } from '@/lib/types';

const freeQuota = (overrides: Partial<AiVoucherQuota> = {}): AiVoucherQuota => ({
  accountTier: 'free',
  used: 3,
  pending: 0,
  limit: 5,
  remaining: 2,
  resetsAt: '2026-07-01T00:00:00.000Z',
  canStartReview: true,
  ...overrides,
});

function renderPicker(quota: AiVoucherQuota | null, options: { loading?: boolean; error?: string | null } = {}) {
  const setVoucherValue = jest.fn();
  const closeVoucherPicker = jest.fn();
  const result = render(
    <VoucherPickerModal
      visible
      anchor={{ pageX: 0, pageY: 400, width: 320, buttonHeight: 48 }}
      safeTopInset={0}
      voucherDropdownHeight={300}
      setVoucherDropdownHeight={jest.fn()}
      voucherSearch=""
      setVoucherSearch={jest.fn()}
      voucherValue="self"
      setVoucherValue={setVoucherValue}
      closeVoucherPicker={closeVoucherPicker}
      friendsLoading={false}
      friendsError={null}
      filteredFriends={[{ id: AI_PROFILE_ID, username: 'AI', initial: 'A' }]}
      aiQuota={quota}
      aiQuotaLoading={options.loading ?? false}
      aiQuotaError={options.error ?? null}
    />,
  );
  return { ...result, setVoucherValue, closeVoucherPicker };
}

describe('VoucherPickerModal AI quota', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('shows free usage and pending reviews while remaining selectable', () => {
    const { getByText, getByLabelText, setVoucherValue, closeVoucherPicker } = renderPicker(
      freeQuota({ used: 3, pending: 1, remaining: 1 }),
    );

    expect(getByText('3/5 · 1 pending')).toBeTruthy();
    fireEvent.press(getByLabelText('AI, 3/5 · 1 pending'));
    expect(setVoucherValue).toHaveBeenCalledWith(AI_PROFILE_ID);
    expect(closeVoucherPicker).toHaveBeenCalled();
  });

  it('shows 5/5 and explains why a free user cannot select AI', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText, getByLabelText, setVoucherValue } = renderPicker(
      freeQuota({ used: 5, remaining: 0, canStartReview: false }),
    );

    expect(getByText('5/5')).toBeTruthy();
    fireEvent.press(getByLabelText('AI, 5/5'));
    expect(setVoucherValue).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('AI credits used', expect.stringContaining('used 5 of 5'));
  });

  it('shows infinity for paid users', () => {
    const paidQuota: AiVoucherQuota = {
      accountTier: 'paid',
      used: 17,
      pending: 2,
      limit: null,
      remaining: null,
      resetsAt: '2026-07-01T00:00:00.000Z',
      canStartReview: true,
    };
    const { getByText, getByLabelText, setVoucherValue } = renderPicker(paidQuota);

    expect(getByText('∞')).toBeTruthy();
    fireEvent.press(getByLabelText('AI, ∞'));
    expect(setVoucherValue).toHaveBeenCalledWith(AI_PROFILE_ID);
  });

  it('renders loading and error states as unavailable', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const loading = renderPicker(null, { loading: true });
    fireEvent.press(loading.getByLabelText('AI, …/5'));
    expect(alert).toHaveBeenLastCalledWith('Checking AI credits', expect.any(String));
    loading.unmount();

    const failed = renderPicker(null, { error: 'network error' });
    fireEvent.press(failed.getByLabelText('AI, Unavailable'));
    expect(alert).toHaveBeenLastCalledWith('AI credits unavailable', expect.any(String));
  });
});
