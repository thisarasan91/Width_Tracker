export type DeviceSettingsPayload = {
  edge_settings: Record<string, unknown>;
  app_settings: Record<string, unknown>;
};

export const defaultEdgeSettings: Record<string, number> = {
  brightness: 0,
  contrast: 0,
  blur: 5,
  canny_low: 50,
  canny_high: 150,
  hough_th: 60,
  min_line_len: 120,
  max_line_gap: 20,
  angle_tol: 12,
  roi_top: 15,
  roi_bottom: 85,
  roi_left: 0,
  roi_right: 100,
  min_sep_px: 30,
  show_edges: 1
};

export const defaultAppSettings: Record<string, number | boolean> = {
  stable_seconds: 1.0,
  countdown_seconds: 3,
  stable_tolerance_mm: 0.15,
  stable_tolerance_px: 4.0,
  require_center_alignment: true,
  manual_vertical_alignment_tolerance_deg: 1.0,
  removal_seconds: 0.6,
  center_alignment_tolerance_ratio: 0.03,
  center_alignment_tolerance_px: 0,
  angle_alignment_tolerance_deg: 2.0,
  inactivity_shutdown_seconds: 300,
  shutdown_warning_seconds: 30,
  enable_auto_shutdown: true,
  splash_image_scale: 0.35,
  font_thickness_scale: 0.55
};

export function cleanSettingsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function mergeDeviceSettings(row?: Partial<DeviceSettingsPayload> | null): DeviceSettingsPayload {
  return {
    edge_settings: {
      ...defaultEdgeSettings,
      ...cleanSettingsObject(row?.edge_settings)
    },
    app_settings: {
      ...defaultAppSettings,
      ...cleanSettingsObject(row?.app_settings)
    }
  };
}

export function formatSettingsJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}
