import { runRectificationAppealFlow } from '@/lib/tasks/rectification-appeal-flow';

describe('rectification appeal proof flow', () => {
  it('uploads a fresh proof before submitting the appeal', async () => {
    const order: string[] = [];
    const result = await runRectificationAppealFlow({
      uploadFreshProof: async () => {
        order.push('proof');
        return true;
      },
      submitAppeal: async () => {
        order.push('appeal');
        return true;
      },
    });

    expect(result).toBe('submitted');
    expect(order).toEqual(['proof', 'appeal']);
  });

  it('does not submit an appeal when proof upload fails', async () => {
    const submitAppeal = jest.fn(async () => true);
    const result = await runRectificationAppealFlow({
      uploadFreshProof: async () => false,
      submitAppeal,
    });

    expect(result).toBe('proof-upload-failed');
    expect(submitAppeal).not.toHaveBeenCalled();
  });

  it('reports an appeal failure after a successful proof upload', async () => {
    const result = await runRectificationAppealFlow({
      uploadFreshProof: async () => true,
      submitAppeal: async () => false,
    });

    expect(result).toBe('appeal-submit-failed');
  });
});
