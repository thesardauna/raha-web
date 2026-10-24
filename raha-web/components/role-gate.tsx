"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { Notice, Spinner } from "@/components/ui";
import { signOut, useAuth } from "@/lib/use-auth";
import type { Profile, Role } from "@/lib/types";

/**
 * Page shell + sign-in/role check for staff portals.
 * NOTE: this only decides what the screen shows. Real protection is Row Level Security
 * in the database and the role checks in the /api routes.
 */
export function RoleGate({
  roles,
  title,
  wide = false,
  children,
}: {
  roles: Role[];
  title: string;
  wide?: boolean;
  children: (ctx: { profile: Profile; token: string }) => ReactNode;
}) {
  const { session, profile, loading } = useAuth();

  let body: ReactNode;
  if (loading) {
    body = <Spinner />;
  } else if (!session) {
    body = <AuthPanel heading={`Sign in to the ${title}`} />;
  } else if (!profile) {
    body = <Notice title="Setting up your profile">Refresh the page in a moment.</Notice>;
  } else if (!roles.includes(profile.role)) {
    body = (
      <Notice title="No access to this portal">
        This account is not set up as {roles.join(" / ")}. Ask the RAHA admin to enable it.
      </Notice>
    );
  } else {
    body = children({ profile, token: session.access_token });
  }

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={`mx-auto flex items-center justify-between gap-3 px-4 py-3 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>
          <div className="flex items-center gap-2">
            <Link href="/" className="text-xl font-extrabold tracking-tight text-emerald-700">RAHA</Link>
            <span className="text-sm font-medium text-slate-500">{title}</span>
          </div>
          {session && (
            <button onClick={() => signOut()} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 active:bg-slate-100">
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className={`mx-auto px-4 py-5 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{body}</main>
    </div>
  );
}
