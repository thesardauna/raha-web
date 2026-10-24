import type { ReactNode } from "react";
import type { DeliveryStatus, OrderStatus } from "@/lib/types";

type Tone = "gray" | "green" | "amber" | "blue" | "red";

const TONES: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-sky-100 text-sky-800",
  red: "bg-rose-100 text-rose-800",
};

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function orderTone(s: OrderStatus): Tone {
  if (s === "pending") return "amber";
  if (s === "delivered") return "green";
  if (s === "cancelled") return "red";
  if (s === "out_for_delivery") return "blue";
  return "gray";
}

export function deliveryTone(s: DeliveryStatus): Tone {
  if (s === "awaiting_rider") return "amber";
  if (s === "delivered") return "green";
  if (s === "failed" || s === "cancelled") return "red";
  if (s === "picked_up" || s === "in_transit") return "blue";
  return "gray";
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <span>{message}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 font-semibold" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <div className="mt-2 text-sm text-slate-600">{children}</div>
    </div>
  );
}
