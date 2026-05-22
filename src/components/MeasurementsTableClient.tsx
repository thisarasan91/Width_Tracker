"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";
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
  const filterRef = useRef<HTMLDivElement>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
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

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }

    if (!isFilterOpen) {
      return;
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isFilterOpen]);

  const selectedSet = new Set(selectedReadings);
  const filteredRows = rows.filter((row) => selectedSet.has(row.reading_label));
  const filterIsActive = selectedReadings.length !== readingOptions.length;
  const filterSummary =
    selectedReadings.length === readingOptions.length
      ? "All"
      : selectedReadings.length === 0
        ? "None"
        : `${selectedReadings.length} selected`;

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
              <th>
                <div className="table-filter-field reading-filter-field" ref={filterRef}>
                  <button
                    aria-expanded={isFilterOpen}
                    aria-haspopup="menu"
                    className={`table-filter-trigger ${filterIsActive ? "active" : ""}`}
                    type="button"
                    onClick={() => setIsFilterOpen((current) => !current)}
                  >
                    <span>Reading</span>
                    <Filter aria-hidden="true" className="icon" />
                    <span className="table-filter-summary">{filterSummary}</span>
                    <ChevronDown aria-hidden="true" className="icon" />
                  </button>
                  {isFilterOpen ? (
                    <div className="table-filter-popover reading-filter-popover" role="menu" aria-label="Reading filter">
                      <div className="table-filter-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectionMode("all");
                            setSelectedReadings(readingOptions);
                          }}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectionMode("custom");
                            setSelectedReadings([]);
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      <div className="table-filter-options">
                        {readingOptions.length === 0 ? <span className="table-filter-empty">No readings</span> : null}
                        {readingOptions.map((label) => (
                          <label className="table-filter-option" key={label}>
                            <input checked={selectedSet.has(label)} type="checkbox" onChange={() => toggleReading(label)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
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
