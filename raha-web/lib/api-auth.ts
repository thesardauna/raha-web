import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Role } from "@/lib/types";

export function apiError(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export type AuthedUser = { userId: string; role: Role; fullName: string | null };

/**
 * Verifies the caller's Supabase access token (Authorization: Bearer ...) and,
 * optionally, that their role is one of `roles`. Returns the user or a ready-made error response.
 */
export async function requireUser(
  req: NextRequest,
  roles?: Role[]
): Promise<AuthedUser | NextResponse> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(401, "Please sign in first.");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return apiError(401, "Your session has expired. Please sign in again.");

  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("role, full_name")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) return apiError(403, "Your profile is not set up yet.");
  if (roles && !roles.includes(profile.role as Role)) return apiError(403, "You do not have access to this action.");

  return { userId: data.user.id, role: profile.role as Role, fullName: profile.full_name };
}
