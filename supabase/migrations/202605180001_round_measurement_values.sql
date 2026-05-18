update public.measurements
set reading_value = round(reading_value, 2)
where reading_value is not null;

alter table public.measurements
alter column reading_value type numeric(12, 2)
using round(reading_value, 2);
