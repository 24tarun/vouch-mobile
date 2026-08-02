import { render } from '@testing-library/react-native';

import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import type { Task, TaskEvent } from '@/lib/types';

const task: Task = {
  id: 'task-1',
  user_id: 'user-1',
  voucher_id: 'voucher-1',
  title: 'Protein shake',
  description: null,
  failure_cost_cents: 100,
  deadline: '2026-08-02T07:05:00.000Z',
  status: 'MISSED',
  postponed_at: null,
  marked_completed_at: null,
  voucher_response_deadline: null,
  recurrence_rule_id: null,
  iteration_number: null,
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
  created_at: '2026-08-02T06:00:00.000Z',
  updated_at: '2026-08-02T11:04:00.000Z',
};

const events: TaskEvent[] = [
  {
    id: 'request',
    task_id: task.id,
    event_type: 'RECTIFICATION_REQUESTED',
    actor_id: task.user_id,
    from_status: 'MISSED',
    to_status: 'AWAITING_RECTIFICATION',
    metadata: null,
    created_at: '2026-08-02T11:03:00.000Z',
  },
  {
    id: 'cancel',
    task_id: task.id,
    event_type: 'RECTIFICATION_CANCELLED',
    actor_id: task.user_id,
    from_status: 'AWAITING_RECTIFICATION',
    to_status: 'MISSED',
    metadata: null,
    created_at: '2026-08-02T11:04:00.000Z',
  },
];

describe('TaskTimeline rectification cancellation', () => {
  it('renders cancellation between awaiting rectification and the restored status', () => {
    const { getByText, toJSON } = render(<TaskTimeline task={task} events={events} />);

    expect(getByText('Cancelled Rectification')).toBeTruthy();

    const tree = JSON.stringify(toJSON());
    expect(tree.indexOf('Awaiting Rectification')).toBeLessThan(tree.indexOf('Cancelled Rectification'));
    expect(tree.indexOf('Cancelled Rectification')).toBeLessThan(tree.indexOf('Missed'));
  });
});
