export type RectificationAppealFlowResult =
  | 'submitted'
  | 'proof-upload-failed'
  | 'appeal-submit-failed';

export async function runRectificationAppealFlow(actions: {
  uploadFreshProof: () => Promise<boolean>;
  submitAppeal: () => Promise<boolean>;
}): Promise<RectificationAppealFlowResult> {
  const proofUploaded = await actions.uploadFreshProof();
  if (!proofUploaded) return 'proof-upload-failed';

  const appealSubmitted = await actions.submitAppeal();
  return appealSubmitted ? 'submitted' : 'appeal-submit-failed';
}
