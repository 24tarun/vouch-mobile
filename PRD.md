# Product Requirements Document (PRD)
## Vouch Mobile (Behavior Parity with vouch-web)

## 1) Product intent

Vouch Mobile is the native/mobile client for the existing Task Accountability System (TAS).
It MUST preserve the same commitment, verification, and financial-accountability behavior as `vouch-web`, while allowing a completely new UI/UX implementation.

This PRD is UI-agnostic by design.

## 2) Product goals

- Preserve trust in commitments through strict task lifecycle and voucher verification.
- Preserve financial accountability through ledger-backed failure, rectify, override, and voucher-timeout entries.
- Preserve auditability through immutable task events and traceable transitions.
- Preserve low-friction collaboration between owner and voucher.

## 3) Non-goals

- Implementing automated charity payment execution (still out of scope).

## 4) Actors

- user also known as owner: creates tasks, works on tasks, marks completion, can use override.
- Voucher: reviews owner completions, accepts/denies, requests proof, can rectify either failed or missed tasks of the user.
- System: enforces deadlines/timeouts, reminder delivery, recurrence generation, proof cleanup, settlement notifications, Google Calendar sync.

## 5) Core domain objects

- Task
- Friendship
- Ledger Entry
- Rectify Pass
- Override
- Recurrence Rule
- Reminder
- Completion Proof
- Pomodoro Session
- Profile Defaults
- Event Task (`-event`, `-start`, `-end`, color)
- Google Calendar Connection + Sync Outbox

## 6) Lifecycle and business rules

### 6.1 Task states

Canonical status enum (matches DB constraint exactly):

```
ACTIVE | POSTPONED | MARKED_COMPLETE | AWAITING_VOUCHER |
AWAITING_ORCA | ORCA_DENIED | AWAITING_USER | ESCALATED |
ACCEPTED | AUTO_ACCEPTED | ORCA_ACCEPTED |
DENIED | MISSED | RECTIFIED | SETTLED | DELETED
```

Main runtime transitions:
- `create` → `ACTIVE`
- `postpone` → `POSTPONED`
- `mark complete (self-vouch)` → `MARKED_COMPLETE` → `ACCEPTED`
- `mark complete (human voucher)` → `MARKED_COMPLETE` → `AWAITING_VOUCHER`
- `mark complete (AI/Orca voucher)` → `MARKED_COMPLETE` → `AWAITING_ORCA`
- `voucher accept` → `ACCEPTED`
- `voucher deny` → `DENIED`
- `system voucher timeout` → `AUTO_ACCEPTED` (+ 30-cent voucher penalty)
- `deadline passed` → `MISSED`
- `rectify (by voucher)` → `RECTIFIED`
- `override (by owner)` → `SETTLED`
- `owner hard delete` → `DELETED`

Notes:
- Self-vouch completion sets `MARKED_COMPLETE` then immediately resolves to `ACCEPTED` server-side.
- Voucher timeout auto-accepts and charges voucher 30 cents.
- Owner hard delete is allowed only for active tasks within 10 minutes of creation.
- Event tasks use `google_event_end_at` as effective due time for fail logic.
- ORCA/AI statuses (`AWAITING_ORCA`, `ORCA_DENIED`, `AWAITING_USER`, `ESCALATED`, `ORCA_ACCEPTED`) are part of the AI voucher flow — preserve them in status rendering but their write paths are system-managed.

### 6.2 Financial rules

- Failure cost stored in cents.
- Failure creates positive ledger entry (`entry_type = 'failure'`).
- Rectify creates negative ledger entry (`entry_type = 'rectified'`).
- Override creates negative ledger entry (`entry_type = 'override'`).
- Voucher timeout penalty creates positive ledger entry against voucher (`entry_type = 'voucher_timeout_penalty'`).
- Supported currencies: `EUR`, `USD`, `INR`.
- App validation bounds:
  - EUR/USD: `1.00..100.00`
  - INR: `50..1000`
- DB hard bounds: `1..100000` cents.

### 6.3 Limits and windows

