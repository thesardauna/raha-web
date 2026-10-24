"use client";

import { useCallback, useMemo, useState } from "react";
import { RoleGate } from "@/components/role-gate";
import { Badge, ErrorBanner, Spinner, deliveryTone, orderTone } from "@/components/ui";
import { authedPost } from "@/lib/api-client";
import { DELIVERY_LABEL, formatNaira, formatWhen, one, ORDER_LABEL, shortId } from "@/lib/format";
import { formatPostcode } from "@/lib/postcode";
import { supabase } from "@/lib/supabase";
import type { DeliveryStatus, OrderStatus, PaymentStatus } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

type Delivery = {
  id: string;
  status: DeliveryStatus;
  rider_id: string | null;
  pickup_postcode: string;
  destination_postcode: string;
  destination_address: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  pickup_postcode_verified: boolean;
  destination_postcode_verified: boolean;
};
type AOrder = {
  id: string;
  status: OrderStatus;
  total: number;
  payment_status: PaymentStatus;
  created_at: string;
  merchants: { business_name: string } | { business_name: string }[] | null;
  order_items: { product_name: string; quantity: number }[];
  deliveries: Delivery | Delivery[] | null;
};
type Rider = { id: string; full_name: string | null; phone: string | null };

const ACTIVE_DELIVERY: DeliveryStatus[] = ["assigned", "picked_up", "in_transit"];
type Filter = "all" | "payment" | "rider" | "active" | "done";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "payment", label: "Needs payment" },
  { id: "rider", label: "Needs rider" },
  { id: "active", label: "In progress" },
  { id: "done", label: "Done" },
];

export default function AdminPage() {
  return (
    <RoleGate roles={["admin"]} title="Dispatcher" wide>
      {({ token }) => <Grid token={token} />}
    </RoleGate>
  );
}

function PostcodeLine({ label, code, verified }: { label: string; code: string; verified: boolean }) {
  return (
    <p className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-semibold">
        {formatPostcode(code)}{" "}
        <span className={verified ? "text-emerald-600" : "text-amber-600"} title={verified ? "Confirmed with NIPOST" : "Not confirmed with NIPOST"}>
          {verified ? "✓" : "?"}
        </span>
      </span>
    </p>
  );
}

