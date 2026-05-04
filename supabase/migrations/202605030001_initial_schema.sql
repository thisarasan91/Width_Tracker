create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null,
  serial_number text not null unique,
  status text not null default 'offline' check (status in ('online', 'offline')),
  last_seen_at timestamptz,
  location text,
  loom_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.device_api_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  program_name text not null,
  batch_name text,
  elastic_development_reference text,
  description text,
  required_data_points_per_measurement integer not null check (required_data_points_per_measurement > 0),
  labels_for_each_reading jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labels_for_each_reading_is_array check (jsonb_typeof(labels_for_each_reading) = 'array'),
  constraint labels_match_required_data_points check (
    jsonb_array_length(labels_for_each_reading) = required_data_points_per_measurement
  )
);

create table public.device_program_assignments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  is_active boolean not null default true
);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete restrict,
  program_id uuid not null references public.programs(id) on delete restrict,
  assignment_id uuid references public.device_program_assignments(id) on delete set null,
  measurement_session_id uuid not null,
  reading_label text not null,
  reading_value numeric(12, 4) not null,
  unit text not null default 'mm',
  operator_name text,
  loom_name text,
  sent_at timestamptz not null,
  stored_at timestamptz not null default now(),
  cloud_verification_status text not null default 'stored' check (
    cloud_verification_status in ('pending', 'stored', 'failed')
  ),
  created_at timestamptz not null default now()
);

create trigger devices_set_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

create trigger programs_set_updated_at
before update on public.programs
for each row execute function public.set_updated_at();

create unique index device_program_assignments_one_active_pair
on public.device_program_assignments(device_id, program_id)
where is_active;

create index devices_status_last_seen_idx on public.devices(status, last_seen_at desc);
create index device_api_tokens_device_idx on public.device_api_tokens(device_id);
create index programs_active_idx on public.programs(is_active);
create index assignments_device_active_idx on public.device_program_assignments(device_id, is_active);
create index assignments_program_active_idx on public.device_program_assignments(program_id, is_active);
create index measurements_device_stored_idx on public.measurements(device_id, stored_at desc);
create index measurements_program_stored_idx on public.measurements(program_id, stored_at desc);
create index measurements_session_idx on public.measurements(measurement_session_id);
