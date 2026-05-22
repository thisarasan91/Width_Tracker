"use client";

import { useMemo, useState } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";

export type MeasurementDeviceOption = {
  id: string;
  label: string;
};

export type MeasurementProgramOption = {
  id: string;
  name: string;
  deviceIds: string[];
};

type MeasurementsFilterFormProps = {
  devices: MeasurementDeviceOption[];
  programs: MeasurementProgramOption[];
  filters: {
    deviceId: string;
    programId: string;
    from: string;
    to: string;
  };
};

export function MeasurementsFilterForm({ devices, programs, filters }: MeasurementsFilterFormProps) {
  const [deviceId, setDeviceId] = useState(filters.deviceId);
  const [programId, setProgramId] = useState(filters.programId);
  const filteredPrograms = useMemo(
    () => programs.filter((program) => !deviceId || program.deviceIds.includes(deviceId)),
    [deviceId, programs]
  );
  const selectedProgramIsAvailable = !programId || filteredPrograms.some((program) => program.id === programId);
  const effectiveProgramId = selectedProgramIsAvailable ? programId : "";

  function changeDevice(nextDeviceId: string) {
    const nextPrograms = programs.filter((program) => !nextDeviceId || program.deviceIds.includes(nextDeviceId));
    setDeviceId(nextDeviceId);
    setProgramId((current) => (current && !nextPrograms.some((program) => program.id === current) ? "" : current));
  }

  return (
    <form className="form-grid two-column" method="get" action="/measurements">
      <label>
        Machine / Device
        <select name="device_id" value={deviceId} onChange={(event) => changeDevice(event.target.value)}>
          <option value="">All machines</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Program
        <select name="program_id" value={effectiveProgramId} onChange={(event) => setProgramId(event.target.value)}>
          <option value="">{deviceId ? "All programs for selected machine" : "All programs"}</option>
          {filteredPrograms.length === 0 && deviceId ? <option disabled>No programs for selected machine</option> : null}
          {filteredPrograms.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>
      </label>
      <DateRangePicker from={filters.from} to={filters.to} idPrefix="measurements-date-range" />
      <div className="form-actions">
        <button className="button primary" type="submit">
          Apply filters
        </button>
        <a className="button secondary" href="/measurements">
          Clear
        </a>
      </div>
    </form>
  );
}
