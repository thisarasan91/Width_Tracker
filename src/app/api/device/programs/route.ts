import { NextResponse } from "next/server";
import { authenticateDeviceRequest } from "@/lib/deviceApi";
import type { Program } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const { data: assignments, error: assignmentError } = await auth.admin
    .from("device_program_assignments")
    .select("id, program_id, assigned_at")
    .eq("device_id", auth.device.id)
    .eq("is_active", true)
    .order("assigned_at", { ascending: false });

  if (assignmentError) {
    return NextResponse.json(
      {
        success: false,
        message: assignmentError.message
      },
      { status: 500 }
    );
  }

  const programIds = [...new Set((assignments ?? []).map((assignment) => assignment.program_id))];

  if (programIds.length === 0) {
    return NextResponse.json({
      success: true,
      device: {
        id: auth.device.id,
        device_name: auth.device.device_name,
        serial_number: auth.device.serial_number,
        location: auth.device.location,
        loom_name: auth.device.loom_name
      },
      programs: []
    });
  }

  const { data: programs, error: programError } = await auth.admin
    .from("programs")
    .select("*")
    .in("id", programIds)
    .eq("is_active", true);

  if (programError) {
    return NextResponse.json(
      {
        success: false,
        message: programError.message
      },
      { status: 500 }
    );
  }

  const programById = new Map((programs ?? []).map((program) => [program.id, program as Program]));
  const payload = (assignments ?? [])
    .map((assignment) => {
      const program = programById.get(assignment.program_id);
      if (!program) {
        return null;
      }

      return {
        assignment_id: assignment.id,
        assigned_at: assignment.assigned_at,
        program_id: program.id,
        program_name: program.program_name,
        batch_name: program.batch_name,
        elastic_development_reference: program.elastic_development_reference,
        description: program.description,
        required_data_points_per_measurement: program.required_data_points_per_measurement,
        labels_for_each_reading: program.labels_for_each_reading
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    success: true,
    device: {
      id: auth.device.id,
      device_name: auth.device.device_name,
      serial_number: auth.device.serial_number,
      location: auth.device.location,
      loom_name: auth.device.loom_name
    },
    programs: payload
  });
}
