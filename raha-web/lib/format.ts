import type { DeliveryStatus, OrderStatus } from "@/lib/types";

const whole = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 });

export const formatNaira = (n: number) => (Number.isInteger(n) ? whole.format(n) : cents.format(n));

export const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** PostgREST returns an object or a one-element array for to-one embeds; normalise it. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export const ORDER_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  confirmed: "Accepted",
  preparing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  out_for_delivery: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  awaiting_rider: "Needs rider",
  assigned: "Rider assigned",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};
