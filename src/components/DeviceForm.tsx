"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import type { ActionState, Device } from "@/lib/types";
import { updateDeviceAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionState = {
  ok: false,
  message: ""
};

export function DeviceForm({ device }: { device: Device }) {
  const [state, formAction] = useActionState(updateDeviceAction, initialState);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Device Details</p>
          <h2>Edit device</h2>
        </div>
      </div>
      <form className="form-grid two-column" action={formAction}>
        <input type="hidden" name="id" value={device.id} />
        <label>
          Device name
          <input name="device_name" required defaultValue={device.device_name} />
        </label>
        <label>
          Serial number
          <input name="serial_number" required defaultValue={device.serial_number} />
        </label>
        <label>
          Location
          <input name="location" defaultValue={device.location ?? ""} />
        </label>
        <label>
          Loom name
          <input name="loom_name" defaultValue={device.loom_name ?? ""} />
        </label>
        <div className="form-actions">
          <SubmitButton>
            <Save aria-hidden="true" className="icon" />
            Save device
          </SubmitButton>
        </div>
      </form>
      {state.message ? <p className={state.ok ? "form-message success" : "form-message"}>{state.message}</p> : null}
    </section>
  );
}
