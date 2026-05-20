"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatCompactDateTime, formatNumber } from "@/lib/format";
import type { LivePayload, LiveReadingRow } from "@/lib/liveData";
import type { Program } from "@/lib/types";

type LiveClientProps = {
  programs: Program[];
  initialProgramId: string;
  initialReadingLabel: string;
};

type ChartPoint = {
  x: number;
  y: number;
  row: LiveReadingRow;
};

const colors = ["#2563eb", "#059669", "#dc2626", "#7c3aed", "#ca8a04", "#0891b2", "#be185d", "#4b5563"];

function programOptionLabel(program: Program) {
  const parts = [program.program_name];
  if (program.batch_name) {
    parts.push(program.batch_name);
  }
  return parts.join(" | ");
}

function LiveChart({ payload }: { payload: LivePayload }) {
  const rows = payload.rows;
  const labels = payload.labels.length > 0 ? payload.labels : Array.from(new Set(rows.map((row) => row.reading_label)));
  const width = 940;
  const height = 390;
  const paddingLeft = 58;
  const paddingRight = 28;
  const paddingTop = 34;
  const paddingBottom = 62;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  if (rows.length === 0) {
    return (
      <div className="chart-empty">
        <p>No readings yet for this program.</p>
      </div>
    );
  }

  const times = rows.map((row) => new Date(row.timestamp).getTime()).filter(Number.isFinite);
  const yValues = rows.map((row) => row.width);
  if (payload.lowerLimit !== null) {
    yValues.push(payload.lowerLimit);
  }
  if (payload.upperLimit !== null) {
    yValues.push(payload.upperLimit);
  }

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minRaw = Math.min(...yValues);
  const maxRaw = Math.max(...yValues);
  const rawRange = Math.max(0.0001, maxRaw - minRaw);
  const valuePadding = Math.max(0.25, rawRange * 0.14);
  const minValue = minRaw - valuePadding;
  const maxValue = maxRaw + valuePadding;
  const valueRange = Math.max(0.0001, maxValue - minValue);

  function xFor(timestamp: string) {
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time) || maxTime === minTime) {
      return paddingLeft + plotWidth / 2;
    }
    return paddingLeft + ((time - minTime) / (maxTime - minTime)) * plotWidth;
  }

  function yFor(value: number) {
    return paddingTop + plotHeight - ((value - minValue) / valueRange) * plotHeight;
  }

  const series = labels
    .map((label, index) => {
      const points: ChartPoint[] = rows
        .filter((row) => row.reading_label === label)
        .map((row) => ({ x: xFor(row.timestamp), y: yFor(row.width), row }));
      return { label, points, color: colors[index % colors.length] };
    })
    .filter((item) => item.points.length > 0);

  return (
    <div className="chart-wrap">
      <svg className="live-chart" role="img" aria-label="Last 10 readings by label" viewBox={`0 0 ${width} ${height}`}>
        <line className="chart-axis" x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} />
        <line
          className="chart-axis"
          x1={paddingLeft}
          y1={height - paddingBottom}
          x2={width - paddingRight}
          y2={height - paddingBottom}
        />
        <text className="chart-label" x={12} y={paddingTop + 4}>
          {formatNumber(maxValue)}
        </text>
        <text className="chart-label" x={12} y={height - paddingBottom + 4}>
          {formatNumber(minValue)}
        </text>
        <text className="chart-label" x={paddingLeft} y={height - 18}>
          {formatCompactDateTime(rows[0].timestamp)}
        </text>
        <text className="chart-label" x={width - paddingRight - 150} y={height - 18}>
          {formatCompactDateTime(rows[rows.length - 1].timestamp)}
        </text>

        {payload.upperLimit !== null ? (
          <g>
            <line
              className="live-tolerance-line upper"
              x1={paddingLeft}
              y1={yFor(payload.upperLimit)}
              x2={width - paddingRight}
              y2={yFor(payload.upperLimit)}
            />
            <text className="live-tolerance-label" x={width - paddingRight - 86} y={yFor(payload.upperLimit) - 7}>
              USL {formatNumber(payload.upperLimit)}
            </text>
          </g>
        ) : null}

        {payload.lowerLimit !== null ? (
          <g>
            <line
              className="live-tolerance-line lower"
              x1={paddingLeft}
              y1={yFor(payload.lowerLimit)}
              x2={width - paddingRight}
              y2={yFor(payload.lowerLimit)}
            />
            <text className="live-tolerance-label" x={width - paddingRight - 86} y={yFor(payload.lowerLimit) + 16}>
              LSL {formatNumber(payload.lowerLimit)}
            </text>
          </g>
        ) : null}

        {series.map((item) => {
          const path = item.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
          return (
            <g key={item.label}>
              <path className="live-chart-line" d={path} fill="none" style={{ stroke: item.color }} />
              {item.points.map((point, index) => (
                <circle
                  key={`${item.label}-${point.row.timestamp}-${index}`}
                  className="live-chart-point"
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  style={{ fill: item.color }}
                >
                  <title>
                    {item.label} | {formatCompactDateTime(point.row.timestamp)} | {point.row.width.toFixed(2)}{" "}
                    {point.row.unit}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="live-legend" aria-label="Graph legend">
        {series.map((item) => (
          <span key={item.label} className="legend-item">
            <span className="legend-swatch" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
        {payload.upperLimit !== null ? (
          <span className="legend-item">
            <span className="legend-line danger" />
            Upper tolerance
          </span>
        ) : null}
        {payload.lowerLimit !== null ? (
          <span className="legend-item">
            <span className="legend-line warning" />
            Lower tolerance
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function LiveClient({ programs, initialProgramId, initialReadingLabel }: LiveClientProps) {
  const [selectedProgramId, setSelectedProgramId] = useState(initialProgramId);
  const [selectedReadingLabel, setSelectedReadingLabel] = useState(initialReadingLabel);
  const [payload, setPayload] = useState<LivePayload | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(initialProgramId));
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === selectedProgramId) ?? null,
    [programs, selectedProgramId]
  );
  const readingLabels = selectedProgram?.labels_for_each_reading ?? [];
  const activeReadingLabel = readingLabels.includes(selectedReadingLabel) ? selectedReadingLabel : "";

  useEffect(() => {
    if (!selectedProgramId) {
      setPayload(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadLiveData() {
      setIsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ programId: selectedProgramId });
        if (activeReadingLabel) {
          params.set("readingLabel", activeReadingLabel);
        }

        const response = await fetch(`/api/live/data?${params.toString()}`, {
          cache: "no-store"
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load live readings.");
        }
        if (!cancelled) {
          setPayload(body);
          setLastUpdated(new Date().toISOString());
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load live readings.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadLiveData();
    const interval = window.setInterval(loadLiveData, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeReadingLabel, selectedProgramId]);

  function selectProgram(programId: string) {
    setSelectedProgramId(programId);
    setSelectedReadingLabel("");
    setPayload(null);
    window.history.replaceState(null, "", programId ? `/live?programId=${encodeURIComponent(programId)}` : "/live");
  }

  function selectReadingLabel(readingLabel: string) {
    setSelectedReadingLabel(readingLabel);
    setPayload(null);
    const params = new URLSearchParams();
    if (selectedProgramId) {
      params.set("programId", selectedProgramId);
    }
    if (readingLabel) {
      params.set("readingLabel", readingLabel);
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/live?${query}` : "/live");
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Program</p>
            <h2>Select active program</h2>
          </div>
          <span className="muted">
            <RefreshCw aria-hidden="true" className={`icon ${isLoading ? "spin" : ""}`} /> Updates every 10s
          </span>
        </div>
        <div className="form-grid two-column">
          <label>
            Program
            <select value={selectedProgramId} onChange={(event) => selectProgram(event.target.value)}>
              {programs.length === 0 ? <option value="">No active programs</option> : null}
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {programOptionLabel(program)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reading
            <select value={activeReadingLabel} onChange={(event) => selectReadingLabel(event.target.value)}>
              <option value="">All readings</option>
              {readingLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="live-program-summary">
            <span>{selectedProgram?.required_data_points_per_measurement ?? 0} readings per measurement</span>
            <span>
              {selectedProgram?.nominal_width !== null && selectedProgram?.nominal_width !== undefined
                ? `Nominal ${formatNumber(selectedProgram.nominal_width)}`
                : "Nominal not set"}
            </span>
            <span>
              {payload && payload.lowerLimit !== null && payload.upperLimit !== null
                ? `Tolerance ${formatNumber(payload.lowerLimit)} to ${formatNumber(payload.upperLimit)}`
                : "Tolerance not set"}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live</p>
            <h2>{payload?.program.program_name ?? selectedProgram?.program_name ?? "No program selected"}</h2>
          </div>
          <span className="muted">{lastUpdated ? `Last update ${formatCompactDateTime(lastUpdated)}` : "Waiting for data"}</span>
        </div>
        {error ? <p className="form-message">{error}</p> : null}
        {payload ? <LiveChart payload={payload} /> : <div className="chart-empty"><p>Select an active program.</p></div>}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Latest Readings</p>
            <h2>{payload?.rows.length ?? 0} plotted points</h2>
          </div>
        </div>
        <div className="table-wrap report-table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Reading</th>
                <th>Width</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.rows ?? [])
                .slice()
                .reverse()
                .map((row, index) => (
                  <tr key={`${row.timestamp}-${row.reading_label}-${index}`}>
                    <td>{formatCompactDateTime(row.timestamp)}</td>
                    <td>{row.reading_label}</td>
                    <td>{row.width.toFixed(2)}</td>
                    <td>{row.unit}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
