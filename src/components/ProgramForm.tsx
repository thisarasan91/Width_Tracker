"use client";

import { useActionState } from "react";
import { Plus, Save } from "lucide-react";
import type { ActionState, Program } from "@/lib/types";
import { createProgramAction, updateProgramAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionState = {
  ok: false,
  message: ""
};

type ProgramFormProps = {
  program?: Program;
};

export function ProgramForm({ program }: ProgramFormProps) {
  const action = program ? updateProgramAction : createProgramAction;
  const [state, formAction] = useActionState(action, initialState);
  const labels = program?.labels_for_each_reading?.join("\n") ?? "";

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Program Setup</p>
          <h2>{program ? "Edit measurement program" : "Create measurement program"}</h2>
        </div>
      </div>
      <form className="form-grid two-column" action={formAction}>
        {program ? <input type="hidden" name="id" value={program.id} /> : null}
        <label>
          Program name
          <input name="program_name" required defaultValue={program?.program_name ?? ""} placeholder="3 Tape Width Check" />
        </label>
        <label>
          Batch name
          <input name="batch_name" defaultValue={program?.batch_name ?? ""} placeholder="Batch 2026-05-A" />
        </label>
        <label>
          Elastic development reference
          <input
            name="elastic_development_reference"
            defaultValue={program?.elastic_development_reference ?? ""}
            placeholder="EDR-1024"
          />
        </label>
        <label>
          Required readings
          <input
            name="required_data_points_per_measurement"
            required
            min={1}
            type="number"
            defaultValue={program?.required_data_points_per_measurement ?? 6}
          />
        </label>
        <label className="full-width">
          Description
          <textarea name="description" rows={3} defaultValue={program?.description ?? ""} />
        </label>
        <label className="full-width">
          Reading labels, one per line
          <textarea
            name="labels_for_each_reading"
            required
            rows={8}
            defaultValue={labels || "Tape 1 Left\nTape 1 Right\nTape 2 Left\nTape 2 Right\nTape 3 Left\nTape 3 Right"}
          />
        </label>
        <label className="checkbox-row">
          <input name="is_active" type="checkbox" defaultChecked={program?.is_active ?? true} />
          Active program
        </label>
        <div className="form-actions">
          <SubmitButton>
            {program ? <Save aria-hidden="true" className="icon" /> : <Plus aria-hidden="true" className="icon" />}
            {program ? "Save program" : "Create program"}
          </SubmitButton>
        </div>
      </form>
      {state.message ? <p className={state.ok ? "form-message success" : "form-message"}>{state.message}</p> : null}
    </section>
  );
}
