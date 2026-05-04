"use client";

import { useActionState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import type { ActionState } from "@/lib/types";
import { rotateDeviceTokenAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionState = {
  ok: false,
  message: ""
};

export function RotateTokenForm({ deviceId }: { deviceId: string }) {
  const [state, formAction] = useActionState(rotateDeviceTokenAction, initialState);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Security</p>
          <h2>Device API token</h2>
        </div>
      </div>
      <form action={formAction}>
        <input type="hidden" name="device_id" value={deviceId} />
        <SubmitButton className="button secondary">
          <RefreshCw aria-hidden="true" className="icon" />
          Rotate token
        </SubmitButton>
      </form>
      {state.message ? <p className={state.ok ? "form-message success" : "form-message"}>{state.message}</p> : null}
      {state.token ? (
        <div className="token-box">
          <div className="token-box-heading">
            <ShieldCheck aria-hidden="true" className="icon" />
            New one-time device token
          </div>
          <code>{state.token}</code>
        </div>
      ) : null}
    </section>
  );
}
