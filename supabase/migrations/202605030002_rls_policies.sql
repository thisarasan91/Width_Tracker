alter table public.devices enable row level security;
alter table public.device_api_tokens enable row level security;
alter table public.programs enable row level security;
alter table public.device_program_assignments enable row level security;
alter table public.measurements enable row level security;

create policy "web users can read devices"
on public.devices for select
to authenticated
using (true);

create policy "web users can create devices"
on public.devices for insert
to authenticated
with check (true);

create policy "web users can update devices"
on public.devices for update
to authenticated
using (true)
with check (true);

create policy "web users can delete devices"
on public.devices for delete
to authenticated
using (true);

create policy "web users can read programs"
on public.programs for select
to authenticated
using (true);

create policy "web users can create programs"
on public.programs for insert
to authenticated
with check (true);

create policy "web users can update programs"
on public.programs for update
to authenticated
using (true)
with check (true);

create policy "web users can delete programs"
on public.programs for delete
to authenticated
using (true);

create policy "web users can read assignments"
on public.device_program_assignments for select
to authenticated
using (true);

create policy "web users can create assignments"
on public.device_program_assignments for insert
to authenticated
with check (true);

create policy "web users can update assignments"
on public.device_program_assignments for update
to authenticated
using (true)
with check (true);

create policy "web users can delete assignments"
on public.device_program_assignments for delete
to authenticated
using (true);

create policy "web users can read measurements"
on public.measurements for select
to authenticated
using (true);

create policy "web users can update measurement verification"
on public.measurements for update
to authenticated
using (true)
with check (true);

-- No authenticated-user policies are defined for public.device_api_tokens.
-- Device tokens are created and checked only by trusted server code using the service-role key.
