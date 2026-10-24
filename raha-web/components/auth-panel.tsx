"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

const field =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export function AuthPanel({ heading = "Sign in to continue" }: { heading?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ type: "error", text: error.message });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (error) setMsg({ type: "error", text: error.message });
      else if (!data.session)
        setMsg({ type: "info", text: "Account created. Check your email to confirm it, then sign in." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-900">{heading}</h2>

      {mode === "signup" && (
        <input className={field} placeholder="Full name" autoComplete="name" required value={fullName}
          onChange={(e) => setFullName(e.target.value)} />
      )}
      <input className={field} type="email" placeholder="Email" autoComplete="email" required value={email}
        onChange={(e) => setEmail(e.target.value)} />
      <input className={field} type="password" placeholder="Password (min. 6 characters)" minLength={6} required
        autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password}
        onChange={(e) => setPassword(e.target.value)} />

      {msg && (
        <p className={`text-sm ${msg.type === "error" ? "text-rose-700" : "text-emerald-700"}`} role="alert">
          {msg.text}
        </p>
      )}

      <button disabled={busy}
        className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white active:bg-emerald-700 disabled:opacity-60">
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <button type="button" className="w-full py-2 text-sm font-medium text-emerald-700"
        onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}>
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
