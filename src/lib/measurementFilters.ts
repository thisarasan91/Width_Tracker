const IST_OFFSET = "+05:30";

export type MeasurementFilters = {
  deviceId: string;
  programId: string;
  from: string;
  to: string;
};

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function readMeasurementFilters(searchParams: Record<string, string | string[] | undefined>): MeasurementFilters {
  return {
    deviceId: firstParam(searchParams.device_id).trim(),
    programId: firstParam(searchParams.program_id).trim(),
    from: firstParam(searchParams.from).trim(),
    to: firstParam(searchParams.to).trim()
  };
}

export function localInputToTimestamptz(value: string, endOfDay = false) {
  if (!value) {
    return "";
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${endOfDay ? "23:59:59" : "00:00:00"}${IST_OFFSET}`;
  }

  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}${IST_OFFSET}`;
}

export function buildFilterQueryString(filters: MeasurementFilters) {
  const params = new URLSearchParams();

  if (filters.deviceId) {
    params.set("device_id", filters.deviceId);
  }
  if (filters.programId) {
    params.set("program_id", filters.programId);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }

  return params.toString();
}
