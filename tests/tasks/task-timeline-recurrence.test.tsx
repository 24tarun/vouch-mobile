import { render } from '@testing-library/react-native';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import type { Task, TaskEvent } from '@/lib/types';

const task: Task = {
  id: 'task-1',
  user_id: 'user-1',
  voucher_id: 'user-1',
  title: 'Gym',
  description: null,
  failure_cost_cents: 500,
  deadline: '2026-06-24T18:00:00.000Z',
  status: 'ACCEPTED',
  postponed_at: null,
  marked_completed_at: '2026-06-24T17:00:00.000Z',
  voucher_response_deadline: null,
  recurrence_rule_id: 'rule-1',
  iteration_number: 5,
  start_at: null,
  is_strict: false,
  required_pomo_minutes: null,
  requires_proof: false,
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
  resubmit_count: 0,
  ai_vouch_calls_count: 0,
  created_at: '2026-06-24T00:00:00.000Z',
  updated_at: '2026-06-24T17:00:00.000Z',
};

function recurrenceEvent(eventType: 'REPETITION_PAUSED' | 'REPETITION_RESUMED'): TaskEvent {
  return {
    id: eventType,
    task_id: task.id,
    event_type: eventType,
    actor_id: task.user_id,
    from_status: 'ACCEPTED',
    to_status: 'ACCEPTED',
    metadata: { recurrence_rule_id: task.recurrence_rule_id },
    created_at: '2026-06-24T18:00:00.000Z',
  };
}

describe('TaskTimeline recurrence controls', () => {
  it.each([
    ['REPETITION_PAUSED', 'Repetitions paused'],
    ['REPETITION_RESUMED', 'Repetitions resumed'],
  ] as const)('renders %s using the recurrence event label', (eventType, label) => {
    const { getByText } = render(
      <TaskTimeline task={task} events={[recurrenceEvent(eventType)]} />,
    );

    expect(getByText(label)).toBeTruthy();
  });
});
