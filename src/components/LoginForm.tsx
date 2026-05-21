"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type Mode = "login" | "signup";

function isLocalOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function emailRedirectTo() {
  const currentOrigin = window.location.origin;
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configuredSiteUrl) {
    return `${currentOrigin}/auth/callback`;
  }

  try {
    const configuredOrigin = new URL(configuredSiteUrl).origin;
    if (isLocalOrigin(configuredOrigin) && !isLocalOrigin(currentOrigin)) {
      return `${currentOrigin}/auth/callback`;
    }
    return `${configuredOrigin}/auth/callback`;
  } catch {
    return `${currentOrigin}/auth/callback`;
  }
}

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const supabase = createClient();

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: emailRedirectTo()
            }
          });

    setIsSubmitting(false);

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Account created. Check your email if confirmation is enabled in Supabase.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="auth-panel">
      <div>
        <p className="eyebrow">TB Meter</p>
        <h1>Sign in to manage devices and measurements</h1>
      </div>

      <div className="segmented-control" aria-label="Authentication mode">
        <button
          className={mode === "login" ? "selected" : ""}
          type="button"
          onClick={() => setMode("login")}
        >
          <LogIn aria-hidden="true" className="icon" />
          Sign in
        </button>
        <button
          className={mode === "signup" ? "selected" : ""}
          type="button"
          onClick={() => setMode("signup")}
        >
          <UserPlus aria-hidden="true" className="icon" />
          Create user
        </button>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Email
          <input name="email" required type="email" autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            required
            minLength={6}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        <button className="button primary full-width" type="submit" disabled={isSubmitting}>
          {mode === "login" ? <LogIn aria-hidden="true" className="icon" /> : <UserPlus aria-hidden="true" className="icon" />}
          {isSubmitting ? "Working..." : mode === "login" ? "Sign in" : "Create user"}
        </button>
      </form>

      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
