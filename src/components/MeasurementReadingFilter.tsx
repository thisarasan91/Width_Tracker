"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";

type MeasurementReadingFilterProps = {
  options: string[];
  selectedLabels: string[];
  filterActive: boolean;
  baseParams: Record<string, string>;
};

export function MeasurementReadingFilter({
  options,
  selectedLabels,
  filterActive,
  baseParams
}: MeasurementReadingFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCustom, setIsCustom] = useState(filterActive);
  const [selected, setSelected] = useState(() => (filterActive ? selectedLabels : options));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsCustom(filterActive);
    setSelected(filterActive ? selectedLabels.filter((label) => options.includes(label)) : options);
  }, [filterActive, options, selectedLabels]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (!isOpen) {
      return;
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const selectedSet = useMemo(() => new Set(isCustom ? selected : options), [isCustom, options, selected]);
  const summary = isCustom ? `${selected.length}/${options.length}` : "All";

  function applySelection(nextIsCustom: boolean, nextSelected: string[]) {
    setIsCustom(nextIsCustom);
    setSelected(nextSelected);

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(baseParams)) {
      if (value) {
        params.set(key, value);
      }
    }

    if (nextIsCustom) {
      params.set("reading_filter", "custom");
      for (const label of nextSelected) {
        params.append("reading_label", label);
      }
    }

    const query = params.toString();
    window.location.href = query ? `/measurements?${query}` : "/measurements";
  }

  function toggleLabel(label: string) {
    const currentSet = new Set(isCustom ? selected : options);
    if (currentSet.has(label)) {
      currentSet.delete(label);
    } else {
      currentSet.add(label);
    }

    const nextSelected = options.filter((option) => currentSet.has(option));
    applySelection(nextSelected.length !== options.length, nextSelected);
  }

  function selectAll() {
    applySelection(false, options);
  }

  function clearAll() {
    applySelection(true, []);
  }

  return (
    <div className="table-filter-field" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`table-filter-trigger ${isCustom ? "active" : ""}`}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>Reading</span>
        <span className="table-filter-summary">
          <Filter aria-hidden="true" className="icon" />
          {summary}
        </span>
        <ChevronDown aria-hidden="true" className="icon" />
      </button>
      {isOpen ? (
        <div className="table-filter-popover" role="dialog" aria-label="Filter reading column">
          <div className="table-filter-actions">
            <button type="button" onClick={selectAll}>
              Select all
            </button>
            <button type="button" onClick={clearAll}>
              Clear
            </button>
          </div>
          <div className="table-filter-options">
            {options.length === 0 ? <p className="muted">No readings available.</p> : null}
            {options.map((label) => (
              <label className="table-filter-option" key={label}>
                <input checked={selectedSet.has(label)} type="checkbox" value={label} onChange={() => toggleLabel(label)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
