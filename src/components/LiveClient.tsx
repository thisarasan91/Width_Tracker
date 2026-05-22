"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCompactDateTime, formatNumber } from "@/lib/format";
import type { LiveReadingRow } from "@/lib/liveData";
import type { Program } from "@/lib/types";

export type LiveStationOption = {
  id: string;
  name: string;
  serialNumber: string;
};

export type LiveProgramOption = Pick<
  Program,
  | "id"
  | "program_name"
  | "batch_name"
  | "nominal_width"
  | "upper_tolerance"
  | "lower_tolerance"
  | "required_data_points_per_measurement"
  | "labels_for_each_reading"
> & {
  stationIds: string[];
};

type LiveClientProps = {
  stations: LiveStationOption[];
  programs: LiveProgramOption[];
  rows: LiveReadingRow[];
  initialStationId: string;
  initialProgramId: string;
  initialReadingLabel: string;
  showStationSelect: boolean;
  basePath: string;
};

type ChartPoint = {
  x: number;
  y: number;
  row: LiveReadingRow;
};

const colors = ["#2563eb", "#059669", "#dc2626", "#7c3aed", "#ca8a04", "#0891b2", "#be185d", "#4b5563"];

function asNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMeasurementValue(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function programOptionLabel(program: LiveProgramOption) {
  const parts = [program.program_name];
  if (program.batch_name) {
    parts.push(program.batch_name);
  }
  return parts.join(" | ");
}

function toleranceLimits(program: LiveProgramOption | null) {
  if (!program) {
    return { lowerLimit: null, upperLimit: null };
  }

  const nominal = asNumber(program.nominal_width);
  if (nominal === null) {
    return { lowerLimit: null, upperLimit: null };
  }

  const lower = asNumber(program.lower_tolerance) ?? 0;
  const upper = asNumber(program.upper_tolerance) ?? 0;
  return {
    lowerLimit: roundMeasurementValue(nominal - lower),
    upperLimit: roundMeasurementValue(nominal + upper)
  };
}

function latestRowsByLabel(rows: LiveReadingRow[], labels: string[]) {
  const allowedLabels = new Set(labels);
  const countByLabel = new Map<string, number>();
  const latest: LiveReadingRow[] = [];

  for (const row of [...rows].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())) {
    if (allowedLabels.size > 0 && !allowedLabels.has(row.reading_label)) {
      continue;
    }
    const count = countByLabel.get(row.reading_label) ?? 0;
    if (count >= 10) {
      continue;
    }
    countByLabel.set(row.reading_label, count + 1);
    latest.push(row);
  }

  return latest.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function LiveChart({
  rows,
  labels,
  lowerLimit,
  upperLimit
}: {
  rows: LiveReadingRow[];
  labels: string[];
  lowerLimit: number | null;
  upperLimit: number | null;
}) {
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
        <p>No readings for the selected options.</p>
      </div>
    );
  }

  const times = rows.map((row) => new Date(row.timestamp).getTime()).filter(Number.isFinite);
  const yValues = rows.map((row) => row.width);
  if (lowerLimit !== null) yValues.push(lowerLimit);
  if (upperLimit !== null) yValues.push(upperLimit);

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
        <line className="chart-axis" x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} />
        <text className="chart-label" x={12} y={paddingTop + 4}>{formatNumber(maxValue)}</text>
        <text className="chart-label" x={12} y={height - paddingBottom + 4}>{formatNumber(minValue)}</text>
        <text className="chart-label" x={paddingLeft} y={height - 18}>{formatCompactDateTime(rows[0].timestamp)}</text>
        <text className="chart-label" x={width - paddingRight - 150} y={height - 18}>{formatCompactDateTime(rows[rows.length - 1].timestamp)}</text>

        {upperLimit !== null ? (
          <g>
            <line className="live-tolerance-line upper" x1={paddingLeft} y1={yFor(upperLimit)} x2={width - paddingRight} y2={yFor(upperLimit)} />
            <text className="live-tolerance-label" x={width - paddingRight - 86} y={yFor(upperLimit) - 7}>USL {formatNumber(upperLimit)}</text>
          </g>
        ) : null}
        {lowerLimit !== null ? (
          <g>
            <line className="live-tolerance-line lower" x1={paddingLeft} y1={yFor(lowerLimit)} x2={width - paddingRight} y2={yFor(lowerLimit)} />
            <text className="live-tolerance-label" x={width - paddingRight - 86} y={yFor(lowerLimit) + 16}>LSL {formatNumber(lowerLimit)}</text>
          </g>
        ) : null}

        {series.map((item) => {
          const path = item.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
          return (
            <g key={item.label}>
              <path className="live-chart-line" d={path} fill="none" style={{ stroke: item.color }} />
              {item.points.map((point, index) => (
                <circle key={`${item.label}-${point.row.timestamp}-${index}`} className="live-chart-point" cx={point.x} cy={point.y} r="4" style={{ fill: item.color }}>
                  <title>{item.label} | {formatCompactDateTime(point.row.timestamp)} | {point.row.width.toFixed(2)} {point.row.unit}</title>
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
        {upperLimit !== null ? <span className="legend-item"><span className="legend-line danger" />Upper tolerance</span> : null}
        {lowerLimit !== null ? <span className="legend-item"><span className="legend-line warning" />Lower tolerance</span> : null}
      </div>
    </div>
  );
}

export function LiveClient({
  stations,
  programs,
  rows,
  initialStationId,
  initialProgramId,
  initialReadingLabel,
  showStationSelect,
  basePath
}: LiveClientProps) {
  const router = useRouter();
  const [selectedStationId, setSelectedStationId] = useState(initialStationId);
  const [selectedProgramId, setSelectedProgramId] = useState(initialProgramId);
  const [selectedReadingLabel, setSelectedReadingLabel] = useState(initialReadingLabel);

  useEffect(() => {
    const refreshId = window.setInterval(() => {
      router.refresh();
    }, 10000);

    return () => window.clearInterval(refreshId);
  }, [router]);

  const availablePrograms = useMemo(
    () => programs.filter((program) => !selectedStationId || program.stationIds.includes(selectedStationId)),
    [programs, selectedStationId]
  );
  const selectedProgram = availablePrograms.find((program) => program.id === selectedProgramId) ?? availablePrograms[0] ?? null;
  const activeProgramId = selectedProgram?.id ?? "";
  const readingLabels = selectedProgram?.labels_for_each_reading ?? [];
  const activeReadingLabel = readingLabels.includes(selectedReadingLabel) ? selectedReadingLabel : "";
  const chartLabels = activeReadingLabel ? [activeReadingLabel] : readingLabels;
  const { lowerLimit, upperLimit } = toleranceLimits(selectedProgram);
  const filteredRows = latestRowsByLabel(
    rows.filter((row) => (!selectedStationId || row.device_id === selectedStationId) && row.program_id === activeProgramId),
    chartLabels
  );

  function updateUrl(stationId: string, programId: string, readingLabel: string) {
    const params = new URLSearchParams();
    if (showStationSelect && stationId) params.set("stationId", stationId);
    if (programId) params.set("programId", programId);
    if (readingLabel) params.set("readingLabel", readingLabel);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${basePath}?${query}` : basePath);
  }

  function selectStation(stationId: string) {
    const nextPrograms = programs.filter((program) => !stationId || program.stationIds.includes(stationId));
    const nextProgramId = nextPrograms[0]?.id ?? "";
    setSelectedStationId(stationId);
    setSelectedProgramId(nextProgramId);
    setSelectedReadingLabel("");
    updateUrl(stationId, nextProgramId, "");
  }

  function selectProgram(programId: string) {
    setSelectedProgramId(programId);
    setSelectedReadingLabel("");
    updateUrl(selectedStationId, programId, "");
  }

  function selectReadingLabel(readingLabel: string) {
    setSelectedReadingLabel(readingLabel);
    updateUrl(selectedStationId, activeProgramId, readingLabel);
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live Filters</p>
            <h2>Select chart data</h2>
          </div>
        </div>
        <div className="form-grid two-column">
          {showStationSelect ? (
            <label>
              Station
              <select value={selectedStationId} onChange={(event) => selectStation(event.target.value)}>
                {stations.map((station) => (
                  <option key={station.id} value={station.id}>{station.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Program
            <select value={activeProgramId} onChange={(event) => selectProgram(event.target.value)}>
              {availablePrograms.length === 0 ? <option value="">No programs</option> : null}
              {availablePrograms.map((program) => (
                <option key={program.id} value={program.id}>{programOptionLabel(program)}</option>
              ))}
            </select>
          </label>
          <label>
            Reading
            <select value={activeReadingLabel} onChange={(event) => selectReadingLabel(event.target.value)}>
              <option value="">All readings</option>
              {readingLabels.map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
          </label>
          <div className="live-program-summary">
            <span>{selectedProgram?.required_data_points_per_measurement ?? 0} readings per measurement</span>
            <span>{selectedProgram?.nominal_width !== null && selectedProgram?.nominal_width !== undefined ? `Nominal ${formatNumber(selectedProgram.nominal_width)}` : "Nominal not set"}</span>
            <span>{lowerLimit !== null && upperLimit !== null ? `Tolerance ${formatNumber(lowerLimit)} to ${formatNumber(upperLimit)}` : "Tolerance not set"}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Live</p>
            <h2>{selectedProgram?.program_name ?? "No program selected"}</h2>
          </div>
          <span className="muted">Loaded {rows.length} rows</span>
        </div>
        <LiveChart rows={filteredRows} labels={chartLabels} lowerLimit={lowerLimit} upperLimit={upperLimit} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Latest Readings</p>
            <h2>{filteredRows.length} plotted points</h2>
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
              {filteredRows.slice().reverse().map((row, index) => (
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
