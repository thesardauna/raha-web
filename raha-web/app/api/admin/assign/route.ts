import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as { deliveryId?: string; riderId?: string } | null;
  if (!body?.deliveryId || !body.riderId || !UUID.test(body.deliveryId) || !UUID.test(body.riderId)) {
    return apiError(400, "Choose a delivery and a rider.");
  }

  const { data: rider } = await supabaseAdmin
    .from("users")
    .select("id, role")
    .eq("id", body.riderId)
    .maybeSingle();
  if (!rider || rider.role !== "rider") return apiError(422, "That user is not a rider.");

  const { data, error } = await supabaseAdmin
    .from("deliveries")
    .update({ rider_id: body.riderId, status: "assigned" })
    .eq("id", body.deliveryId)
    .in("status", ["awaiting_rider", "assigned"]) // can't reassign once picked up
    .select("id, status, rider_id")
    .maybeSingle();

  if (error) return apiError(500, "Could not assign the rider. Try again.");
  if (!data) return apiError(409, "This delivery can no longer be assigned.");
  return NextResponse.json(data);
}