function Grid({ token }: { token: string }) {
  const [orders, setOrders] = useState<AOrder[] | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, r] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, status, total, payment_status, created_at, merchants(business_name), order_items(product_name, quantity), deliveries(id, status, rider_id, pickup_postcode, destination_postcode, destination_address, recipient_name, recipient_phone, pickup_postcode_verified, destination_postcode_verified)"
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("users").select("id, full_name, phone").eq("role", "rider").order("full_name"),
    ]);
    if (o.error || r.error) return setError((o.error ?? r.error)!.message);
    setOrders((o.data as unknown as AOrder[]) ?? []);
    setRiders((r.data as Rider[]) ?? []);
  }, []);

  usePoll(load, 15000);

  const activeByRider = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders ?? []) {
      const d = one(o.deliveries);
      if (d?.rider_id && ACTIVE_DELIVERY.includes(d.status)) m.set(d.rider_id, (m.get(d.rider_id) ?? 0) + 1);
    }
    return m;
  }, [orders]);

  const sortedRiders = useMemo(
    () => [...riders].sort((a, b) => (activeByRider.get(a.id) ?? 0) - (activeByRider.get(b.id) ?? 0)),
    [riders, activeByRider]
  );
  const riderName = (id: string | null) => riders.find((r) => r.id === id)?.full_name ?? "Rider";

  const counts = useMemo(() => {
    const list = orders ?? [];
    const c: Record<Filter, number> = { all: list.length, payment: 0, rider: 0, active: 0, done: 0 };
    for (const o of list) {
      const d = one(o.deliveries);
      if (o.payment_status === "unpaid" && o.status !== "cancelled") c.payment++;
      if (d?.status === "awaiting_rider" && o.status !== "cancelled") c.rider++;
      if (["confirmed", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status)) c.active++;
      if (o.status === "delivered" || o.status === "cancelled") c.done++;
    }
    return c;
  }, [orders]);

  const visible = (orders ?? []).filter((o) => {
    const d = one(o.deliveries);
    switch (filter) {
      case "payment": return o.payment_status === "unpaid" && o.status !== "cancelled";
      case "rider": return d?.status === "awaiting_rider" && o.status !== "cancelled";
      case "active": return ["confirmed", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status);
      case "done": return o.status === "delivered" || o.status === "cancelled";
      default: return true;
    }
  });

  async function confirmPayment(o: AOrder) {
    if (!confirm(`Confirm you received ${formatNaira(o.total)} for order #${shortId(o.id)}?`)) return;
    setBusy(o.id);
    setError(null);
    try {
      await authedPost("/api/admin/confirm-payment", token, { orderId: o.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm payment.");
    } finally {
      setBusy(null);
    }
  }

  async function assign(d: Delivery) {
    const riderId = pick[d.id];
    if (!riderId) return;
    setBusy(d.id);
    setError(null);
    try {
      await authedPost("/api/admin/assign", token, { deliveryId: d.id, riderId });
      setPick((p) => {
        const next = { ...p };
        delete next[d.id];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign the rider.");
    } finally {
      setBusy(null);
    }
  }

  if (orders === null) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${filter === f.id ? "bg-emerald-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
          >
            {f.label} <span className="opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-slate-500">Nothing here right now.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((o) => {
            const d = one(o.deliveries);
            const shop = one(o.merchants);
            const paid = o.payment_status === "paid";
            const canAssign = d && (d.status === "awaiting_rider" || d.status === "assigned") && o.status !== "cancelled";
            return (
              <article key={o.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold">#{shortId(o.id)}</p>
                    <p className="text-xs text-slate-500">{formatWhen(o.created_at)} · {shop?.business_name}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Badge>
                    {d && <Badge tone={deliveryTone(d.status)}>{DELIVERY_LABEL[d.status]}</Badge>}
                  </div>
                </header>

                <p className="mt-3 text-sm text-slate-700">
                  {o.order_items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
                </p>

                {d && (
                  <div className="mt-3 space-y-1 rounded-xl bg-slate-50 p-3">
                    <p className="text-sm font-semibold">{d.recipient_name}{d.recipient_phone ? ` · ${d.recipient_phone}` : ""}</p>
                    <p className="text-sm text-slate-600">{d.destination_address}</p>
                    <PostcodeLine label="Pickup" code={d.pickup_postcode} verified={d.pickup_postcode_verified} />
                    <PostcodeLine label="Drop-off" code={d.destination_postcode} verified={d.destination_postcode_verified} />
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold">{formatNaira(o.total)}</span>
                  <Badge tone={paid ? "green" : o.payment_status === "refunded" ? "red" : "amber"}>
                    {paid ? "Paid" : o.payment_status === "refunded" ? "Refunded" : "Unpaid"}
                  </Badge>
                </div>

                <div className="mt-auto space-y-3 pt-4">
                  {o.payment_status === "unpaid" && o.status !== "cancelled" && (
                    <button
                      disabled={busy === o.id}
                      onClick={() => confirmPayment(o)}
                      className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white active:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy === o.id ? "Confirming…" : "Confirm Payment"}
                    </button>
                  )}

                  {d && d.rider_id && (
                    <p className="text-sm text-slate-600">Rider: <span className="font-semibold">{riderName(d.rider_id)}</span></p>
                  )}

                  {canAssign && (
                    <div className="flex gap-2">
                      <select
                        aria-label="Choose a rider"
                        value={pick[d.id] ?? ""}
                        onChange={(e) => setPick((p) => ({ ...p, [d.id]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base"
                      >
                        <option value="">{d.rider_id ? "Reassign to…" : "Choose rider…"}</option>
                        {sortedRiders.map((r) => {
                          const n = activeByRider.get(r.id) ?? 0;
                          return (
                            <option key={r.id} value={r.id}>
                              {(r.full_name ?? "Rider")} · {n === 0 ? "available" : `${n} active`}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        disabled={!pick[d.id] || busy === d.id}
                        onClick={() => assign(d)}
                        className="shrink-0 rounded-xl bg-sky-600 px-5 py-3 text-base font-bold text-white active:bg-sky-700 disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {busy === d.id ? "…" : "Assign"}
                      </button>
                    </div>
                  )}
                  {canAssign && riders.length === 0 && (
                    <p className="text-xs text-slate-500">No riders yet. Set a user’s role to rider in the database.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
