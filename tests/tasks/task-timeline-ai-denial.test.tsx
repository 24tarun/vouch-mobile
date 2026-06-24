import { render } from '@testing-library/react-native';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import type { AiVouch, Task, TaskEvent } from '@/lib/types';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    user_id: 'user-1',
    voucher_id: 'ai-user',
    title: 'Check pocket zip',
    description: null,
    failure_cost_cents: 500,
    deadline: '2026-06-24T10:00:00.000Z',
    status: 'AWAITING_USER',
    postponed_at: null,
    marked_completed_at: null,
    voucher_response_deadline: null,
    recurrence_rule_id: null,
    iteration_number: null,
    start_at: null,
    is_strict: false,
    required_pomo_minutes: null,
    requires_proof: true,
    has_proof: false,
    proof_request_open: false,
    proof_requested_at: null,
    proof_requested_by: null,
    google_sync_for_task: false,
    google_event_start_at: null,
    google_event_end_at: null,
    google_event_color_id: null,
    voucher_timeout_auto_accepted: false,
    ai_escalated_from: false,
    resubmit_count: 1,
    ai_vouch_calls_count: 1,
    created_at: '2026-06-23T09:00:00.000Z',
    updated_at: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<TaskEvent>): TaskEvent {
  return {
    id: 'event-1',
    task_id: 'task-1',
    event_type: 'AI_DENY',
    actor_id: null,
    from_status: 'AWAITING_AI',
    to_status: 'AI_DENIED',
    metadata: null,
    created_at: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

function aiVouch(overrides: Partial<AiVouch>): AiVouch {
  return {
    id: 'vouch-1',
    task_id: 'task-1',
    attempt_number: 1,
    decision: 'denied',
    reason: null,
    approved_at: null,
    vouched_at: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('TaskTimeline AI denial details', () => {
  it('renders AI_DENY event metadata reason', () => {
    const { getByText } = render(
      <TaskTimeline
        task={task()}
        events={[
          event({ event_type: 'AI_DENY', metadata: { reason: 'The proof does not show the pocket zip.' } }),
        ]}
        aiVouches={[]}
      />,
    );

    expect(getByText('The proof does not show the pocket zip.')).toBeTruthy();
  });

  it('renders AI_DENIED detail from matching AI vouch reason', () => {
    const { getByText } = render(
      <TaskTimeline
        task={task()}
        events={[
          event({
            event_type: 'AI_DENIED',
            metadata: null,
            created_at: '2026-06-23T10:01:00.000Z',
          }),
        ]}
        aiVouches={[
          aiVouch({ reason: 'The uploaded photo is too dark to verify the task.' }),
        ]}
      />,
    );

    expect(getByText('The uploaded photo is too dark to verify the task.')).toBeTruthy();
  });
});
