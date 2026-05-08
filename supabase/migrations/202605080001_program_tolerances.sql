alter table public.programs
add column if not exists nominal_width numeric(12, 4),
add column if not exists upper_tolerance numeric(12, 4),
add column if not exists lower_tolerance numeric(12, 4);

alter table public.programs
add constraint programs_nominal_width_positive check (nominal_width is null or nominal_width > 0),
add constraint programs_upper_tolerance_non_negative check (upper_tolerance is null or upper_tolerance >= 0),
add constraint programs_lower_tolerance_non_negative check (lower_tolerance is null or lower_tolerance >= 0);
