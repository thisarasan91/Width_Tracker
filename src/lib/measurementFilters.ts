const IST_OFFSET = "+05:30";

export type MeasurementFilters = {
  deviceId: string;
  programId: string;
  from: string;
  to: string;
  values: string[];
  valueFilterActive: boolean;
};

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function allParams(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

export function searchParamsToRecord(searchParams: URLSearchParams) {
  const record: Record<string, string | string[] | undefined> = {};

  for (const key of Array.from(new Set(searchParams.keys()))) {
    const values = searchParams.getAll(key);
    record[key] = values.length > 1 ? values : values[0] ?? "";
  }

  return record;
}

export function normalizeMeasurementValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

export function readMeasurementFilters(searchParams: Record<string, string | string[] | undefined>): MeasurementFilters {
  const values = Array.from(
    new Set(allParams(searchParams.values).map((value) => normalizeMeasurementValue(value)).filter(Boolean))
  );

  return {
    deviceId: firstParam(searchParams.device_id).trim(),
    programId: firstParam(searchParams.program_id).trim(),
    from: firstParam(searchParams.from).trim(),
    to: firstParam(searchParams.to).trim(),
    values,
    valueFilterActive: firstParam(searchParams.value_filter) === "custom"
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
  if (filters.valueFilterActive) {
    params.set("value_filter", "custom");
    for (const value of filters.values) {
      params.append("values", value);
    }
  }

  return params.toString();
}
