-- Test task seeder (no descriptions, no subtasks)
-- user_id:   183a123c-c9be-414f-888a-a8d784ed13ac
-- voucher_id: 5c4a5687-d5de-4f05-8107-e710f6931caf

DO $$
DECLARE
  v_user_id    uuid := '183a123c-c9be-414f-888a-a8d784ed13ac';
  v_voucher_id uuid := '5c4a5687-d5de-4f05-8107-e710f6931caf';
BEGIN
  INSERT INTO tasks (user_id, voucher_id, title, failure_cost_cents, deadline, status)
  VALUES
    (v_user_id, v_voucher_id, 'Read 20 pages of Atomic Habits', 500,  now() + interval '3 days',  'ACTIVE'),
    (v_user_id, v_voucher_id, 'Morning workout session',         1000, now() + interval '1 day',   'ACTIVE'),
    (v_user_id, v_voucher_id, 'Write project proposal draft',    2000, now() + interval '7 days',  'ACTIVE'),
    (v_user_id, v_voucher_id, 'Review and merge open pull requests', 750, now() + interval '2 days', 'ACTIVE'),
    (v_user_id, v_voucher_id, 'Call mom',                        300,  now() + interval '14 days', 'ACTIVE');
END $$;
