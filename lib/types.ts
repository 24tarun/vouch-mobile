// Canonical TypeScript types — derived from DB migrations and vouch-web/src/lib/types.ts
// See PRD section 13 for the full reference. Do not modify without updating the PRD.

// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'ACTIVE'
  | 'POSTPONED'
  | 'MARKED_COMPLETE'
  | 'AWAITING_VOUCHER'
  | 'AWAITING_AI'
  | 'AI_DENIED'
  | 'AWAITING_USER'
  | 'ESCALATED'
  | 'ACCEPTED'
  | 'AUTO_ACCEPTED'
  | 'AI_ACCEPTED'
  | 'DENIED'
  | 'MISSED'
  | 'RECTIFIED'
  | 'SETTLED'
  | 'DELETED';

export type Currency = 'EUR' | 'USD' | 'INR';

export type LedgerEntryType =
  | 'failure'
  | 'rectified'
  | 'override'
  | 'voucher_timeout_penalty';

export type ProofUploadState = 'PENDING' | 'UPLOADED' | 'FAILED';

export type PomoStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'DELETED';

export type ReminderSource =
  | 'MANUAL'
  | 'DEFAULT_DEADLINE_1H'
  | 'DEFAULT_DEADLINE_10M';

export type RecurrenceFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'YEARLY'
  | 'WEEKDAYS'
  | 'CUSTOM';

export type CommitmentStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'FAILED';

export interface Commitment {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: CommitmentStatus;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  created_at: string;
  updated_at: string;
}

export interface CommitmentTaskLink {
  id: string;
  commitment_id: string;
  task_id: string | null;
  recurrence_rule_id: string | null;
  created_at: string;
}

// ─── Core entities ────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  username: string;
  currency: Currency;
  default_pomo_duration_minutes: number;
  default_event_duration_minutes: number;
  default_failure_cost_cents: number;
  default_voucher_id: string | null;
  default_requires_proof_for_all_tasks: boolean;
  strict_pomo_enabled: boolean;
  deadline_one_hour_warning_enabled: boolean;
  deadline_final_warning_enabled: boolean;
  notification_sound_key: 'default' | 'tone_01' | 'tone_02' | 'tone_03';
  voucher_can_view_active_tasks: boolean;
  web_notifications_enabled: boolean;
  hide_tips: boolean;
  lifetime_xp: number;
  display_xp_bar_on_dashboard: boolean;
  display_rp_bar_on_dashboard: boolean;
  abandoned_commitments_count: number;
  ai_friend_opt_in: boolean;
  charity_enabled: boolean;
  selected_charity_id: string | null;
  timezone: string;
  timezone_user_set: boolean;
  created_at: string;
}

export interface Charity {
  id: string;
  key: string;
  name: string;
  is_active: boolean;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  voucher_id: string;
  title: string;
  description: string | null;
  failure_cost_cents: number;
  deadline: string;
  status: TaskStatus;
  postponed_at: string | null;
  marked_completed_at: string | null;
  voucher_response_deadline: string | null;
  recurrence_rule_id: string | null;
  iteration_number: number | null;
  start_at: string | null;
  is_strict: boolean;
  required_pomo_minutes: number | null;
  requires_proof: boolean;
  has_proof: boolean;
  proof_request_open: boolean;
  proof_requested_at: string | null;
  proof_requested_by: string | null;
  google_sync_for_task: boolean;
  google_event_start_at: string | null;
  google_event_end_at: string | null;
  google_event_color_id: string | null;
  voucher_timeout_auto_accepted: boolean;
  ai_escalated_from: boolean;
  resubmit_count: number;
  ai_vouch_calls_count: number;
  created_at: string;
  updated_at: string;
  // Joined relations (not always present)
  subtasks?: TaskSubtask[];
  completion_proof?: TaskCompletionProof | null;
  pomo_total_seconds?: number;
}

export interface TaskSubtask {
  id: string;
  parent_task_id: string;
  user_id: string;
  title: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskReminder {
  id: string;
  parent_task_id: string;
  user_id: string;
  reminder_at: string;
  source: ReminderSource;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCompletionProof {
  id: string;
  task_id: string;
  owner_id: string;
  voucher_id: string;
  bucket: 'task-proofs';
  object_path: string;
  media_kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  overlay_timestamp_text: string;
  upload_state: ProofUploadState;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  event_type: string;
  actor_id: string | null;
  from_status: TaskStatus;
  to_status: TaskStatus;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AiVouch {
  id: string;
  task_id: string;
  attempt_number: number;
  decision: 'approved' | 'denied';
  reason: string | null;
  approved_at: string | null;
  vouched_at: string;
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  task_id: string;
  period: string; // YYYY-MM
  amount_cents: number;
  entry_type: LedgerEntryType;
  created_at: string;
}

export interface RectifyPass {
  id: string;
  user_id: string;
  task_id: string;
  authorized_by: string;
  period: string; // YYYY-MM
  created_at: string;
}

export interface Override {
  id: string;
  user_id: string;
  task_id: string;
  period: string; // YYYY-MM
  created_at: string;
}

export interface PomoSession {
  id: string;
  user_id: string;
  task_id: string;
  duration_minutes: number;
  elapsed_seconds: number;
  is_strict: boolean;
  status: PomoStatus;
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurrenceRuleConfig {
  frequency: RecurrenceFrequency;
  interval: number;
  days_of_week?: number[]; // 0=Sun … 6=Sat
  time_of_day: string; // HH:MM
}

export interface RecurrenceRule {
  id: string;
  user_id: string;
  voucher_id: string;
  title: string;
  description: string | null;
  failure_cost_cents: number;
  required_pomo_minutes: number | null;
  requires_proof: boolean;
  rule_config: RecurrenceRuleConfig;
  timezone: string;
  google_sync_for_rule: boolean;
  time_bound_for_rule: boolean;
  window_start_offset_minutes: number | null;
  google_event_duration_minutes: number | null;
  google_event_color_id: string | null;
  manual_reminder_offsets_ms: number[] | null;
  last_generated_date: string | null; // YYYY-MM-DD
  latest_iteration: number;
  created_at: string;
  updated_at: string;
}

export interface ExpoPushToken {
  id: string;
  user_id: string;
  token: string;
  device_name: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Composite / display types ────────────────────────────────────────────────

export interface TaskWithRelations extends Task {
  user?: Profile;
  voucher?: Profile;
  events?: TaskEvent[];
  recurrence_rule?: RecurrenceRule | null;
  subtasks?: TaskSubtask[];
  reminders?: TaskReminder[];
  completion_proof?: TaskCompletionProof | null;
}

export interface VoucherPendingTask extends TaskWithRelations {
  pending_display_type: 'ACTIVE' | 'AWAITING_VOUCHER';
  pending_deadline_at: string | null;
  pending_actionable: boolean;
  proof_request_count: number;
  rectify_passes_used: number;
}

