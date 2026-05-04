"use client";

import { useActionState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import type { ActionState } from "@/lib/types";
import { createDeviceAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionState = {
  ok: false,
  message: ""
};

export function CreateDeviceForm() {
  const [state, formAction] = useActionState(createDeviceAction, initialState);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Device Registry</p>
          <h2>Add Raspberry Pi device</h2>
        </div>
      </div>
      <form className="form-grid two-column" action={formAction}>
        <label>
          Device name
          <input name="device_name" required placeholder="Pi Width Station 01" />
        </label>
        <label>
          Serial number
          <input name="serial_number" required placeholder="RP5-WIDTH-001" />
        </label>
        <label>
          Location
          <input name="location" placeholder="Factory A" />
        </label>
        <label>
          Loom name
          <input name="loom_name" placeholder="Loom 14" />
        </label>
        <div className="form-actions">
          <SubmitButton>
            <Plus aria-hidden="true" className="icon" />
            Create device
          </SubmitButton>
        </div>
      </form>

      {state.message ? <p className={state.ok ? "form-message success" : "form-message"}>{state.message}</p> : null}
      {state.token ? (
        <div className="token-box">
          <div className="token-box-heading">
            <ShieldCheck aria-hidden="true" className="icon" />
            One-time device token
          </div>
          <code>{state.token}</code>
        </div>
      ) : null}
    </section>
  );
}
