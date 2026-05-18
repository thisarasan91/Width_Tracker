import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateDeviceRequest } from "@/lib/deviceApi";
import type { Program } from "@/lib/types";

export const runtime = "nodejs";

type IncomingReading = {
  reading_label?: unknown;
  label?: unknown;
  reading_value?: unknown;
  value?: unknown;
  unit?: unknown;
};

function roundMeasurementValue(value: number) {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeReading(reading: IncomingReading, fallbackUnit: string) {
  const label = String(reading.reading_label ?? reading.label ?? "").trim();
  const numericValue = Number(reading.reading_value ?? reading.value);
  const unit = String(reading.unit ?? fallbackUnit).trim() || fallbackUnit;

  return {
    reading_label: label,
    reading_value: roundMeasurementValue(numericValue),
    unit
  };
}

export async function POST(request: Request) {
  const auth = await authenticateDeviceRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      {
        success: false,
        message: auth.message
      },
      { status: auth.status }
    );
  }

  let body: {
    program_id?: unknown;
    assignment_id?: unknown;
    measurement_session_id?: unknown;
    readings?: IncomingReading[];
    unit?: unknown;
    operator_name?: unknown;
    loom_name?: unknown;
    sent_at?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid JSON body."
      },
      { status: 400 }
    );
  }

  const programId = typeof body.program_id === "string" ? body.program_id : "";
  const assignmentId = typeof body.assignment_id === "string" ? body.assignment_id : "";
  const incomingReadings = Array.isArray(body.readings) ? body.readings : [];
  const fallbackUnit = typeof body.unit === "string" && body.unit.trim() ? body.unit.trim() : "mm";

  if (!programId || !assignmentId || incomingReadings.length === 0) {
    return NextResponse.json(
      {
        success: false,
        message: "program_id, assignment_id, and readings are required."
      },
      { status: 400 }
    );
  }

  const { data: assignment, error: assignmentError } = await auth.admin
    .from("device_program_assignments")
    .select("id, device_id, program_id, is_active")
    .eq("id", assignmentId)
    .eq("device_id", auth.device.id)
    .eq("program_id", programId)
    .eq("is_active", true)
    .maybeSingle();

  if (assignmentError) {
    return NextResponse.json(
      {
        success: false,
        message: assignmentError.message
      },
      { status: 500 }
    );
  }

  if (!assignment) {
    return NextResponse.json(
      {
        success: false,
        message: "Program is not actively assigned to this device."
      },
      { status: 403 }
    );
  }

  const { data: programData, error: programError } = await auth.admin
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("is_active", true)
    .maybeSingle();

  if (programError) {
    return NextResponse.json(
      {
        success: false,
        message: programError.message
      },
      { status: 500 }
    );
  }

  if (!programData) {
    return NextResponse.json(
      {
        success: false,
        message: "Program is inactive or missing."
      },
      { status: 403 }
    );
  }

  const program = programData as Program;
  const expectedLabels = program.labels_for_each_reading;
  const normalizedReadings = incomingReadings.map((reading) => normalizeReading(reading, fallbackUnit));

  if (normalizedReadings.length !== program.required_data_points_per_measurement) {
    return NextResponse.json(
      {
        success: false,
        message: `${program.required_data_points_per_measurement} readings required.`,
        required_data_points_per_measurement: program.required_data_points_per_measurement,
        required_labels: expectedLabels
      },
      { status: 422 }
    );
  }

  const labelsMatch = expectedLabels.every(
    (label, index) => normalizedReadings[index]?.reading_label === label
  );
  const invalidReading = normalizedReadings.find(
    (reading) => !reading.reading_label || !Number.isFinite(reading.reading_value)
  );

  if (!labelsMatch || invalidReading) {
    return NextResponse.json(
      {
        success: false,
        message: "Readings must match the program labels and include numeric values.",
        required_labels: expectedLabels
      },
      { status: 422 }
    );
  }

  const sentAt =
    typeof body.sent_at === "string" && !Number.isNaN(Date.parse(body.sent_at))
      ? new Date(body.sent_at).toISOString()
      : new Date().toISOString();
  const measurementSessionId =
    typeof body.measurement_session_id === "string" && body.measurement_session_id.trim()
      ? body.measurement_session_id.trim()
      : randomUUID();
  const operatorName =
    typeof body.operator_name === "string" && body.operator_name.trim()
      ? body.operator_name.trim()
      : null;
  const loomName =
    typeof body.loom_name === "string" && body.loom_name.trim()
      ? body.loom_name.trim()
      : auth.device.loom_name;

  const rows = normalizedReadings.map((reading) => ({
    device_id: auth.device.id,
    program_id: program.id,
    assignment_id: assignment.id,
    measurement_session_id: measurementSessionId,
    reading_label: reading.reading_label,
    reading_value: reading.reading_value,
    unit: reading.unit,
    operator_name: operatorName,
    loom_name: loomName,
    sent_at: sentAt,
    cloud_verification_status: "stored"
  }));

  const { data: insertedRows, error: insertError } = await auth.admin
    .from("measurements")
    .insert(rows)
    .select("id, reading_label");

  if (insertError) {
    return NextResponse.json(
      {
        success: false,
        message: "Upload failed, retry required.",
        detail: insertError.message
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Measurement successfully stored",
    measurement_session_id: measurementSessionId,
    cloud_verification_status: "stored",
    rows_stored: insertedRows?.length ?? rows.length
  });
}
