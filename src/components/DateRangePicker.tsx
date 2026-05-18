"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Calendar, ChevronDown } from "lucide-react";
import { getDisplayTimeZone } from "@/lib/format";

export type DateRangeValue = {
  from: string;
  to: string;
};

type Preset = "custom" | "today" | "yesterday" | "last7" | "last30";

type DateRangePickerProps = {
  from: string;
  to: string;
  fromName?: string;
  toName?: string;
  idPrefix?: string;
  onChange?: (value: DateRangeValue) => void;
};

const presets: Array<{ key: Preset; label: string }> = [
  { key: "custom", label: "Custom" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" }
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInput(value: string) {
  if (!value) {
    return "";
  }

  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function dateInputFromDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayInDisplayTimeZone() {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getDisplayTimeZone()
  }).formatToParts(new Date());
  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(Number(valueByType.year), Number(valueByType.month) - 1, Number(valueByType.day), 12);
}

function shiftedDate(days: number) {
  const date = todayInDisplayTimeZone();
  date.setDate(date.getDate() + days);
  return dateInputFromDate(date);
}

function rangeForPreset(preset: Preset): DateRangeValue {
  if (preset === "today") {
    const today = shiftedDate(0);
    return { from: today, to: today };
  }

  if (preset === "yesterday") {
    const yesterday = shiftedDate(-1);
    return { from: yesterday, to: yesterday };
  }

  if (preset === "last7") {
    return { from: shiftedDate(-6), to: shiftedDate(0) };
  }

  if (preset === "last30") {
    return { from: shiftedDate(-29), to: shiftedDate(0) };
  }

  return { from: "", to: "" };
}

function formatDateLabel(value: string) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function formatRangeLabel(range: DateRangeValue) {
  if (range.from && range.to) {
    return `${formatDateLabel(range.from)} - ${formatDateLabel(range.to)}`;
  }

  if (range.from) {
    return `From ${formatDateLabel(range.from)}`;
  }

  if (range.to) {
    return `To ${formatDateLabel(range.to)}`;
  }

  return "All dates";
}

function normalizedRange(from: string, to: string): DateRangeValue {
  return {
    from: toDateInput(from),
    to: toDateInput(to)
  };
}

export function DateRangePicker({
  from,
  to,
  fromName = "from",
  toName = "to",
  idPrefix = "date-range",
  onChange
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<Preset>("custom");
  const [appliedRange, setAppliedRange] = useState<DateRangeValue>(() => normalizedRange(from, to));
  const [draftRange, setDraftRange] = useState<DateRangeValue>(() => normalizedRange(from, to));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nextRange = normalizedRange(from, to);
    setAppliedRange(nextRange);
    setDraftRange(nextRange);
    setSelectedPreset("custom");
  }, [from, to]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setDraftRange(appliedRange);
        setIsOpen(false);
      }
    }

    if (!isOpen) {
      return;
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [appliedRange, isOpen]);

  const rangeLabel = useMemo(() => formatRangeLabel(appliedRange), [appliedRange]);

  function choosePreset(preset: Preset) {
    setSelectedPreset(preset);
    if (preset !== "custom") {
      setDraftRange(rangeForPreset(preset));
    }
  }

  function applyRange() {
    setAppliedRange(draftRange);
    onChange?.(draftRange);
    setIsOpen(false);
  }

  function cancelRange() {
    setDraftRange(appliedRange);
    setIsOpen(false);
  }

  return (
    <div className="date-range-field" ref={rootRef}>
      <span className="date-range-label">Date range</span>
      <div className="date-range-shell">
        <input type="hidden" name={fromName} value={appliedRange.from} />
        <input type="hidden" name={toName} value={appliedRange.to} />
        <button
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          className="date-range-trigger"
          type="button"
          onClick={() => setIsOpen((current) => !current)}
        >
          <Calendar aria-hidden="true" className="icon" />
          <span>{rangeLabel}</span>
          <ChevronDown aria-hidden="true" className="icon" />
        </button>
        {isOpen ? (
          <div className="date-range-popover" role="dialog" aria-label="Date range picker">
            <div className="date-range-presets">
              {presets.map((preset) => (
                <button
                  className={`date-range-preset ${selectedPreset === preset.key ? "selected" : ""}`}
                  key={preset.key}
                  type="button"
                  onClick={() => choosePreset(preset.key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="date-range-custom">
              <div className="date-range-inputs">
                <label htmlFor={`${idPrefix}-from`}>
                  Start date
                  <input
                    id={`${idPrefix}-from`}
                    type="date"
                    value={draftRange.from}
                    onChange={(event) => {
                      setSelectedPreset("custom");
                      setDraftRange((current) => ({ ...current, from: event.target.value }));
                    }}
                  />
                </label>
                <ArrowRight aria-hidden="true" className="date-range-arrow" />
                <label htmlFor={`${idPrefix}-to`}>
                  End date
                  <input
                    id={`${idPrefix}-to`}
                    type="date"
                    value={draftRange.to}
                    onChange={(event) => {
                      setSelectedPreset("custom");
                      setDraftRange((current) => ({ ...current, to: event.target.value }));
                    }}
                  />
                </label>
              </div>
              <div className="date-range-preview">{formatRangeLabel(draftRange)}</div>
              <div className="date-range-actions">
                <button className="button secondary" type="button" onClick={cancelRange}>
                  Cancel
                </button>
                <button className="button primary" type="button" onClick={applyRange}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
