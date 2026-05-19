"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { updateDeviceSettingsAction } from "@/lib/actions";
import { formatSettingsJson, mergeDeviceSettings } from "@/lib/deviceSettings";
import type { ActionState, DeviceSettings } from "@/lib/types";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionState = {
  ok: false,
  message: ""
};

type DeviceSettingsFormProps = {
  deviceId: string;
  settings?: DeviceSettings | null;
};

export function DeviceSettingsForm({ deviceId, settings }: DeviceSettingsFormProps) {
  const [state, formAction] = useActionState(updateDeviceSettingsAction, initialState);
  const mergedSettings = mergeDeviceSettings(settings);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Pi Parameters</p>
          <h2>Device settings</h2>
        </div>
      </div>
      <form className="form-grid two-column" action={formAction}>
        <input type="hidden" name="device_id" value={deviceId} />
        <label>
          Edge settings JSON
          <textarea
            className="settings-textarea"
            name="edge_settings"
            rows={16}
            spellCheck={false}
            defaultValue={formatSettingsJson(mergedSettings.edge_settings)}
          />
        </label>
        <label>
          App settings JSON
          <textarea
            className="settings-textarea"
            name="app_settings"
            rows={16}
            spellCheck={false}
            defaultValue={formatSettingsJson(mergedSettings.app_settings)}
          />
        </label>
        <div className="form-actions">
          <SubmitButton>
            <Save aria-hidden="true" className="icon" />
            Save device settings
          </SubmitButton>
        </div>
      </form>
      {state.message ? <p className={state.ok ? "form-message success" : "form-message"}>{state.message}</p> : null}
    </section>
  );
}
