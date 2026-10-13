-- CCP Extension backend: candidate memory, resumes, discovered jobs, applications,
-- market skills, ATS question bank and AI usage log. Every candidate row is owned by the
-- signed-in user (auth.uid()); shared reference tables are read-only for users and written
-- only by the edge functions (admin key).

create table if not exists public.candidates (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  address_line text,
  city text,
  state text,
  zip text,
  country text default 'United States',
  linkedin_url text,
  website_url text,
  field text,
  years_experience numeric,
  target_titles text[] default '{}',
  target_locations text[] default '{}',
  work_authorization text,
  needs_sponsorship_now boolean,
  needs_sponsorship_future text,
  veteran_status text default 'decline',
  gender text default 'decline',
  race_ethnicity text default 'decline',
  disability_status text default 'decline',
  desired_salary text,
  available_from text,
  willing_to_relocate boolean,
  has_drivers_license boolean,
  over_18 boolean default true,
  education jsonb default '[]'::jsonb,
  employment jsonb default '[]'::jsonb,
  extra_answers jsonb default '{}'::jsonb,
  rules text,
  blocked_terms text,
  access_ok boolean default false,
  plan text default 'free',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  label text,
  file_name text,
  storage_key text,
  blocks_text text,
  is_default boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source text,
  ats text,
  company text,
  title text,
  location text,
  url text not null,
  apply_url text,
  description text,
  years_required int,
  skills text[] default '{}',
  score numeric,
  status text default 'found',
  found_at timestamptz default now(),
  applied_at timestamptz,
  unique (candidate_id, url)
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  job_url text,
  company text,
  title text,
  ats text,
  resume_file_name text,
  resume_storage_key text,
  answers jsonb default '{}'::jsonb,
  changes jsonb default '[]'::jsonb,
  status text default 'prepared',
  submitted_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ats text not null,
  token text not null,
  fields text[] default '{}',
  locations text[] default '{}',
  careers_url text,
  active boolean default true,
  added_by uuid,
  created_at timestamptz default now(),
  unique (ats, token)
);

create table if not exists public.market_skills (
  id uuid primary key default gen_random_uuid(),
  field text not null,
  years_band text not null,
  software text not null,
  demand numeric default 0,
  sources int default 0,
  updated_at timestamptz default now(),
  unique (field, years_band, software)
);

create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  pattern text not null unique,
  canonical_key text not null,
  answer_type text,
  hits int default 1,
  created_at timestamptz default now()
);

create table if not exists public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.candidates(id) on delete set null,
  kind text,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  created_at timestamptz default now()
);

create index if not exists jobs_candidate_status_idx on public.jobs (candidate_id, status, found_at desc);
create index if not exists applications_candidate_idx on public.applications (candidate_id, created_at desc);
create index if not exists market_skills_field_idx on public.market_skills (field, years_band, demand desc);
create index if not exists companies_ats_idx on public.companies (ats, active);
create index if not exists ai_calls_candidate_idx on public.ai_calls (candidate_id, created_at desc);

-- updated_at maintenance
drop trigger if exists candidates_updated_at on public.candidates;
create trigger candidates_updated_at before update on public.candidates
  for each row execute function system.update_updated_at();

-- Row level security
alter table public.candidates enable row level security;
alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.companies enable row level security;
alter table public.market_skills enable row level security;
alter table public.question_bank enable row level security;
alter table public.ai_calls enable row level security;

grant usage on schema public to anon, authenticated;

-- candidates: own row only; access_ok and plan are set by the functions (admin), never by the user
drop policy if exists "candidate reads own" on public.candidates;
create policy "candidate reads own" on public.candidates for select to authenticated using (id = (select auth.uid()));
drop policy if exists "candidate inserts own" on public.candidates;
create policy "candidate inserts own" on public.candidates for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "candidate updates own" on public.candidates;
create policy "candidate updates own" on public.candidates for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke all on public.candidates from anon;
revoke insert, update, delete on public.candidates from authenticated;
grant select on public.candidates to authenticated;
grant insert (id, email, full_name, first_name, last_name, phone, address_line, city, state, zip, country, linkedin_url, website_url, field, years_experience, target_titles, target_locations, work_authorization, needs_sponsorship_now, needs_sponsorship_future, veteran_status, gender, race_ethnicity, disability_status, desired_salary, available_from, willing_to_relocate, has_drivers_license, over_18, education, employment, extra_answers, rules, blocked_terms) on public.candidates to authenticated;
grant update (email, full_name, first_name, last_name, phone, address_line, city, state, zip, country, linkedin_url, website_url, field, years_experience, target_titles, target_locations, work_authorization, needs_sponsorship_now, needs_sponsorship_future, veteran_status, gender, race_ethnicity, disability_status, desired_salary, available_from, willing_to_relocate, has_drivers_license, over_18, education, employment, extra_answers, rules, blocked_terms) on public.candidates to authenticated;

-- per-candidate tables
drop policy if exists "own resumes" on public.resumes;
create policy "own resumes" on public.resumes for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
drop policy if exists "own applications" on public.applications;
create policy "own applications" on public.applications for all to authenticated using (candidate_id = (select auth.uid())) with check (candidate_id = (select auth.uid()));
drop policy if exists "own ai calls" on public.ai_calls;
create policy "own ai calls" on public.ai_calls for select to authenticated using (candidate_id = (select auth.uid()));
revoke all on public.resumes, public.jobs, public.applications, public.ai_calls from anon;
revoke insert, update, delete on public.ai_calls from authenticated;
grant select, insert, update, delete on public.resumes, public.jobs, public.applications to authenticated;
grant select on public.ai_calls to authenticated;

-- shared reference tables: read-only for signed-in users, written by the functions
drop policy if exists "read companies" on public.companies;
create policy "read companies" on public.companies for select to authenticated using (active);
drop policy if exists "read market skills" on public.market_skills;
create policy "read market skills" on public.market_skills for select to authenticated using (true);
drop policy if exists "read question bank" on public.question_bank;
create policy "read question bank" on public.question_bank for select to authenticated using (true);
revoke all on public.companies, public.market_skills, public.question_bank from anon;
revoke insert, update, delete on public.companies, public.market_skills, public.question_bank from authenticated;
grant select on public.companies, public.market_skills, public.question_bank to authenticated;
