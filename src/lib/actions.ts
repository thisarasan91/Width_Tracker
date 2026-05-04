"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/types";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { generateDeviceToken, hashDeviceToken } from "@/lib/deviceTokens";

const INITIAL_STATE: ActionState = {
  ok: false,
  message: ""
};

function asText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalText(formData: FormData, key: string) {
  const value = asText(formData, key);
  return value.length > 0 ? value : null;
}

function parseLabels(formData: FormData) {
  return asText(formData, "labels_for_each_reading")
    .split(/\r?\n/)
    .map((label) => label.trim())
    .filter(Boolean);
}

function parseRequiredDataPoints(formData: FormData) {
  const value = Number(asText(formData, "required_data_points_per_measurement"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function errorState(error: unknown, fallback: string): ActionState {
  if (error instanceof Error && error.message) {
    return {
      ok: false,
      message: error.message
    };
  }

  return {
    ok: false,
    message: fallback
  };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createDeviceAction(
  _previousState: ActionState = INITIAL_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const deviceName = asText(formData, "device_name");
    const serialNumber = asText(formData, "serial_number");

    if (!deviceName || !serialNumber) {
      return {
        ok: false,
        message: "Device name and serial number are required."
      };
    }

    const admin = createAdminClient();
    const token = generateDeviceToken();
    const tokenHash = hashDeviceToken(token);

    const { data: device, error: deviceError } = await admin
      .from("devices")
      .insert({
        device_name: deviceName,
        serial_number: serialNumber,
        location: asOptionalText(formData, "location"),
        loom_name: asOptionalText(formData, "loom_name"),
        status: "offline"
      })
      .select("id")
      .single();

    if (deviceError) {
      throw new Error(deviceError.message);
    }

    const { error: tokenError } = await admin.from("device_api_tokens").insert({
      device_id: device.id,
      token_hash: tokenHash,
      created_by: user.id
    });

    if (tokenError) {
      throw new Error(tokenError.message);
    }

    revalidatePath("/dashboard");
    revalidatePath("/devices");

    return {
      ok: true,
      message: "Device created. Store this token on the Raspberry Pi; it will not be shown again.",
      token
    };
  } catch (error) {
    return errorState(error, "Could not create device.");
  }
}

export async function updateDeviceAction(
  _previousState: ActionState = INITIAL_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireUser();
    const id = asText(formData, "id");
    const deviceName = asText(formData, "device_name");
    const serialNumber = asText(formData, "serial_number");

    if (!id || !deviceName || !serialNumber) {
      return {
        ok: false,
        message: "Device id, name, and serial number are required."
      };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("devices")
      .update({
        device_name: deviceName,
        serial_number: serialNumber,
        location: asOptionalText(formData, "location"),
        loom_name: asOptionalText(formData, "loom_name")
      })
      .eq("id", id);

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/dashboard");
    revalidatePath("/devices");
    revalidatePath(`/devices/${id}`);

    return {
      ok: true,
      message: "Device updated."
    };
  } catch (error) {
    return errorState(error, "Could not update device.");
  }
}

export async function rotateDeviceTokenAction(
  _previousState: ActionState = INITIAL_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const deviceId = asText(formData, "device_id");

    if (!deviceId) {
      return {
        ok: false,
        message: "Device id is required."
      };
    }

    const admin = createAdminClient();
    const token = generateDeviceToken();
    const tokenHash = hashDeviceToken(token);
    const now = new Date().toISOString();

    const { error: revokeError } = await admin
      .from("device_api_tokens")
      .update({ revoked_at: now })
      .eq("device_id", deviceId)
      .is("revoked_at", null);

    if (revokeError) {
      throw new Error(revokeError.message);
    }

    const { error: createError } = await admin.from("device_api_tokens").insert({
      device_id: deviceId,
      token_hash: tokenHash,
      created_by: user.id
    });

    if (createError) {
      throw new Error(createError.message);
    }

    revalidatePath(`/devices/${deviceId}`);

    return {
      ok: true,
      message: "Device token rotated. Update the Raspberry Pi with this new token.",
      token
    };
  } catch (error) {
    return errorState(error, "Could not rotate device token.");
  }
}

export async function createProgramAction(
  _previousState: ActionState = INITIAL_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const requiredCount = parseRequiredDataPoints(formData);
    const labels = parseLabels(formData);
    const programName = asText(formData, "program_name");

    if (!programName || !requiredCount) {
      return {
        ok: false,
        message: "Program name and a positive reading count are required."
      };
    }

    if (labels.length !== requiredCount) {
      return {
        ok: false,
        message: `Expected ${requiredCount} reading labels, but received ${labels.length}.`
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("programs").insert({
      program_name: programName,
      batch_name: asOptionalText(formData, "batch_name"),
      elastic_development_reference: asOptionalText(formData, "elastic_development_reference"),
      description: asOptionalText(formData, "description"),
      required_data_points_per_measurement: requiredCount,
      labels_for_each_reading: labels,
      is_active: formData.get("is_active") === "on",
      created_by: user.id
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/dashboard");
    revalidatePath("/programs");

    return {
      ok: true,
      message: "Program created."
    };
  } catch (error) {
    return errorState(error, "Could not create program.");
  }
}

export async function updateProgramAction(
  _previousState: ActionState = INITIAL_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    await requireUser();
    const id = asText(formData, "id");
    const requiredCount = parseRequiredDataPoints(formData);
    const labels = parseLabels(formData);
    const programName = asText(formData, "program_name");

    if (!id || !programName || !requiredCount) {
      return {
        ok: false,
        message: "Program id, name, and a positive reading count are required."
      };
    }

    if (labels.length !== requiredCount) {
      return {
        ok: false,
        message: `Expected ${requiredCount} reading labels, but received ${labels.length}.`
      };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("programs")
      .update({
        program_name: programName,
        batch_name: asOptionalText(formData, "batch_name"),
        elastic_development_reference: asOptionalText(formData, "elastic_development_reference"),
        description: asOptionalText(formData, "description"),
        required_data_points_per_measurement: requiredCount,
        labels_for_each_reading: labels,
        is_active: formData.get("is_active") === "on"
      })
      .eq("id", id);

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/dashboard");
    revalidatePath("/programs");
    revalidatePath(`/programs/${id}`);

    return {
      ok: true,
      message: "Program updated."
    };
  } catch (error) {
    return errorState(error, "Could not update program.");
  }
}

export async function assignProgramAction(
  _previousState: ActionState = INITIAL_STATE,
  formData: FormData
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const deviceId = asText(formData, "device_id");
    const programId = asText(formData, "program_id");

    if (!deviceId || !programId) {
      return {
        ok: false,
        message: "Choose a program to assign."
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("device_program_assignments").insert({
      device_id: deviceId,
      program_id: programId,
      assigned_by: user.id,
      is_active: true
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath("/dashboard");
    revalidatePath("/devices");
    revalidatePath(`/devices/${deviceId}`);

    return {
      ok: true,
      message: "Program assigned."
    };
  } catch (error) {
    return errorState(error, "Could not assign program. It may already be active on this device.");
  }
}

export async function deactivateAssignmentAction(formData: FormData) {
  await requireUser();
  const assignmentId = asText(formData, "assignment_id");
  const deviceId = asText(formData, "device_id");

  if (!assignmentId || !deviceId) {
    return;
  }

  const supabase = await createClient();
  await supabase
    .from("device_program_assignments")
    .update({ is_active: false })
    .eq("id", assignmentId);

  revalidatePath("/dashboard");
  revalidatePath(`/devices/${deviceId}`);
}

export async function updateMeasurementStatusAction(formData: FormData) {
  await requireUser();
  const measurementId = asText(formData, "measurement_id");
  const status = asText(formData, "cloud_verification_status");

  if (!measurementId || !["pending", "stored", "failed"].includes(status)) {
    return;
  }

  const supabase = await createClient();
  await supabase
    .from("measurements")
    .update({ cloud_verification_status: status })
    .eq("id", measurementId);

  revalidatePath("/measurements");
}
