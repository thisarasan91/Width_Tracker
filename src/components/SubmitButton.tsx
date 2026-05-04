"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: ReactNode;
  className?: string;
};

export function SubmitButton({ children, className = "button primary" }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? <Loader2 aria-hidden="true" className="icon spin" /> : null}
      {children}
    </button>
  );
}
