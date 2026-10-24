"use client";

import { useCallback, useState } from "react";
import { RoleGate } from "@/components/role-gate";
import { Badge, ErrorBanner, Spinner, deliveryTone } from "@/components/ui";
import { DELIVERY_LABEL, one } from "@/lib/format";
import { formatPostcode } from "@/lib/postcode";
import { supabase } from "@/lib/supabase";
import type { DeliveryStatus, OrderStatus, Profile } from "@/lib/types";
import { usePoll } from "@/lib/use-poll";

type Shop = { business_name: string; phone: string | null };
type OrderEmbed = { status: OrderStatus; notes: string | null; merchants: Shop | Shop[] | null };
type Job = {
  id: string;
  status: DeliveryStatus;
  pickup_postcode: string;
  pickup_address: string | null;
  destination_postcode: string;
  destination_address: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  orders: OrderEmbed | OrderEmbed[] | null;
};

const ACTIVE: DeliveryStatus[] = ["assigned", "picked_up", "in_transit"];

export default function DriverPage() {
  return (
    <RoleGate roles={["rider"]} title="Rider">
      {({ profile }) => <Jobs profile={profile} />}
    </RoleGate>
  );
}

function PostcodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const shown = formatPostcode(code);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(shown);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable; the code is still on screen */
        }
      }}
      className="mt-1 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-lg font-bold tracking-wider active:bg-slate-200"
      aria-label={`Postcode ${shown}. Tap to copy`}
    >
      {shown}
      <span className="font-sans text-xs font-medium text-slate-500">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Jobs({ profile }: { profile: Profile }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("deliveries")
      .select(
        "id, status, pickup_postcode, pickup_address, destination_postcode, destination_address, recipient_name, recipient_phone, orders(status, notes, merchants(business_name, phone))"
      )
      .eq("rider_id", profile.id)
      .in("status", ACTIVE)
      .order("created_at", { ascending: true });
    if (err) return setError(err.message);
    setJobs((data as unknown as Job[]) ?? []);
  }, [profile.id]);

  usePoll(load, 10000);

  async function advance(job: Job, to: DeliveryStatus) {
    if (to === "delivered" && !confirm("Confirm the order has been handed to the customer?")) return;
    setBusy(job.id);
    setError(null);
    const { error: err } = await supabase.from("deliveries").update({ status: to }).eq("id", job.id).eq("status", job.status);
    if (err) setError(err.message);
    else if (to === "delivered") {
      setFlash("Delivered ✓ Well done!");
      setTimeout(() => setFlash(null), 4000);
    }
    await load();
    setBusy(null);
  }

  if (jobs === null) return <Spinner />;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Hi{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
      {flash && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-center font-semibold text-emerald-800" role="status">{flash}</p>}
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No active deliveries. Stay online. The dispatcher will assign you one, and it appears here automatically.
        </div>
      ) : (
        <ul className="space-y-4">
          {jobs.map((j) => {
            const order = one(j.orders);
            const shop = one(order?.merchants);
            const ready = order?.status === "ready_for_pickup" || order?.status === "out_for_delivery";
            return (
              <li key={j.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
                  <span className="font-semibold">Delivery</span>
                  <Badge tone={deliveryTone(j.status)}>{DELIVERY_LABEL[j.status]}</Badge>
                </div>

                <div className="space-y-5 p-4">
                  <section>
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">1 · Pick up from</h2>
                    <p className="mt-1 text-lg font-semibold">{shop?.business_name ?? "Shop"}</p>
                    {j.pickup_address && <p className="text-slate-700">{j.pickup_address}</p>}
                    <PostcodeChip code={j.pickup_postcode} />
                    {shop?.phone && (
                      <a href={`tel:${shop.phone}`} className="mt-3 flex w-full items-center justify-center rounded-xl border border-slate-300 py-3 font-semibold active:bg-slate-100">
                        Call shop · {shop.phone}
                      </a>
                    )}
                  </section>

                  <section className="border-t border-slate-100 pt-5">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">2 · Deliver to</h2>
                    <p className="mt-1 text-lg font-semibold">{j.recipient_name ?? "Customer"}</p>
                    <p className="text-slate-700">{j.destination_address}</p>
                    <PostcodeChip code={j.destination_postcode} />
                    {j.recipient_phone && (
                      <a href={`tel:${j.recipient_phone}`} className="mt-3 flex w-full items-center justify-center rounded-xl border border-slate-300 py-3 font-semibold active:bg-slate-100">
                        Call customer · {j.recipient_phone}
                      </a>
                    )}
                    {order?.notes && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Customer note: {order.notes}</p>}
                  </section>

                  {j.status === "assigned" ? (
                    <div>
                      <button
                        disabled={!ready || busy === j.id}
                        onClick={() => advance(j, "picked_up")}
                        className="w-full rounded-2xl bg-sky-600 py-5 text-lg font-bold text-white active:bg-sky-700 disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {busy === j.id ? "Updating…" : "Mark as Picked Up"}
                      </button>
                      {!ready && <p className="mt-2 text-center text-sm text-slate-500">Waiting for the shop to mark the order ready.</p>}
                    </div>
                  ) : (
                    <button
                      disabled={busy === j.id}
                      onClick={() => advance(j, "delivered")}
                      className="w-full rounded-2xl bg-emerald-600 py-5 text-lg font-bold text-white active:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy === j.id ? "Updating…" : "Mark as Delivered"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