- Postpone: once per task.
- Rectify passes: max 5 per voucher per user per month (e.g. if a voucher vouches for 2 users, they get 5 rectifications for user 1 and 5 for user 2 independently).
- Override: max 1 per owner per month.
- Rectify window: until the end of the current ledger cycle (calendar month). Voucher checks that the failed task's `updated_at` falls within the current `YYYY-MM` period.
- Voucher response deadline: timezone-aware, end-of-day around +2 local days from completion mark.

## 7) Required user journeys (behavioral parity)

### 7.1 Create task

1. Owner submits title (mandatory), deadline (mandatory; defaults to end of day if omitted), voucher from a dropdown, failure cost (uses profile default if omitted), optional recurrence/subtasks/reminders/pomodoro requirement/event tokens.
2. System validates auth, voucher eligibility, cost bounds, deadline/reminder correctness.
3. System writes task and optional linked entities.
4. System emits `ACTIVE` event and refreshes owner/voucher views.

### 7.2 Complete task and voucher review

1. Owner marks complete before deadline.
2. System enforces subtask and required pomodoro constraints.
3. If self-vouch: resolve to `ACCEPTED`.
4. Else set `AWAITING_VOUCHER`, open voucher review window, optionally initialize proof upload. Proof can also be uploaded and removed before completion or even during `AWAITING_VOUCHER` state.
5. Voucher accepts or denies.
6. Timeout path auto-accepts and charges voucher penalty.

### 7.3 Failure and recovery

- Overdue active tasks fail automatically (system job sets `MISSED`).
- Voucher can rectify failed and missed tasks within limits → task moves to `RECTIFIED`.
- Owner can use monthly override for failed tasks → task moves to `SETTLED`.
- Monthly settlement sends summary notifications via email using the Resend system.

### 7.4 Reminders and proof

- Manual reminders: owner notifications for reminders he has set — either manually added custom ones or presets like 10 min or 1 hr native notifications.
- Default deadline reminders: push warnings + warning events.
- Voucher can request proof for awaiting tasks (not self-vouch).
- Proof is private and must be cleaned when task leaves valid proof window.

### 7.5 Recurrence

