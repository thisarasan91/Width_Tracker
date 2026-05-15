import type { Measurement } from "@/lib/types";
import { formatNumber, getDisplayTimeZone } from "@/lib/format";

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
    timeZone: getDisplayTimeZone()
  }).format(new Date(value));
}

export function measurementsToCsv(rows: MeasurementExportRow[]) {
  const headers = ["Date / Time", "Station", "Program", "Reading", "Value"];

  const body = rows.map((row) => [
    formatCsvDateTime(row.sent_at),
    row.device?.device_name,
    row.program?.program_name,
    row.reading_label,
    `${formatNumber(row.reading_value)} ${row.unit}`
  ]);

  return [headers, ...body].map((line) => line.map(escapeCsv).join(",")).join("\r\n");
}
