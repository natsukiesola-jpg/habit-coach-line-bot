-- パーソナル受講生への宿題配信
-- Supabase の SQL Editor に貼り付けて 1 回だけ実行してください。
-- 本名・体の悩みなどの個人情報は入れず、label には呼び名（例: Aさん）だけを入れます。

create table if not exists homework_students (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  invite_code text not null unique,
  line_user_id text unique,
  must_item text not null,
  opt_item text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists homework_logs (
  id bigint generated always as identity primary key,
  student_id uuid not null references homework_students(id) on delete cascade,
  log_date date not null,
  must_item text not null,
  opt_item text,
  sent_at timestamptz,
  result text check (result in ('both', 'must', 'none')),
  answered_at timestamptz,
  unique (student_id, log_date)
);

-- サーバー（service role key）からだけ読み書きする。公開キーからは見えない。
alter table homework_students enable row level security;
alter table homework_logs enable row level security;
