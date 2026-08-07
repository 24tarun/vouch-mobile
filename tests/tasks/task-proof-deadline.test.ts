import {
  COMPLETION_EDIT_LOCKED_ERROR,
  isCaptureStartWithinLicense,
  isCompletionEditingLocked,
  wasProofStagedBeforeCompletionLock,
} from '../../supabase/functions/task-proof-upload/task-proof-deadline';

describe('task proof deadline lock', () => {
  const deadline = '2026-08-03T06:00:00.000Z';
  const cutoffMs = Date.parse(deadline) + 60_000;

  it.each(['ACTIVE', 'POSTPONED', 'AWAITING_VOUCHER', 'AWAITING_AI', 'MARKED_COMPLETE'])(
    'locks %s after the inclusive deadline minute',
    (status) => {
      expect(isCompletionEditingLocked(status, deadline, cutoffMs - 1)).toBe(false);
      expect(isCompletionEditingLocked(status, deadline, cutoffMs)).toBe(true);
    },
  );

  it('keeps rectification proof independent from the original task deadline', () => {
    expect(isCompletionEditingLocked('AWAITING_RECTIFICATION', deadline, cutoffMs)).toBe(false);
  });

  it('allows a finalization that was staged before the lock and rejects one at the cutoff', () => {
    expect(wasProofStagedBeforeCompletionLock(deadline, '2026-08-03T06:00:59.999Z')).toBe(true);
    expect(wasProofStagedBeforeCompletionLock(deadline, '2026-08-03T06:01:00.000Z')).toBe(false);
  });

  it('uses the same user-facing deadline error as completion', () => {
    expect(COMPLETION_EDIT_LOCKED_ERROR).toBe(
      'The task deadline has passed. Proof and completion can no longer be changed.',
    );
  });
});

describe('isCaptureStartWithinLicense', () => {
  const license = {
    notBefore: '2026-05-05T11:00:00.000Z',
    notAfter: '2026-05-05T12:00:59.999Z',
  };

  it('accepts a capture recorded offline inside the licensed window', () => {
    // No signal at 12:00:55, so no begin-capture round trip was possible. The
    // license obtained at 11:00 is what lets this capture still count.
    expect(isCaptureStartWithinLicense(
      license,
      Date.parse('2026-05-05T12:00:55.000Z'),
      Date.parse('2026-05-05T12:04:10.000Z'),
    )).toBe(true);
  });

  it('rejects a capture claimed before the license was issued', () => {
    expect(isCaptureStartWithinLicense(
      license,
      Date.parse('2026-05-05T10:59:59.000Z'),
      Date.parse('2026-05-05T11:05:00.000Z'),
    )).toBe(false);
  });

  it('rejects a capture claimed past the licensed window', () => {
    // notAfter is clamped to the deadline at issue time, so this is also how a
    // license is prevented from authorizing a late capture.
    expect(isCaptureStartWithinLicense(
      license,
      Date.parse('2026-05-05T12:01:00.000Z'),
      Date.parse('2026-05-05T12:01:05.000Z'),
    )).toBe(false);
  });

  it('rejects a licensed capture redeemed long after the fact', () => {
    expect(isCaptureStartWithinLicense(
      license,
      Date.parse('2026-05-05T12:00:55.000Z'),
      Date.parse('2026-05-05T12:30:00.000Z'),
    )).toBe(false);
  });

  it('accepts a slow upload still inside the redemption window', () => {
    expect(isCaptureStartWithinLicense(
      license,
      Date.parse('2026-05-05T12:00:55.000Z'),
      Date.parse('2026-05-05T12:14:00.000Z'),
    )).toBe(true);
  });

  it('rejects an unparseable capture time', () => {
    expect(isCaptureStartWithinLicense(license, Number.NaN, Date.parse('2026-05-05T12:00:00.000Z'))).toBe(false);
  });
});
