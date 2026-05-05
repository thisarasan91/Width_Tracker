import type { Measurement } from "@/lib/types";
import { getDisplayTimeZone } from "@/lib/format";

type MeasurementExportRow = Measurement & {
  device?: {
    device_name: string | null;
    serial_number: string | null;
    loom_name: string | null;
  } | null;
  program?: {
    program_name: string | null;
    batch_name: string | null;
    elastic_development_reference: string | null;
  } | null;
};

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function formatCsvDateTime(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: getDisplayTimeZone(),
    timeZoneName: "short"
  }).format(new Date(value));
}

export function measurementsToCsv(rows: MeasurementExportRow[]) {
  const headers = [
    "measurement_id",
    "measurement_session_id",
    "device_name",
    "serial_number",
    "program_name",
    "batch_name",
    "elastic_development_reference",
    "reading_label",
    "reading_value",
    "unit",
    "operator_name",
    "loom_name",
    "sent_at",
    "stored_at",
    "cloud_verification_status"
  ];

  const body = rows.map((row) => [
    row.id,
    row.measurement_session_id,
    row.device?.device_name,
    row.device?.serial_number,
    row.program?.program_name,
    row.program?.batch_name,
    row.program?.elastic_development_reference,
    row.reading_label,
    row.reading_value,
    row.unit,
    row.operator_name,
    row.loom_name ?? row.device?.loom_name,
    formatCsvDateTime(row.sent_at),
    formatCsvDateTime(row.stored_at),
    row.cloud_verification_status
  ]);

  return [headers, ...body].map((line) => line.map(escapeCsv).join(",")).join("\r\n");
}
