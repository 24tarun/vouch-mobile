import { render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import { StatusPill } from '@/components/StatusPill';

describe('StatusPill paused presentation state', () => {
  it.each(['ACTIVE', 'POSTPONED'])('shows a paused %s task as Paused using the active blue treatment', (status) => {
    const { getByText, UNSAFE_getByType } = render(<StatusPill status={status} paused />);
    const label = getByText('Paused');
    const labelStyle = StyleSheet.flatten(label.props.style);
    const pillStyle = StyleSheet.flatten(UNSAFE_getByType(View).props.style);

    expect(labelStyle.color).toBe('#93C5FD');
    expect(pillStyle.backgroundColor).toBe('#3B82F633');
    expect(pillStyle.borderColor).toBe('#3B82F64D');
  });

  it('does not replace a historical task status when its recurrence is paused', () => {
    const { getByText, queryByText } = render(<StatusPill status="ACCEPTED" paused />);

    expect(getByText('Accepted')).toBeTruthy();
    expect(queryByText('Paused')).toBeNull();
  });
});
