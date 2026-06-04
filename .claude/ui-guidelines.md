UI density and layout rules for this workspace:

- Use the Tasks page task row spacing as the default density baseline.
- Prefer `paddingHorizontal: spacing.lg` and approximately `paddingVertical: 13` for standard row/card content unless there is a strong reason not to.
- Avoid wasting vertical space through oversized wrappers, large section gaps, or decorative padding.
- No container-inside-container design unless it is functionally necessary.
- Prefer hierarchy through typography, spacing rhythm, dividers, and content grouping before adding extra boxes.
- Whenever a task title is rendered and the task is recurring, display the repeat icon at the end of the title on the same line.
