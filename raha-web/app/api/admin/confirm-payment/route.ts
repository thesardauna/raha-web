import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req, ["admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as { orderId?: string } | null;
  if (!body?.orderId || !UUID.test(body.orderId)) return apiError(400, "Missing order.");

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ payment_status: "paid" })
    .eq("id", body.orderId)
    .eq("payment_status", "unpaid")
    .neq("status", "cancelled")
    .select("id, payment_status")
    .maybeSingle();

  if (error) return apiError(500, "Could not confirm payment. Try again.");
  if (!data) return apiError(409, "This order is already paid or cancelled.");
  return NextResponse.json(data);
}
