import { formatCompactDateTime } from "@/lib/format";
import type { ReportPayload } from "@/lib/reportData";

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

export function reportPayloadToCsv(payload: ReportPayload) {
  const lines = [
    ["Program", payload.programName],
    ["Data Range", payload.dateRange],
    [],
    ["Timestamp", "Width"]
  ];

  payload.rows.forEach((row) => {
    lines.push([formatCompactDateTime(row.timestamp), row.width.toFixed(4)]);
  });

  return lines.map((line) => line.map(escapeCsv).join(",")).join("\r\n");
}
