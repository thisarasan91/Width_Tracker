"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatNumber } from "@/lib/format";

type MeasurementValueFilterProps = {
  options: string[];
  selectedValues: string[];
  filterActive: boolean;
};

export function MeasurementValueFilter({ options, selectedValues, filterActive }: MeasurementValueFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCustom, setIsCustom] = useState(filterActive);
  const [selected, setSelected] = useState(() => (filterActive ? selectedValues : options));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsCustom(filterActive);
    setSelected(filterActive ? selectedValues.filter((value) => options.includes(value)) : options);
  }, [filterActive, options, selectedValues]);

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
  const label = isCustom ? `${selected.length}/${options.length} selected` : "All values";

  function toggleValue(value: string) {
    setIsCustom(true);
    setSelected((current) => {
      const currentSet = new Set(isCustom ? current : options);
      if (currentSet.has(value)) {
        currentSet.delete(value);
      } else {
        currentSet.add(value);
      }
      return options.filter((option) => currentSet.has(option));
    });
  }

  function selectAll() {
    setIsCustom(false);
    setSelected(options);
  }

  function clearAll() {
    setIsCustom(true);
    setSelected([]);
  }

  return (
    <div className="value-filter-field" ref={rootRef}>
      <span className="date-range-label">Data value</span>
      {isCustom ? <input type="hidden" name="value_filter" value="custom" /> : null}
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="value-filter-trigger"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{label}</span>
        <ChevronDown aria-hidden="true" className="icon" />
      </button>
      {isCustom
        ? selected.map((value) => <input key={value} type="hidden" name="values" value={value} />)
        : null}
      {isOpen ? (
        <div className="value-filter-popover" role="dialog" aria-label="Filter by measurement value">
          <div className="value-filter-actions">
            <button type="button" onClick={selectAll}>
              Select all
            </button>
            <button type="button" onClick={clearAll}>
              Clear
            </button>
          </div>
          <div className="value-filter-options">
            {options.length === 0 ? <p className="muted">No values available.</p> : null}
            {options.map((value) => (
              <label className="value-filter-option" key={value}>
                <input
                  checked={selectedSet.has(value)}
                  type="checkbox"
                  value={value}
                  onChange={() => toggleValue(value)}
                />
                <span>{formatNumber(value)}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
