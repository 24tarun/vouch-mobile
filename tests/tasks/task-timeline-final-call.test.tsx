import { render } from '@testing-library/react-native';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';
import type { Task, TaskEvent, TaskReminder } from '@/lib/types';

const task: Task = {
  id: 'task-1',
  user_id: 'user-1',
  voucher_id: 'voucher-1',
  title: 'Submit the report',
  description: null,
  failure_cost_cents: 500,
  deadline: '2026-06-24T10:00:00.000Z',
  status: 'ACTIVE',
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
  created_at: '2026-06-24T09:00:00.000Z',
  updated_at: '2026-06-24T09:00:00.000Z',
};

const finalCallEvent: TaskEvent = {
  id: 'event-final-call',
  task_id: task.id,
  event_type: 'DEADLINE_WARNING_DUE',
  actor_id: null,
  from_status: 'ACTIVE',
  to_status: 'ACTIVE',
  metadata: null,
  created_at: task.deadline,
};

const finalCallReminder: TaskReminder = {
  id: 'reminder-final-call',
  parent_task_id: task.id,
  user_id: task.user_id,
  reminder_at: task.deadline,
  source: 'DEFAULT_DEADLINE_DUE',
  notified_at: task.deadline,
  created_at: '2026-06-24T09:00:00.000Z',
  updated_at: task.deadline,
};

describe('TaskTimeline final call reminder', () => {
  it('renders the due-time reminder as a timeline entry', () => {
    const { getByText } = render(
      <TaskTimeline task={task} events={[finalCallEvent]} />,
    );

    expect(getByText('Final Call Reminder Sent')).toBeTruthy();
  });

  it('renders from the due reminder when the background event loses the completion race', () => {
    const { getByText } = render(
      <TaskTimeline
        task={{ ...task, status: 'AWAITING_VOUCHER', marked_completed_at: task.deadline }}
        events={[]}
        reminders={[finalCallReminder]}
        referenceNowMs={new Date(task.deadline).getTime()}
      />,
    );

    expect(getByText('Final Call Reminder Sent')).toBeTruthy();
  });

  it('does not duplicate the final call when the real event exists', () => {
    const { getAllByText } = render(
      <TaskTimeline
        task={task}
        events={[finalCallEvent]}
        reminders={[finalCallReminder]}
        referenceNowMs={new Date(task.deadline).getTime()}
      />,
    );

    expect(getAllByText('Final Call Reminder Sent')).toHaveLength(1);
  });
});
