import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api-auth";
import { DELIVERY_FEE_NGN } from "@/lib/config";
import { normalizePostcode } from "@/lib/postcode";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[+\d][\d\s-]{6,19}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Body = {
  merchantId: string;
  items: { productId: string; quantity: number }[];
  recipientName: string;
  recipientPhone: string;
  destinationAddress: string;
  destinationPostcode: string;
  notes: string;
};

function parseBody(b: unknown): Body | string {
  if (!b || typeof b !== "object") return "Invalid request.";
  const o = b as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const merchantId = str(o.merchantId, 40);
  if (!UUID.test(merchantId)) return "Missing shop.";

  if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > 30) return "Your cart is empty.";
  const items: Body["items"] = [];
  for (const it of o.items) {
    const r = it as Record<string, unknown>;
    const productId = str(r?.productId, 40);
    const quantity = Number(r?.quantity);
    if (!UUID.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return "Invalid cart item.";
    }
    items.push({ productId, quantity });
  }

  const recipientName = str(o.recipientName, 100);
  const recipientPhone = str(o.recipientPhone, 20);
  const destinationAddress = str(o.destinationAddress, 300);
  if (recipientName.length < 2) return "Enter the recipient's name.";
  if (!PHONE.test(recipientPhone)) return "Enter a valid phone number.";
  if (destinationAddress.length < 5) return "Enter the delivery address.";

  return {
    merchantId,
    items,
    recipientName,
    recipientPhone,
    destinationAddress,
    destinationPostcode: str(o.destinationPostcode, 30),
    notes: str(o.notes, 300),
  };
}

/** True only when NIPOST confirms the code is assigned. Never throws; failure just means "unverified". */
async function nipostConfirms(canonical: string): Promise<boolean> {
  const key = process.env.POSTCODE_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(
      `https://api.postcode.gov.ng/v1/lookup?code=${encodeURIComponent(canonical)}&level=1`,
      {
        headers: { "X-API-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      }
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: { valid?: boolean } };
    return body.data?.valid === true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(400, "Invalid request.");
  }
  const body = parseBody(raw);
  if (typeof body === "string") return apiError(400, body);

  const dest = normalizePostcode(body.destinationPostcode);
  if (!dest) {
    return apiError(400, "Postcode must be 11 characters like AA 99 H77 BB 55.");
  }

  // Shop must be live and have a pickup postcode
  const { data: merchant } = await supabaseAdmin
    .from("merchants")
    .select("id, business_name, address, postcode, is_verified, is_active")
    .eq("id", body.merchantId)
    .maybeSingle();
  if (!merchant || !merchant.is_verified || !merchant.is_active) {
    return apiError(404, "This shop is not available right now.");
  }
  const pickup = merchant.postcode ? normalizePostcode(merchant.postcode) : null;
  if (!pickup) return apiError(422, "This shop has not set its pickup postcode yet.");

  // Prices come from the database, never from the browser
  const wanted = new Map<string, number>();
  for (const it of body.items) wanted.set(it.productId, (wanted.get(it.productId) ?? 0) + it.quantity);

  const { data: products, error: pErr } = await supabaseAdmin
    .from("products")
    .select("id, name, price, is_available, stock_qty")
    .eq("merchant_id", merchant.id)
    .in("id", [...wanted.keys()]);
  if (pErr) return apiError(500, "Could not load products. Try again.");
  if (!products || products.length !== wanted.size) {
    return apiError(409, "Some items in your cart are no longer sold by this shop.");
  }

  let subtotal = 0;
  const lines: { product_id: string; product_name: string; unit_price: number; quantity: number }[] = [];
  for (const p of products) {
    const qty = wanted.get(p.id) ?? 0;
    if (!p.is_available) return apiError(409, `"${p.name}" is no longer available.`);
    if (p.stock_qty !== null && qty > p.stock_qty) {
      return apiError(409, `Only ${p.stock_qty} of "${p.name}" left.`);
    }
    const price = Number(p.price);
    subtotal += price * qty;
    lines.push({ product_id: p.id, product_name: p.name, unit_price: price, quantity: qty });
  }
  subtotal = round2(subtotal);
  const total = round2(subtotal + DELIVERY_FEE_NGN);

  const [pickupOk, destOk] = await Promise.all([
    nipostConfirms(pickup.canonical),
    nipostConfirms(dest.canonical),
  ]);

  const { data: order, error: oErr } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: auth.userId,
      merchant_id: merchant.id,
      subtotal,
      delivery_fee: DELIVERY_FEE_NGN,
      total,
      payment_method: "bank_transfer",
      notes: body.notes || null,
    })
    .select("id")
    .single();
  if (oErr || !order) return apiError(500, "Could not place your order. Try again.");

  const { error: iErr } = await supabaseAdmin
    .from("order_items")
    .insert(lines.map((l) => ({ ...l, order_id: order.id })));

  const { error: dErr } = iErr
    ? { error: iErr }
    : await supabaseAdmin.from("deliveries").insert({
        order_id: order.id,
        pickup_postcode: pickup.compact,
        pickup_address: merchant.address,
        destination_postcode: dest.compact,
        destination_address: body.destinationAddress,
        recipient_name: body.recipientName,
        recipient_phone: body.recipientPhone,
        pickup_postcode_verified: pickupOk,
        destination_postcode_verified: destOk,
        postcodes_verified_at: pickupOk && destOk ? new Date().toISOString() : null,
      });

  if (iErr || dErr) {
    await supabaseAdmin.from("orders").delete().eq("id", order.id); // cascades items + delivery
    return apiError(500, "Could not place your order. Try again.");
  }

  return NextResponse.json(
    {
      orderId: order.id as string,
      subtotal,
      deliveryFee: DELIVERY_FEE_NGN,
      total,
      destinationVerified: destOk,
    },
    { status: 201 }
  );
}