- Active recurrence rules generate tasks on schedule in rule timezone at 00:00.
- Generated tasks inherit profile-based default warning reminders.
- If a user attaches a custom reminder to a specific iteration (e.g. iteration #5) it does not apply to other iterations. If the recurrence rule itself is created with custom reminders, those apply to all iterations.
- Event recurrence populates Google sync fields and enqueues outbox work.

### 7.6 Pomodoro

- Only one `ACTIVE` or `PAUSED` session per user at a time.
- Counted completions append `POMO_COMPLETED` event.

### 7.7 Google Calendar integration

- OAuth connect/disconnect.
- Calendar selection.
- Directional toggles: app→Google and Google→app.
- Import filter toggle for tagged events.
- Background sweeper/dispatch/watch-renew behavior preserved.

## 8) Settings/default semantics

Profile defaults affect future behavior only.

- Default voucher/cost/pomodoro/event duration for newly created items.
- Currency influences validation and formatting.
- 1h/10m warning toggles affect seeded default reminders.
- Voucher active-task visibility toggle governs voucher visibility for owner active tasks.

## 9) Non-functional requirements

- Strong DB consistency on committed writes.
- Eventual cross-device consistency via realtime + refresh.
- Security via Supabase Auth + RLS + server-side authorization checks.
- Auditability through task events + ledger entries.
- Preserve known idempotency caveats from web runtime where they currently exist.

## 10) Mobile-specific implementation constraints

- Mobile MUST preserve backend behavior, not web presentation.
- Mobile MUST not bypass backend invariants for status transitions, proof flow, ledger writes, or limits.
- Mobile SHOULD support degraded connectivity with explicit reconciliation after reconnect.
- Mobile SHOULD keep local optimistic state small and always reconcile against server truth.

## 11) Source of truth and traceability

- Product baseline source: `vouch-web/PRD.md`.
- Backend/runtime source: `vouch-web/SYSTEM_SPEC.md`.
- Shared TypeScript types: Section 13 of this document (derived from `vouch-web/src/lib/types.ts` and DB migrations).
- If this PRD conflicts with those sources, ask Tarun.

---

## 12) System Contracts (Merged Canonical Section)

This section is merged from the previous `SYSTEM_SPEC.md` and is now part of the PRD ground truth.

### 12.1 Scope and intent

This specification defines the required runtime behavior for `vouch-mobile`.
It preserves business invariants from `vouch-web/SYSTEM_SPEC.md` while allowing a new mobile-native UI/UX.

If mobile client behavior conflicts with backend invariants, backend invariants win.

### 12.2 Reference model and source of truth

- Canonical product behavior: `vouch-web/PRD.md`.
- Canonical backend/runtime contracts: `vouch-web/SYSTEM_SPEC.md`.
- This document is the mobile adaptation layer and delivery contract.

### 12.3 Architecture requirements

#### 12.3.1 System components

- Mobile app client (iOS/Android, React Native via Expo) for presentation, local interaction state, and device capabilities.
- Existing backend authority (Supabase + server-side write paths + scheduled jobs from Trigger.dev).
- Supabase Edge Functions as the BFF layer for all complex write operations that require server-side business logic (see section 12.5).

#### 12.3.2 Authority and conflict precedence

- Postgres constraints + RLS policies are final authority.
- Server-side mutation logic (Edge Functions) is second authority.
- Mobile optimistic state is advisory only and must reconcile with server state.

#### 12.3.3 Data consistency model

- Committed writes are strongly consistent in DB.
- Cross-device/mobile synchronization is eventually consistent.
- Mobile MUST reconcile after reconnect/app foreground/realtime reconnect.

### 12.4 Domain invariants to preserve

Mobile MUST preserve all invariants below.

#### 12.4.1 Task status lifecycle

Valid statuses (DB-canonical):
```
ACTIVE | POSTPONED | MARKED_COMPLETE | AWAITING_VOUCHER |
AWAITING_ORCA | ORCA_DENIED | AWAITING_USER | ESCALATED |
ACCEPTED | AUTO_ACCEPTED | ORCA_ACCEPTED |
DENIED | MISSED | RECTIFIED | SETTLED | DELETED
```

Main runtime transitions:
- `create` → `ACTIVE`
- `postpone once` → `POSTPONED`
- `mark complete (self-vouch)` → `MARKED_COMPLETE` → `ACCEPTED`
- `mark complete (human voucher)` → `MARKED_COMPLETE` → `AWAITING_VOUCHER`
- `voucher accept` → `ACCEPTED`
- `voucher deny` → `DENIED`
- `system voucher timeout` → `AUTO_ACCEPTED` (+ voucher penalty)
- `deadline pass` → `MISSED`
- `rectify (voucher)` → `RECTIFIED`
- `override (owner)` → `SETTLED`
- `owner hard delete within window` → `DELETED`

#### 12.4.2 Monetary and quota rules

- Failure cost cents must remain within DB bounds `1..100000`.
- App validation bounds by currency:
  - EUR/USD: `1.00..100.00`
  - INR: `50..1000`
- Rectify passes: max 5/month/user (per voucher-user pair).
- Override: max 1/month per owner.
- Voucher timeout penalty: exactly `30` cents.

#### 12.4.3 Time windows

- Owner hard delete window: 10 minutes from creation.
- Rectify window: until the end of the current calendar month (`YYYY-MM` period match).
- Voucher response deadline: timezone-aware, around +2 local days from completion mark, end-of-day.

#### 12.4.4 Proof handling

- Proof upload states: `PENDING | UPLOADED | FAILED`.
  - `PENDING`: proof row exists, upload in progress or required before completion.
  - `UPLOADED`: proof stored and accessible to owner/voucher.
  - `FAILED`: upload failed; can be retried or removed.
- The `requires_proof` field on a task indicates proof is mandatory before completion.
- The `has_proof` field indicates a proof row exists.
- Proof access must remain restricted to owner/voucher while task is within allowed review state/window.
- Proof artifacts must be purged when task exits proof-valid conditions or proof expires.

#### 12.4.5 Pomodoro invariants

- Session status: `ACTIVE | PAUSED | COMPLETED | DELETED`.
- Only one `ACTIVE` or `PAUSED` session per user at a time.

#### 12.4.6 Visibility and self-vouch rules

- Self-vouch completion bypasses voucher queue (resolves directly to `ACCEPTED`).
- Voucher pending/history excludes self-vouch tasks.
- Voucher active-task visibility is controlled by owner setting (`voucher_can_view_active_tasks`).

### 12.5 Required backend operation surface for mobile

Mobile MUST have server-backed operations equivalent to the web runtime behavior.
**Simple reads** can be handled by direct Supabase client queries (RLS enforces access).
**Complex writes** require Supabase Edge Functions that contain the same business logic as `vouch-web` server actions. Mobile agents MUST NOT attempt to replicate complex multi-step write logic in the client — create an Edge Function instead.

#### Classification of operations

| Operation | Approach |
|-----------|----------|
| Fetch tasks, profile, friends, ledger | Direct Supabase query |
| Subscribe to realtime changes | Supabase Realtime channel |
| Create task (simple) | Direct Supabase insert |
| Create task (full: reminders, subtasks, recurrence, event tokens) | Edge Function |
| Complete task / mark complete | Edge Function |
| Undo completion | Edge Function |
| Postpone task | Edge Function |
| Owner hard delete | Edge Function |
| Override (monthly) | Edge Function |
| Voucher accept/deny/request proof | Edge Function |
| Rectify | Edge Function |
| Proof init / finalize / remove | Edge Function |
| Pomodoro start/pause/resume/end | Edge Function |
| Google Calendar connect/disconnect/toggles | Edge Function |
| Register/deregister Expo push token | Direct Supabase insert/delete |

#### 12.5.1 Auth/profile

- Sign in, sign up, password reset, sign out, delete account.
- Fetch/update profile defaults, username, tips visibility.

#### 12.5.2 Friends

- Add friend, remove friend (with pending-task guard), list friends, friend activity summary.

#### 12.5.3 Task lifecycle

- Create task (simple and full payload variants acceptable).
- Complete task (with self-vouch vs voucher path semantics).
- Undo completion and proof-failure reversion.
- Postpone task.
- Owner hard delete in allowed window.
- Override.
- Read task detail/events/pomodoro summary.

#### 12.5.4 Subtasks/reminders

- Add/toggle/edit/delete subtasks.
- Replace future reminders while preserving past reminder history behavior.

#### 12.5.5 Voucher operations

- Accept, deny, request proof, rectify.
- Fetch pending requests/count/history/failed-rectify surfaces.

#### 12.5.6 Pomodoro operations

- Start, pause, resume, end, and get active session snapshot.

#### 12.5.7 Proof operations

- Initialize proof upload intent.
- Finalize proof upload with metadata verification.
- Remove proof.
- Fetch proof media with strict access checks.

#### 12.5.8 Google Calendar operations

- OAuth connect start/callback.
- Get integration state.
- Select calendar.
- Toggle sync directions (app→Google, Google→app).
- Toggle tagged-import-only mode.
- Disconnect and forget integration rows.

### 12.6 Working flow requirements

#### 12.6.1 Core owner flow

1. User creates task with voucher, deadline, cost, optional extras.
2. User works task, logs optional pomodoro sessions.
3. User marks complete before deadline.
4. If voucher required, task waits for voucher decision.
5. Final state lands in completed/failed/recovered variants.

#### 12.6.2 Core voucher flow

1. Voucher sees pending queue.
2. Voucher accepts/denies/requests proof.
3. Voucher can rectify failed task within policy window and quota.
4. Voucher may soft-delete assigned non-final tasks.

#### 12.6.3 System automation flow

- Deadline fail job checks overdue active tasks.
- Voucher timeout job auto-accepts overdue voucher reviews and applies penalty.
- Reminder jobs deliver reminders and warning events.
- Recurrence generator creates new tasks from active rules.
- Proof cleanup removes stale/invalid proof artifacts.
- Monthly settlement sends summary emails.
- Google sync jobs dispatch outbox work, sync connections, and renew watches.

### 12.7 Realtime and sync behavior

- Mobile SHOULD subscribe to user-relevant task/friend/pomodoro changes.
- Mobile SHOULD patch local lists only when incoming row freshness is newer/equal by authoritative timestamps.
- Mobile MUST issue periodic or lifecycle-based reconciliation refreshes (foreground, reconnect, explicit pull-to-refresh).
- Mobile optimistic updates MUST be rollbackable.

### 12.8 Security and authorization

- All writes require authenticated user context.
- Access checks must enforce owner/voucher relationship and state preconditions.
- Proof media endpoint must enforce strict auth + task-state + deadline checks.
- Mobile must not embed privileged service-role keys in client binaries. Use the anon key only.

### 12.9 Known runtime caveats to preserve

- Some backend transitions can produce duplicate side effects under race/retry conditions.
- Reminder dispatcher may mark reminder as notified even when delivery fails.
- Deadline fail can run in both read-side and scheduled contexts, creating duplicate financial/event side effects in rare races.

Mobile implementation must tolerate these realities and always render from server truth.

### 12.10 Validation checklist for parity

A mobile release is parity-compliant only if the following are true:

1. Task transition outcomes match web runtime for each status-changing action.
2. Ledger impacts match web runtime for failure, rectify, override, timeout penalty.
3. Quotas and windows match web runtime limits exactly.
4. Voucher visibility/self-vouch rules match web runtime.
5. Proof lifecycle and access checks match web runtime.
6. Pomodoro strict/non-strict counting behavior matches web runtime.
7. Background automation side effects are reflected correctly in mobile views.
8. Google Calendar directional sync toggles and disconnect behavior match web runtime.

---

## 13) Data Schemas

These TypeScript types are derived from DB migrations and `vouch-web/src/lib/types.ts`. They are the canonical shapes for all data the mobile app reads from and writes to Supabase. Mobile agents MUST use these types verbatim — do not infer types from Supabase codegen without cross-checking here.

```typescript
// ─── Enums ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "ACTIVE"
  | "POSTPONED"
  | "MARKED_COMPLETE"
  | "AWAITING_VOUCHER"
  | "AWAITING_ORCA"
  | "ORCA_DENIED"
  | "AWAITING_USER"
  | "ESCALATED"
  | "ACCEPTED"
  | "AUTO_ACCEPTED"
  | "ORCA_ACCEPTED"
  | "DENIED"
  | "MISSED"
  | "RECTIFIED"
  | "SETTLED"
  | "DELETED";

export type Currency = "EUR" | "USD" | "INR";

export type LedgerEntryType =
  | "failure"
  | "rectified"
  | "override"
  | "voucher_timeout_penalty";

export type ProofUploadState = "PENDING" | "UPLOADED" | "FAILED";

export type PomoStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "DELETED";

export type ReminderSource =
  | "MANUAL"
  | "DEFAULT_DEADLINE_1H"
  | "DEFAULT_DEADLINE_10M";

export type RecurrenceFrequency =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY"
  | "WEEKDAYS"
  | "CUSTOM";

export type CommitmentStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "FAILED";

export type GoogleSyncOrigin = "APP" | "GOOGLE";

export type GoogleSyncIntent = "UPSERT" | "DELETE";

export type GoogleSyncStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

// ─── Core entities ────────────────────────────────────────────────────────────

export interface Profile {
  id: string;                                   // UUID, references auth.users
  email: string;
  username: string;
  currency: Currency;
  default_pomo_duration_minutes: number;        // 1..720
  default_event_duration_minutes: number;       // 1..720
  default_failure_cost_cents: number;           // 1..100000
  default_voucher_id: string | null;
  strict_pomo_enabled: boolean;
  deadline_one_hour_warning_enabled: boolean;
  deadline_final_warning_enabled: boolean;      // 10-min warning
  voucher_can_view_active_tasks: boolean;
  mobile_notifications_enabled: boolean;
  hide_tips: boolean;
  lifetime_xp: number;
  display_xp_bar_on_dashboard: boolean;
  display_rp_bar_on_dashboard: boolean;
  abandoned_commitments_count: number;
  orca_friend_opt_in: boolean;
  created_at: string;                           // ISO 8601
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
  failure_cost_cents: number;                   // 1..100000
  deadline: string;                             // ISO 8601
  status: TaskStatus;
  postponed_at: string | null;
  marked_completed_at: string | null;
  voucher_response_deadline: string | null;
  recurrence_rule_id: string | null;
  iteration_number: number | null;              // > 0, required when recurrence_rule_id set
  start_at: string | null;                      // optional submission window start
  is_strict: boolean;                           // enforces [start_at, deadline] window
  required_pomo_minutes: number | null;         // 1..10000
  requires_proof: boolean;
  has_proof: boolean;
  proof_request_open: boolean;
  proof_requested_at: string | null;
  proof_requested_by: string | null;
  google_sync_for_task: boolean;
  google_event_start_at: string | null;
  google_event_end_at: string | null;
  google_event_color_id: string | null;         // "1".."11"
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
  bucket: "task-proofs";
  object_path: string;
  media_kind: "image" | "video";
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;                   // max 30000 ms (30 s)
  overlay_timestamp_text: string;
  upload_state: ProofUploadState;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  event_type:
    | "ACTIVE" | "MARK_COMPLETE" | "UNDO_COMPLETE"
    | "PROOF_UPLOADED" | "PROOF_UPLOAD_FAILED_REVERT" | "PROOF_REMOVED" | "PROOF_REQUESTED"
    | "VOUCHER_ACCEPT" | "VOUCHER_DENY" | "VOUCHER_DELETE"
    | "RECTIFY" | "OVERRIDE" | "DEADLINE_MISSED" | "VOUCHER_TIMEOUT"
    | "POMO_COMPLETED" | "DEADLINE_WARNING_1H" | "DEADLINE_WARNING_5M"
    | "GOOGLE_EVENT_CANCELLED" | "POSTPONE"
    | "AI_APPROVE" | "AI_DENY" | "ORCA_DENIED_AUTO_HOP"
    | "ESCALATE" | "AI_ESCALATE_TO_HUMAN" | "ACCEPT_DENIAL";
  actor_id: string | null;
  from_status: TaskStatus;
  to_status: TaskStatus;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  task_id: string;
  period: string;                               // YYYY-MM
  amount_cents: number;
  entry_type: LedgerEntryType;
  created_at: string;
}

export interface RectifyPass {
  id: string;
  user_id: string;
  task_id: string;
  authorized_by: string;                        // voucher's profile id
  period: string;                               // YYYY-MM
  created_at: string;
}

export interface Override {
  id: string;
  user_id: string;
  task_id: string;
  period: string;                               // YYYY-MM
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
  days_of_week?: number[];                      // 0=Sun, 1=Mon, …, 6=Sat
  time_of_day: string;                          // HH:MM
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
  google_event_duration_minutes: number | null;
  google_event_color_id: string | null;         // "1".."11"
  manual_reminder_offsets_ms: number[] | null;
  last_generated_date: string | null;           // YYYY-MM-DD
  latest_iteration: number;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarConnection {
  user_id: string;
  google_account_email: string | null;
  selected_calendar_id: string | null;
  selected_calendar_summary: string | null;
  sync_app_to_google_enabled: boolean;
  sync_google_to_app_enabled: boolean;
  import_only_tagged_google_events: boolean;
  token_expires_at: string | null;
  watch_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  // Encrypted fields — never sent to client:
  // encrypted_access_token, encrypted_refresh_token
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
  pending_display_type: "ACTIVE" | "AWAITING_VOUCHER";
  pending_deadline_at: string | null;
  pending_actionable: boolean;
  proof_request_count: number;
  rectify_passes_used: number;
}

export interface FriendPomoActivity {
  friend_id: string;
  friend_username: string;
  status: "ACTIVE" | "PAUSED";
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}
```

---

## 14) Tech Stack

### 14.1 Core framework

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime | **Expo SDK 52+** | Managed workflow; Expo push tokens already in DB |
| Navigation | **Expo Router v4** | File-based routing, matches Next.js mental model from vouch-web |
| Language | **TypeScript** | Same as vouch-web |

### 14.2 Data and state

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Backend client | **@supabase/supabase-js ^2.x** | Same version as vouch-web; shared DB |
| Server state / caching | **TanStack Query v5** | Optimistic updates, background refetch, stale-while-revalidate |
| Local/UI state | **Zustand** | Lightweight; handles pomodoro timer state, form drafts |
| Realtime | **Supabase Realtime** (built into supabase-js) | Same channels as web |
| Secure token storage | **expo-secure-store** | Never use AsyncStorage for auth tokens |
| Form management | **react-hook-form + zod** | Same libraries as vouch-web; share zod schemas where possible |
| State machine | **xstate v5** | Same as vouch-web; reuse `task-machine.ts` logic for advisory transitions |

### 14.3 UI and styling

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Styling | **NativeWind v4** | Tailwind syntax for React Native; matches vouch-web Tailwind classes conceptually |
| Animations | **react-native-reanimated v3** | Required by gesture handler; performant on native thread |
| Gestures | **react-native-gesture-handler** | Standard for Expo apps |
| Icons | **lucide-react-native** | Same icon set as vouch-web (lucide-react) |

### 14.4 Device capabilities

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Push notifications | **expo-notifications** | Expo push token table already in DB (migration 085) |
| Media picker (proof) | **expo-image-picker** | Image and video; enforces 30 s max video constraint client-side |
| Camera (proof) | **expo-camera** | Direct capture for proof |
| Date/time | **date-fns** | Consistent with vouch-web date formatting patterns |
| Haptics | **expo-haptics** | Lightweight feedback on actions |

### 14.5 Development tooling

| Concern | Choice |
|---------|--------|
| Linting | ESLint + `eslint-config-expo` |
| Type checking | TypeScript strict mode |
| Testing | Jest + `@testing-library/react-native` |
| E2E | Maestro (mobile-native, simpler than Detox for Expo) |

### 14.6 Supabase client setup (mobile)

```typescript
// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
```

---

## 15) Interoperability Contract

### Why agents do NOT need to read vouch-web source code

Both `vouch-web` and `vouch-mobile` operate against the **same Supabase project** (same DB, same RLS policies, same edge functions). Interoperability is guaranteed at the DB and Edge Function layer, not at the source code layer.

Mobile agents have everything they need inside this document:

| Need | Where it lives in this PRD |
|------|---------------------------|
| Status enum + transitions | Sections 6.1 and 12.4.1 |
| Business rules (costs, limits, windows) | Sections 6.2, 6.3, 12.4.2, 12.4.3 |
| TypeScript types for all DB rows | Section 13 |
| Which operations need Edge Functions vs direct queries | Section 12.5 (classification table) |
| Tech stack + Supabase client setup | Section 14 |

### When an agent encounters a gap

If a mobile agent cannot determine the correct behavior from this PRD alone, the escalation order is:

1. Check `vouch-web/SYSTEM_SPEC.md` for runtime contracts.
2. Check `vouch-web/PRD.md` for product intent.
3. Check DB migration files in `vouch-web/supabase/migrations/` for exact constraints.
4. Ask Tarun — do not guess at business logic involving money or status transitions.

### Edge Function naming convention

Edge Functions that mirror vouch-web server actions should be named using the pattern:
`/<domain>/<action>` (e.g. `/tasks/complete`, `/voucher/rectify`, `/tasks/create-full`).

They accept JSON bodies and return `ApiResponse<T>` (see Section 13). Always call them via the authenticated Supabase client so the user JWT is forwarded automatically:

```typescript
const { data, error } = await supabase.functions.invoke("tasks/complete", {
  body: { taskId, proofMetadata },
});
```
