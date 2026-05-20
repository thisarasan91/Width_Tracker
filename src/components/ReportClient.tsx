"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { buildFilterQueryString, type MeasurementFilters } from "@/lib/measurementFilters";
import { formatCompactDateTime, formatNumber } from "@/lib/format";
import type { Device, Program } from "@/lib/types";

type ReportRow = {
  timestamp: string;
  width: number;
  reading_label: string;
  device_name: string;
  program_name: string;
};

type ReportPayload = {
  title: string;
  programName: string;
  dateRange: string;
  rows: ReportRow[];
};

type ReportClientProps = {
  devices: Device[];
  programs: Program[];
  initialFilters: MeasurementFilters;
};

const emptyPayload: ReportPayload = {
  title: "Select filters",
  programName: "No program",
  dateRange: "No range",
  rows: []
};

function queryFromFilters(filters: MeasurementFilters) {
  const query = buildFilterQueryString(filters);
  return query ? `?${query}` : "";
}

function WidthChart({ payload }: { payload: ReportPayload }) {
  const rows = payload.rows;
  const width = 880;
  const height = 360;
  const padding = 48;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  if (rows.length === 0) {
    return (
      <div className="chart-empty">
        <p>No data for the selected filters.</p>
      </div>
    );
  }

  const times = rows.map((row) => new Date(row.timestamp).getTime());
  const values = rows.map((row) => row.width);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const timeRange = Math.max(1, maxTime - minTime);
  const valueRange = Math.max(0.0001, maxValue - minValue);

  const points = rows.map((row) => {
    const time = new Date(row.timestamp).getTime();
    const x = padding + ((time - minTime) / timeRange) * plotWidth;
    const y = padding + plotHeight - ((row.width - minValue) / valueRange) * plotHeight;
    return { x, y, row };
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <div className="chart-wrap">
      <svg role="img" aria-label="Width vs time graph" viewBox={`0 0 ${width} ${height}`}>
        <line className="chart-axis" x1={padding} y1={padding} x2={padding} y2={height - padding} />
        <line className="chart-axis" x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <text className="chart-label" x={12} y={padding + 4}>
          {formatNumber(maxValue)}
        </text>
        <text className="chart-label" x={12} y={height - padding + 4}>
          {formatNumber(minValue)}
        </text>
        <text className="chart-label" x={padding} y={height - 14}>
          {formatCompactDateTime(rows[0].timestamp)}
        </text>
        <text className="chart-label" x={width - padding - 140} y={height - 14}>
          {formatCompactDateTime(rows[rows.length - 1].timestamp)}
        </text>
        <path className="chart-line" d={path} fill="none" />
        {points.map((point, index) => (
          <circle key={`${point.row.timestamp}-${index}`} className="chart-point" cx={point.x} cy={point.y} r="4">
            <title>
              {formatCompactDateTime(point.row.timestamp)} | {point.row.width.toFixed(2)}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export function ReportClient({ devices, programs, initialFilters }: ReportClientProps) {
  const [draftFilters, setDraftFilters] = useState<MeasurementFilters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<MeasurementFilters>(initialFilters);
  const [payload, setPayload] = useState<ReportPayload>(emptyPayload);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const activeQuery = useMemo(() => queryFromFilters(activeFilters), [activeFilters]);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/reports/data${activeQuery}`, {
          cache: "no-store"
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load report data.");
        }
        if (!cancelled) {
          setPayload(body);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load report data.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadReport();
    const interval = window.setInterval(loadReport, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeQuery]);

  function updateDraft(key: keyof MeasurementFilters, value: string) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveFilters(draftFilters);
    const query = queryFromFilters(draftFilters);
    window.history.replaceState(null, "", `/reports${query}`);
  }

  const csvHref = `/api/reports/csv${activeQuery}`;
  const pdfHref = `/api/reports/pdf${activeQuery}`;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Filters</p>
            <h2>Machine, program, and period</h2>
          </div>
          <div className="form-actions">
            <a className="button secondary" href={csvHref}>
              <Download aria-hidden="true" className="icon" />
              CSV
            </a>
            <a className="button primary" href={pdfHref}>
              <FileText aria-hidden="true" className="icon" />
              PDF
            </a>
          </div>
        </div>
        <form className="form-grid two-column" onSubmit={applyFilters}>
          <label>
            Machine / Device
            <select value={draftFilters.deviceId} onChange={(event) => updateDraft("deviceId", event.target.value)}>
              <option value="">All machines</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.device_name} {device.loom_name ? `(${device.loom_name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Program
            <select value={draftFilters.programId} onChange={(event) => updateDraft("programId", event.target.value)}>
              <option value="">All programs</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.program_name}
                </option>
              ))}
            </select>
          </label>
          <DateRangePicker
            from={draftFilters.from}
            to={draftFilters.to}
            idPrefix="reports-date-range"
            onChange={(range) => setDraftFilters((current) => ({ ...current, from: range.from, to: range.to }))}
          />
          <div className="form-actions">
            <button className="button primary" type="submit">
              Apply filters
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                const cleared = { deviceId: "", programId: "", from: "", to: "", values: [], valueFilterActive: false };
                setDraftFilters(cleared);
                setActiveFilters(cleared);
                window.history.replaceState(null, "", "/reports");
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live Report</p>
            <h2>{payload.title}</h2>
          </div>
          <span className="muted">
            <RefreshCw aria-hidden="true" className={`icon ${isLoading ? "spin" : ""}`} /> Auto updates every 10s
          </span>
        </div>
        {error ? <p className="form-message">{error}</p> : null}
        <WidthChart payload={payload} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Data</p>
            <h2>{payload.rows.length} rows</h2>
          </div>
        </div>
        <div className="table-wrap report-table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Station</th>
                <th>Program</th>
                <th>Reading</th>
                <th>Width</th>
              </tr>
            </thead>
            <tbody>
              {payload.rows.slice().reverse().map((row, index) => (
                <tr key={`${row.timestamp}-${row.reading_label}-${index}`}>
                  <td>{formatCompactDateTime(row.timestamp)}</td>
                  <td>{row.device_name}</td>
                  <td>{row.program_name}</td>
                  <td>{row.reading_label}</td>
                  <td>{row.width.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
