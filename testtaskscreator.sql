-- Test task seeder
-- user_id:   183a123c-c9be-414f-888a-a8d784ed13ac
-- voucher_id: 5c4a5687-d5de-4f05-8107-e710f6931caf

DO $$
DECLARE
  v_user_id    uuid := '183a123c-c9be-414f-888a-a8d784ed13ac';
  v_voucher_id uuid := '5c4a5687-d5de-4f05-8107-e710f6931caf';
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid;
BEGIN

  -- Task 1 (with subtasks)
  INSERT INTO tasks (user_id, voucher_id, title, description, failure_cost_cents, deadline, status)
  VALUES (
    v_user_id, v_voucher_id,
    'Read 20 pages of Atomic Habits',
    'Focus on chapters related to habit stacking and environment design.',
    500,
    now() + interval '3 days',
    'ACTIVE'
  ) RETURNING id INTO t1;

  INSERT INTO task_subtasks (parent_task_id, user_id, title) VALUES
    (t1, v_user_id, 'Read chapters 1–3'),
    (t1, v_user_id, 'Write a 3-line summary of key takeaways');

  -- Task 2 (with subtasks)
  INSERT INTO tasks (user_id, voucher_id, title, description, failure_cost_cents, deadline, status)
  VALUES (
    v_user_id, v_voucher_id,
    'Morning workout session',
    '45-minute session combining cardio and strength training.',
    1000,
    now() + interval '1 day',
    'ACTIVE'
  ) RETURNING id INTO t2;

  INSERT INTO task_subtasks (parent_task_id, user_id, title) VALUES
    (t2, v_user_id, '30 min cardio (run or bike)'),
    (t2, v_user_id, '15 min core and stretching');

  -- Task 3 (no subtasks)
  INSERT INTO tasks (user_id, voucher_id, title, description, failure_cost_cents, deadline, status)
  VALUES (
    v_user_id, v_voucher_id,
    'Write project proposal draft',
    'First draft of the Q3 product proposal, at least 500 words.',
    2000,
    now() + interval '7 days',
    'ACTIVE'
  ) RETURNING id INTO t3;

  -- Task 4 (no subtasks)
  INSERT INTO tasks (user_id, voucher_id, title, description, failure_cost_cents, deadline, status)
  VALUES (
    v_user_id, v_voucher_id,
    'Review and merge open pull requests',
    'Go through all open PRs in the repo and either merge or leave a review comment.',
    750,
    now() + interval '2 days',
    'ACTIVE'
  ) RETURNING id INTO t4;

  -- Task 5 (no subtasks)
  INSERT INTO tasks (user_id, voucher_id, title, description, failure_cost_cents, deadline, status)
  VALUES (
    v_user_id, v_voucher_id,
    'Call mom',
    'Catch up call, at least 15 minutes.',
    300,
    now() + interval '14 days',
    'ACTIVE'
  ) RETURNING id INTO t5;

END $$;
