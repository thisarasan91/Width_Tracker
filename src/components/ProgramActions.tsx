"use client";

import { useActionState } from "react";
import { ArchiveX, Trash2 } from "lucide-react";
import { deactivateProgramAction, deleteProgramAction } from "@/lib/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = {
  ok: false,
  message: ""
};

type ProgramActionsProps = {
  programId: string;
  isActive: boolean;
  redirectAfterDelete?: boolean;
};

export function ProgramActions({ programId, isActive, redirectAfterDelete = false }: ProgramActionsProps) {
  const [deactivateState, deactivateFormAction] = useActionState(deactivateProgramAction, initialState);
  const [deleteState, deleteFormAction] = useActionState(deleteProgramAction, initialState);
  const latestState = deleteState.message ? deleteState : deactivateState;

  return (
    <div className="program-actions">
      <div className="program-actions-row">
        {isActive ? (
          <form action={deactivateFormAction}>
            <input type="hidden" name="program_id" value={programId} />
            <button className="button secondary" type="submit">
              <ArchiveX aria-hidden="true" className="icon" />
              Deactivate
            </button>
          </form>
        ) : null}
        <form
          action={deleteFormAction}
          onSubmit={(event) => {
            if (!window.confirm("Delete this program? This cannot be undone.")) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="program_id" value={programId} />
          {redirectAfterDelete ? <input type="hidden" name="redirect_to" value="/programs" /> : null}
          <button className="button danger" type="submit">
            <Trash2 aria-hidden="true" className="icon" />
            Delete
          </button>
        </form>
      </div>
      {latestState.message ? (
        <p className={latestState.ok ? "form-message success compact-message" : "form-message compact-message"}>
          {latestState.message}
        </p>
      ) : null}
    </div>
  );
}
