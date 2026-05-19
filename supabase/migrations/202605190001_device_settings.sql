create table public.device_settings (
  device_id uuid primary key references public.devices(id) on delete cascade,
  edge_settings jsonb not null default '{}'::jsonb,
  app_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint device_settings_edge_is_object check (jsonb_typeof(edge_settings) = 'object'),
  constraint device_settings_app_is_object check (jsonb_typeof(app_settings) = 'object')
);

create trigger device_settings_set_updated_at
before update on public.device_settings
for each row execute function public.set_updated_at();

alter table public.device_settings enable row level security;

create policy "web users can read device settings"
on public.device_settings for select
to authenticated
using (true);

create policy "web users can create device settings"
on public.device_settings for insert
to authenticated
with check (true);

create policy "web users can update device settings"
on public.device_settings for update
to authenticated
using (true)
with check (true);

create policy "web users can delete device settings"
on public.device_settings for delete
to authenticated
using (true);
