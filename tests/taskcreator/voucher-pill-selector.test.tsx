/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name?: string }) => React.createElement(Text, null, name ?? 'icon'),
  };
});

import {
  buildVoucherPillOptions,
  getAiVoucherPillState,
  useVoucherSelection,
  VoucherPillSelector,
} from '@/components/tasks/VoucherPillSelector';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';
import type { FriendOption } from '@/lib/hooks/useFriends';
import type { AiVoucherQuota } from '@/lib/types';

const AI_FRIEND: FriendOption = { id: AI_PROFILE_ID, username: 'AI', initial: 'A' };
const ALICE: FriendOption = { id: 'alice-id', username: 'Alice', initial: 'A' };
const MADHU: FriendOption = { id: 'madhu-id', username: 'madhu', initial: 'M' };
const ZOE: FriendOption = { id: 'zoe-id', username: 'Zoe', initial: 'Z' };

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

describe('voucher pill ordering', () => {
  const aiState = getAiVoucherPillState(freeQuota(), false, null);

  it('orders the default, AI, Myself, then alphabetized human vouchers without duplicates', () => {
    const options = buildVoucherPillOptions({
      defaultVoucherValue: MADHU.id,
      friends: [ZOE, MADHU, AI_FRIEND, ALICE],
      aiState,
    });

    expect(options.map((option) => option.label)).toEqual(['madhu', 'AI', 'Myself', 'Alice', 'Zoe']);
  });

  it('keeps AI first when AI is the default and does not duplicate it', () => {
    const options = buildVoucherPillOptions({
      defaultVoucherValue: AI_PROFILE_ID,
      friends: [MADHU, AI_FRIEND, ALICE],
      aiState,
    });

    expect(options.map((option) => option.label)).toEqual(['AI', 'Myself', 'Alice', 'madhu']);
  });

  it('omits AI when disabled and keeps Myself first when it is the default', () => {
    const options = buildVoucherPillOptions({
      defaultVoucherValue: 'self',
      friends: [MADHU, ALICE],
      aiState,
    });

    expect(options.map((option) => option.label)).toEqual(['Myself', 'Alice', 'madhu']);
  });

  it('falls back to Myself when the configured default is unavailable', () => {
    const options = buildVoucherPillOptions({
      defaultVoucherValue: 'missing-friend',
      friends: [AI_FRIEND, ALICE],
      aiState,
    });

    expect(options.map((option) => option.label)).toEqual(['Myself', 'AI', 'Alice']);
  });
});

describe('AI voucher pill quota state', () => {
  it('shows compact free usage and includes pending reviews in the accessibility label', () => {
    expect(getAiVoucherPillState(freeQuota({ used: 3, pending: 1 }), false, null)).toEqual({
      quotaLabel: '3/5',
      accessibilityLabel: 'AI, 3/5, 1 pending',
      disabled: false,
    });
  });

  it('shows infinity for paid users', () => {
    expect(getAiVoucherPillState({
      accountTier: 'paid',
      used: 17,
      pending: 2,
      limit: null,
      remaining: null,
      resetsAt: '2026-07-01T00:00:00.000Z',
      canStartReview: true,
    }, false, null)).toEqual({
      quotaLabel: '∞',
      accessibilityLabel: 'AI, unlimited, 2 pending',
      disabled: false,
    });
  });

  it('disables AI while loading, after an error, and when free credits are exhausted', () => {
    expect(getAiVoucherPillState(null, true, null)).toMatchObject({ quotaLabel: '…/5', disabled: true });
    expect(getAiVoucherPillState(null, false, 'network error')).toMatchObject({
      quotaLabel: 'Unavailable',
      disabled: true,
    });
    expect(getAiVoucherPillState(
      freeQuota({ used: 5, remaining: 0, canStartReview: false }),
      false,
      null,
    )).toMatchObject({ quotaLabel: '5/5', disabled: true });
  });
});

describe('VoucherPillSelector', () => {
  it('selects pills directly and exposes horizontal scrolling without an indicator', () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByTestId } = render(
      <VoucherPillSelector
        options={[
          { value: MADHU.id, label: MADHU.username, icon: 'user' },
          { value: ALICE.id, label: ALICE.username, icon: 'user' },
        ]}
        selectedValue={MADHU.id}
        loading={false}
        onSelect={onSelect}
      />,
    );

    expect(getByTestId('voucher-pill-scroll').props.horizontal).toBe(true);
    expect(getByTestId('voucher-pill-scroll').props.showsHorizontalScrollIndicator).toBe(false);
    expect(getByLabelText('madhu').props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(getByLabelText('Alice'));
    expect(onSelect).toHaveBeenCalledWith(ALICE.id);
  });

  it('marks unavailable AI as disabled while keeping it tappable for an explanatory alert', () => {
    const onSelect = jest.fn();
    const { getByLabelText } = render(
      <VoucherPillSelector
        options={[{
          value: AI_PROFILE_ID,
          label: 'AI',
          icon: 'cpu',
          quotaLabel: '5/5',
          disabled: true,
          accessibilityLabel: 'AI, 5/5',
        }]}
        selectedValue="self"
        loading={false}
        onSelect={onSelect}
      />,
    );

    const aiPill = getByLabelText('AI, 5/5');
    expect(aiPill.props.accessibilityState).toEqual({ selected: false });
    fireEvent.press(aiPill);
    expect(onSelect).toHaveBeenCalledWith(AI_PROFILE_ID);
  });
});

describe('useVoucherSelection', () => {
  it('resets to the configured default on every fresh opening', () => {
    const { result, rerender } = renderHook(
      ({ visible, defaultValue }) => useVoucherSelection(visible, defaultValue),
      { initialProps: { visible: true, defaultValue: MADHU.id } },
    );

    expect(result.current[0]).toBe(MADHU.id);
    act(() => result.current[1](ALICE.id));
    expect(result.current[0]).toBe(ALICE.id);

    rerender({ visible: false, defaultValue: MADHU.id });
    expect(result.current[0]).toBeNull();
    rerender({ visible: true, defaultValue: MADHU.id });
    expect(result.current[0]).toBe(MADHU.id);
  });
});
