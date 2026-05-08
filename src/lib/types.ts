export type DeviceStatus = "online" | "offline";
export type VerificationStatus = "pending" | "stored" | "failed";

export type Device = {
  id: string;
  device_name: string;
  serial_number: string;
  status: DeviceStatus;
  last_seen_at: string | null;
  location: string | null;
  loom_name: string | null;
  created_at: string;
  updated_at: string;
};

export type Program = {
  id: string;
  program_name: string;
  batch_name: string | null;
  elastic_development_reference: string | null;
  description: string | null;
  nominal_width: number | string | null;
  upper_tolerance: number | string | null;
  lower_tolerance: number | string | null;
  required_data_points_per_measurement: number;
  labels_for_each_reading: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceProgramAssignment = {
  id: string;
  device_id: string;
  program_id: string;
  assigned_by: string | null;
  assigned_at: string;
  is_active: boolean;
};

export type Measurement = {
  id: string;
  device_id: string;
  program_id: string;
  assignment_id: string | null;
  measurement_session_id: string;
  reading_label: string;
  reading_value: number | string;
  unit: string;
  operator_name: string | null;
  loom_name: string | null;
  sent_at: string;
  stored_at: string;
  cloud_verification_status: VerificationStatus;
  created_at: string;
};

export type ActionState = {
  ok: boolean;
  message: string;
  token?: string;
};
