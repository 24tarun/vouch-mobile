/* eslint-disable import/first */
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
      }),
    },
  },
}));

import { render } from '@testing-library/react-native';

import { UserAvatar } from '@/components/UserAvatar';

describe('UserAvatar', () => {
  it('shows initials when no photo is set', () => {
    const view = render(<UserAvatar username="Tarun Hariharan" />);

    expect(view.getByText('TH')).toBeTruthy();
    expect(view.UNSAFE_queryByType('ExpoImage' as any)).toBeNull();
  });

  it('uses the immutable avatar path as its disk cache key', () => {
    const view = render(<UserAvatar username="Tarun" avatarPath="user-1/avatar-2.jpg" />);
    const image = view.UNSAFE_getByType('ExpoImage' as any);

    expect(image.props.source).toEqual({
      uri: 'https://storage.test/user-1/avatar-2.jpg',
      cacheKey: 'user-1/avatar-2.jpg',
    });
    expect(image.props.cachePolicy).toBe('memory-disk');
  });
});
