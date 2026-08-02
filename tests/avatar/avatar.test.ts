/* eslint-disable import/first */
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
      }),
    },
  },
}));

import {
  buildAvatarObjectPath,
  getAvatarColor,
  getAvatarInitials,
  getAvatarPublicUrl,
  isOwnedAvatarPath,
} from '@/lib/avatar';

describe('avatar helpers', () => {
  it('builds readable initials from usernames', () => {
    expect(getAvatarInitials('Tarun Hariharan')).toBe('TH');
    expect(getAvatarInitials('tarun')).toBe('TA');
    expect(getAvatarInitials('')).toBe('?');
  });

  it('keeps fallback colors deterministic', () => {
    expect(getAvatarColor('tarun')).toBe(getAvatarColor('tarun'));
  });

  it('builds an immutable object path inside the user folder', () => {
    const path = buildAvatarObjectPath('user-1', 1234, 0.5);

    expect(path).toMatch(/^user-1\/1234-[a-z0-9]{10}\.jpg$/);
    expect(isOwnedAvatarPath('user-1', path)).toBe(true);
    expect(isOwnedAvatarPath('user-2', path)).toBe(false);
  });

  it('derives a public URL without a network request', () => {
    expect(getAvatarPublicUrl('user-1/avatar.jpg')).toBe('https://storage.test/user-1/avatar.jpg');
    expect(getAvatarPublicUrl(null)).toBeNull();
  });
});
