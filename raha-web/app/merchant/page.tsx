"use client";

import { useCallback, useState } from "react";
import { RoleGate } from "@/components/role-gate";
import { Badge, ErrorBanner, Notice, Spinner, orderTone } from "@/components/ui";
import { formatNaira, formatWhen, one, ORDER_LABEL, shortId } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { OrderStatus, PaymentStatus, Profile } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

type Shop = { id: string; business_name: string; is_verified: boolean; is_active: boolean };
type Product = { id: string; name: string; price: number; is_available: boolean; stock_qty: number | null };
type MOrder = {
  id: string;
  status: OrderStatus;
  total: number;
  payment_status: PaymentStatus;
  notes: string | null;
  created_at: string;
  order_items: { id: string; product_name: string; quantity: number; unit_price: number }[];
  deliveries: { recipient_name: string | null } | { recipient_name: string | null }[] | null;
};

const ACTIVE: OrderStatus[] = ["pending", "confirmed", "preparing", "ready_for_pickup", "out_for_delivery"];

export default function MerchantPage() {
  return (
    <RoleGate roles={["merchant"]} title="Seller portal">
      {({ profile }) => <Dashboard profile={profile} />}
    </RoleGate>
  );
}

function Dashboard({ profile }: { profile: Profile }) {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<MOrder[]>([]);
  const [tab, setTab] = useState<"orders" | "products">("orders");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: s, error: sErr } = await supabase
      .from("merchants")
      .select("id, business_name, is_verified, is_active")
      .eq("owner_id", profile.id)
      .maybeSingle();
    if (sErr) return setError(sErr.message);
    setShop((s as Shop | null) ?? null);
    if (!s) return;

    const [p, o] = await Promise.all([
      supabase.from("products").select("id, name, price, is_available, stock_qty").eq("merchant_id", s.id).order("name"),
      supabase
        .from("orders")
        .select(
          "id, status, total, payment_status, notes, created_at, order_items(id, product_name, quantity, unit_price), deliveries(recipient_name)"
        )
        .eq("merchant_id", s.id)
        .in("status", ACTIVE)
        .order("created_at", { ascending: false }),
    ]);
    if (p.error || o.error) return setError((p.error ?? o.error)!.message);
    setProducts((p.data as Product[]) ?? []);
    setOrders((o.data as unknown as MOrder[]) ?? []);
  }, [profile.id]);

  usePoll(load, 15000);

  async function toggle(p: Product) {
    const next = !p.is_available;
    setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, is_available: next } : x)));
    const { error: err } = await supabase.from("products").update({ is_available: next }).eq("id", p.id);
    if (err) {
      setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, is_available: p.is_available } : x)));
      setError(err.message);
    }
  }

  async function advance(o: MOrder, to: OrderStatus) {
    setBusy(o.id);
    setError(null);
    const { error: err } = await supabase.from("orders").update({ status: to }).eq("id", o.id).eq("status", o.status);
    if (err) setError(err.message);
    await load();
    setBusy(null);
  }

  if (shop === undefined) return <Spinner />;
  if (shop === null) {
    return (
      <Notice title="No shop linked to this account">
        Ask the RAHA admin to set up your shop, then refresh.
      </Notice>
    );
  }

  const newCount = orders.filter((o) => o.status === "pending").length;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{shop.business_name}</h1>
        {!shop.is_verified && (
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Your shop is waiting for approval. Customers can’t see it yet.
          </p>
        )}
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-200 p-1" role="tablist">
        {(["orders", "products"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg py-2.5 text-sm font-bold capitalize ${tab === t ? "bg-white shadow" : "text-slate-600"}`}
          >
            {t}
            {t === "orders" && newCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">{newCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        orders.length === 0 ? (
          <p className="py-12 text-center text-slate-500">No active orders. New ones appear here automatically.</p>
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => {
              const recipient = one(o.deliveries)?.recipient_name;
              const paid = o.payment_status === "paid";
              return (
                <li key={o.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-bold">#{shortId(o.id)}</p>
                      <p className="text-xs text-slate-500">{formatWhen(o.created_at)}{recipient ? ` · ${recipient}` : ""}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Badge>
                      <Badge tone={paid ? "green" : "amber"}>{paid ? "Paid" : "Awaiting payment"}</Badge>
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1 text-sm">
                    {o.order_items.map((it) => (
                      <li key={it.id} className="flex justify-between gap-3">
                        <span>{it.quantity} × {it.product_name}</span>
                        <span className="text-slate-600">{formatNaira(it.quantity * it.unit_price)}</span>
                      </li>
                    ))}
                  </ul>
                  {o.notes && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">Note: {o.notes}</p>}

                  {o.status === "pending" && (
                    <div className="mt-4">
                      <button
                        disabled={!paid || busy === o.id}
                        onClick={() => advance(o, "confirmed")}
                        className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white active:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {busy === o.id ? "Working…" : "Accept Order"}
                      </button>
                      {!paid && <p className="mt-2 text-center text-xs text-slate-500">You can accept once RAHA confirms the customer’s transfer.</p>}
                    </div>
                  )}
                  {(o.status === "confirmed" || o.status === "preparing") && (
                    <button
                      disabled={busy === o.id}
                      onClick={() => advance(o, "ready_for_pickup")}
                      className="mt-4 w-full rounded-xl bg-sky-600 py-4 text-base font-bold text-white active:bg-sky-700 disabled:opacity-60"
                    >
                      {busy === o.id ? "Working…" : "Mark Ready for Pickup"}
                    </button>
                  )}
                  {o.status === "ready_for_pickup" && <p className="mt-4 text-center text-sm font-medium text-slate-600">Waiting for the rider to collect it.</p>}
                  {o.status === "out_for_delivery" && <p className="mt-4 text-center text-sm font-medium text-slate-600">Rider is on the way to the customer.</p>}
                </li>
              );
            })}
          </ul>
        )
      ) : products.length === 0 ? (
        <p className="py-12 text-center text-slate-500">No products yet. Ask the RAHA admin to add your menu.</p>
      ) : (
        <ul className="space-y-2">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-sm text-slate-500">
                  {formatNaira(p.price)}
                  {p.stock_qty !== null ? ` · ${p.stock_qty} in stock` : ""}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={p.is_available}
                aria-label={`${p.name} available`}
                onClick={() => toggle(p)}
                className="flex shrink-0 items-center gap-3"
              >
                <span className={`text-sm font-semibold ${p.is_available ? "text-emerald-700" : "text-slate-500"}`}>
                  {p.is_available ? "Available" : "Unavailable"}
                </span>
                <span className={`relative h-8 w-14 rounded-full transition-colors ${p.is_available ? "bg-emerald-600" : "bg-slate-300"}`}>
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${p.is_available ? "left-7" : "left-1"}`} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
