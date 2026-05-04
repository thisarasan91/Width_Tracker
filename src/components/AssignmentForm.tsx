"use client";

import { useActionState } from "react";
import { Link2 } from "lucide-react";
import type { ActionState, Program } from "@/lib/types";
import { assignProgramAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionState = {
  ok: false,
  message: ""
};

export function AssignmentForm({ deviceId, programs }: { deviceId: string; programs: Program[] }) {
  const [state, formAction] = useActionState(assignProgramAction, initialState);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Assignments</p>
          <h2>Assign program</h2>
        </div>
      </div>
      <form className="form-grid" action={formAction}>
        <input type="hidden" name="device_id" value={deviceId} />
        <label>
          Program
          <select name="program_id" required defaultValue="">
            <option value="" disabled>
              Choose an active program
            </option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.program_name} ({program.required_data_points_per_measurement} readings)
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <SubmitButton>
            <Link2 aria-hidden="true" className="icon" />
            Assign
          </SubmitButton>
        </div>
      </form>
      {state.message ? <p className={state.ok ? "form-message success" : "form-message"}>{state.message}</p> : null}
    </section>
  );
}
