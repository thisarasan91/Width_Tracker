"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCompactDateTime, formatNumber } from "@/lib/format";

type MeasurementTableRow = {
  id: string;
  sent_at: string;
  station: string;
  program: string;
  reading_label: string;
  reading_value: string | number;
  unit: string;
};

type MeasurementsTableClientProps = {
  rows: MeasurementTableRow[];
};

export function MeasurementsTableClient({ rows }: MeasurementsTableClientProps) {
  const readingOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.reading_label).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [rows]
  );
  const [selectedReadings, setSelectedReadings] = useState<string[]>(readingOptions);
  const [selectionMode, setSelectionMode] = useState<"all" | "custom">("all");

  useEffect(() => {
    if (selectionMode === "all") {
      setSelectedReadings(readingOptions);
      return;
    }

    setSelectedReadings((current) => current.filter((label) => readingOptions.includes(label)));
  }, [readingOptions, selectionMode]);

  const selectedSet = new Set(selectedReadings);
  const filteredRows = rows.filter((row) => selectedSet.has(row.reading_label));

  function toggleReading(label: string) {
    setSelectionMode("custom");
    setSelectedReadings((current) => {
      const currentSet = new Set(current);
      if (currentSet.has(label)) {
        currentSet.delete(label);
      } else {
        currentSet.add(label);
      }
      return readingOptions.filter((option) => currentSet.has(option));
    });
  }

  return (
    <>
      <div className="table-wrap report-table-wrap">
        <table className="compact-table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Station</th>
              <th>Programme</th>
              <th className="reading-filter-cell">
                <span className="reading-filter-title">Reading</span>
                <div className="table-inline-filter" aria-label="Reading filter">
                  <button
                    className="table-inline-filter-button"
                    type="button"
                    onClick={() => {
                      setSelectionMode("all");
                      setSelectedReadings(readingOptions);
                    }}
                  >
                    Select all
                  </button>
                  <button
                    className="table-inline-filter-button"
                    type="button"
                    onClick={() => {
                      setSelectionMode("custom");
                      setSelectedReadings([]);
                    }}
                  >
                    Clear
                  </button>
                  {readingOptions.map((label) => (
                    <label className="table-inline-filter-option" key={label}>
                      <input checked={selectedSet.has(label)} type="checkbox" onChange={() => toggleReading(label)} />
                      {label}
                    </label>
                  ))}
                </div>
              </th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((measurement) => (
              <tr key={measurement.id}>
                <td>{formatCompactDateTime(measurement.sent_at)}</td>
                <td>{measurement.station}</td>
                <td>{measurement.program}</td>
                <td>{measurement.reading_label}</td>
                <td>
                  {formatNumber(measurement.reading_value)} {measurement.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredRows.length === 0 ? <p className="empty-state">No readings match the selected Reading filter.</p> : null}
    </>
  );
}
