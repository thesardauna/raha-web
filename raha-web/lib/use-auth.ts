"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load(s: Session | null) {
      if (!active) return;
      setSession(s);
      if (!s) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("id, full_name, phone, role")
        .eq("id", s.user.id)
        .maybeSingle();
      if (!active) return;
      setProfile((data as Profile | null) ?? null);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => load(data.session));
    // Don't await Supabase calls inside this callback; defer to avoid auth lock deadlocks.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setTimeout(() => load(s), 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, profile, loading };
}

export async function signOut() {
  await supabase.auth.signOut();
}
