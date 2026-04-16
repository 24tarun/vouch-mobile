/**
 * Lightweight module-level ref so the tab layout can collapse the task creator
 * when any nav tab is pressed while the creator is open.
 */
export const taskCreatorState = {
  isExpanded: false,
  collapse: () => {},
};
