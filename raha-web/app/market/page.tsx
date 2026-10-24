"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { ErrorBanner, Spinner } from "@/components/ui";
import { authedPost } from "@/lib/api-client";
import { BANK, bankConfigured, DELIVERY_FEE_NGN } from "@/lib/config";
import { formatNaira, shortId } from "@/lib/format";
import { formatPostcode, isValidPostcode, POSTCODE_LENGTH, toCompact } from "@/lib/postcode";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/use-auth";

type Merchant = { id: string; business_name: string; description: string | null; address: string | null };
type Product = {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  stock_qty: number | null;
};
type Placed = { orderId: string; total: number; destinationVerified: boolean };
type PcState = "idle" | "checking" | "verified" | "unverified" | "invalid";

const MAX_QTY = 20;
const field =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

function BankDetails({ amount, reference }: { amount?: number; reference?: string }) {
  if (!bankConfigured) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Bank details are not set up yet. Add NEXT_PUBLIC_BANK_NAME, NEXT_PUBLIC_BANK_ACCOUNT_NUMBER and
        NEXT_PUBLIC_BANK_ACCOUNT_NAME to .env.local.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
      <p className="font-semibold">Pay by bank transfer</p>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between gap-3"><dt className="text-emerald-800">Bank</dt><dd className="font-medium">{BANK.bankName}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-emerald-800">Account number</dt><dd className="font-mono text-base font-bold">{BANK.accountNumber}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-emerald-800">Account name</dt><dd className="font-medium">{BANK.accountName}</dd></div>
        {amount !== undefined && (
          <div className="flex justify-between gap-3"><dt className="text-emerald-800">Amount</dt><dd className="font-bold">{formatNaira(amount)}</dd></div>
        )}
        {reference && (
          <div className="flex justify-between gap-3"><dt className="text-emerald-800">Narration</dt><dd className="font-mono font-bold">{reference}</dd></div>
        )}
      </dl>
      <p className="mt-3 text-emerald-900">
        After you transfer, RAHA confirms your payment and the shop starts preparing your order.
      </p>
    </div>
  );
}

export default function MarketPage() {
  const { session, profile } = useAuth();

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shopFilter, setShopFilter] = useState<string>("all");

  const [cart, setCart] = useState<Record<string, number>>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState(""); // compact, max 11 chars
  const [notes, setNotes] = useState("");
  const [pcState, setPcState] = useState<PcState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([
        supabase.from("merchants").select("id, business_name, description, address").order("business_name"),
        supabase
          .from("products")
          .select("id, merchant_id, name, description, price, image_url, stock_qty")
          .eq("is_available", true)
          .order("name"),
      ]);
      if (m.error || p.error) setError("Could not load shops. Check your connection and refresh.");
      setMerchants((m.data as Merchant[] | null) ?? []);
      setProducts((p.data as Product[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  // Pre-fill name/phone from the profile once
  useEffect(() => {
    if (profile) {
      setName((v) => v || profile.full_name || "");
      setPhone((v) => v || profile.phone || "");
    }
  }, [profile]);

  // Live postcode check against NIPOST (via our proxy)
  useEffect(() => {
    if (postcode.length < POSTCODE_LENGTH) {
      setPcState("idle");
      return;
    }
    if (!isValidPostcode(postcode)) {
      setPcState("invalid");
      return;
    }
    setPcState("checking");
    const ctl = new AbortController();
    fetch(`/api/postcode?action=verify&code=${postcode}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { valid?: boolean }) => setPcState(j.valid === true ? "verified" : "unverified"))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setPcState("unverified");
      });
    return () => ctl.abort();
  }, [postcode]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const merchantById = useMemo(() => new Map(merchants.map((m) => [m.id, m])), [merchants]);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: byId.get(id), qty }))
        .filter((l): l is { product: Product; qty: number } => Boolean(l.product)),
    [cart, byId]
  );
  const cartMerchantId = lines[0]?.product.merchant_id ?? null;
  const itemCount = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.product.price * l.qty, 0);
  const total = subtotal + DELIVERY_FEE_NGN;

  const visibleProducts = products.filter((p) => shopFilter === "all" || p.merchant_id === shopFilter);
  const shopsWithProducts = merchants.filter((m) => products.some((p) => p.merchant_id === m.id));

  function maxFor(p: Product) {
    return Math.min(MAX_QTY, p.stock_qty ?? MAX_QTY);
  }

  function add(p: Product) {
    if (cartMerchantId && cartMerchantId !== p.merchant_id) {
      if (!confirm("Your cart has items from another shop. Start a new cart with this item?")) return;
      setCart({ [p.id]: 1 });
      return;
    }
    setCart((c) => ({ ...c, [p.id]: Math.min((c[p.id] ?? 0) + 1, maxFor(p)) }));
  }

  function remove(p: Product) {
    setCart((c) => {
      const next = { ...c };
      if ((next[p.id] ?? 0) <= 1) delete next[p.id];
      else next[p.id] -= 1;
      return next;
    });
  }

  async function placeOrder(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!session || !cartMerchantId) return;
    if (!isValidPostcode(postcode)) {
      setFormError("Enter the full 11-character postcode, e.g. AA 99 H77 BB 55.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authedPost<{ orderId: string; total: number; destinationVerified: boolean }>(
        "/api/orders",
        session.access_token,
        {
          merchantId: cartMerchantId,
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
          recipientName: name,
          recipientPhone: phone,
          destinationAddress: address,
          destinationPostcode: postcode,
          notes,
        }
      );
      setPlaced(res);
      setCart({});
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function closeSheet() {
    setSheetOpen(false);
    setPlaced(null);
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-28 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-xl font-extrabold tracking-tight text-emerald-700">RAHA</Link>
          <span className="text-sm font-medium text-slate-500">Order Products</span>
        </div>
        {shopsWithProducts.length > 1 && (
          <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 pb-3">
            {[{ id: "all", business_name: "All shops" }, ...shopsWithProducts].map((m) => (
              <button
                key={m.id}
                onClick={() => setShopFilter(m.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                  shopFilter === m.id ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {m.business_name}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
        {loading ? (
          <Spinner label="Loading shops…" />
        ) : visibleProducts.length === 0 ? (
          <p className="py-16 text-center text-slate-500">No products are available right now. Please check back soon.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleProducts.map((p) => {
              const qty = cart[p.id] ?? 0;
              const soldOut = p.stock_qty === 0;
              return (
                <article key={p.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-3xl" aria-hidden>🛒</div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="truncate font-semibold">{p.name}</h3>
                    <p className="truncate text-xs text-slate-500">{merchantById.get(p.merchant_id)?.business_name}</p>
                    {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="font-bold text-emerald-700">{formatNaira(p.price)}</span>
                      {soldOut ? (
                        <span className="text-sm font-medium text-rose-600">Sold out</span>
                      ) : qty === 0 ? (
                        <button onClick={() => add(p)} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white active:bg-emerald-700">
                          Add
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button onClick={() => remove(p)} aria-label={`Remove one ${p.name}`} className="h-10 w-10 rounded-xl bg-slate-100 text-xl font-bold active:bg-slate-200">−</button>
                          <span className="w-8 text-center font-bold">{qty}</span>
                          <button onClick={() => add(p)} disabled={qty >= maxFor(p)} aria-label={`Add one more ${p.name}`} className="h-10 w-10 rounded-xl bg-emerald-600 text-xl font-bold text-white active:bg-emerald-700 disabled:opacity-40">+</button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Cart summary bar */}
      {itemCount > 0 && !sheetOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <button
            onClick={() => setSheetOpen(true)}
            className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-emerald-600 px-5 py-4 text-white active:bg-emerald-700"
          >
            <span className="font-semibold">View cart · {itemCount} {itemCount === 1 ? "item" : "items"}</span>
            <span className="text-lg font-bold">{formatNaira(subtotal)}</span>
          </button>
        </div>
      )}

      {/* Cart + checkout sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={closeSheet}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cart and checkout"
            onClick={(e) => e.stopPropagation()}
            className="mx-auto max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">{placed ? "Order placed" : "Your cart"}</h2>
              <button onClick={closeSheet} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 active:bg-slate-100">Close</button>
            </div>

            {placed ? (
              <div className="space-y-4">
                <p className="text-slate-700">
                  Thank you! Your order reference is{" "}
                  <span className="font-mono font-bold">{shortId(placed.orderId)}</span>. Transfer{" "}
                  <span className="font-bold">{formatNaira(placed.total)}</span> to confirm it.
                </p>
                <BankDetails amount={placed.total} reference={shortId(placed.orderId)} />
                {!placed.destinationVerified && (
                  <p className="text-sm text-slate-500">
                    We could not confirm your postcode with NIPOST automatically; our dispatcher will double-check it.
                  </p>
                )}
                <button onClick={closeSheet} className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white active:bg-emerald-700">
                  Done
                </button>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {lines.map(({ product, qty }) => (
                    <li key={product.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{product.name}</p>
                        <p className="text-sm text-slate-500">{formatNaira(product.price)} each</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => remove(product)} aria-label={`Remove one ${product.name}`} className="h-10 w-10 rounded-xl bg-slate-100 text-xl font-bold">−</button>
                        <span className="w-8 text-center font-bold">{qty}</span>
                        <button onClick={() => add(product)} disabled={qty >= maxFor(product)} aria-label={`Add one more ${product.name}`} className="h-10 w-10 rounded-xl bg-emerald-600 text-xl font-bold text-white disabled:opacity-40">+</button>
                      </div>
                    </li>
                  ))}
                </ul>

                <dl className="mt-2 space-y-1 border-t border-slate-200 pt-3 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-600">Items</dt><dd>{formatNaira(subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-600">Delivery</dt><dd>{formatNaira(DELIVERY_FEE_NGN)}</dd></div>
                  <div className="flex justify-between pt-1 text-lg font-bold"><dt>Total</dt><dd>{formatNaira(total)}</dd></div>
                </dl>

                <div className="mt-5">
                  {!session ? (
                    <AuthPanel heading="Sign in to place your order" />
                  ) : (
                    <form onSubmit={placeOrder} className="space-y-3">
                      <h3 className="text-lg font-bold">Delivery details</h3>
                      <input className={field} placeholder="Recipient name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
                      <input className={field} type="tel" inputMode="tel" placeholder="Phone number" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
                      <textarea className={field} rows={3} placeholder="Delivery address (street, landmark, area)" autoComplete="street-address" required value={address} onChange={(e) => setAddress(e.target.value)} />

                      <div>
                        <label htmlFor="postcode" className="mb-1 block text-sm font-semibold text-slate-700">
                          Postcode <span className="font-normal text-slate-500">(11 characters)</span>
                        </label>
                        <input
                          id="postcode"
                          className={`${field} font-mono uppercase tracking-wider`}
                          placeholder="AA 99 H77 BB 55"
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          autoComplete="off"
                          required
                          value={formatPostcode(postcode)}
                          onChange={(e) => setPostcode(toCompact(e.target.value))}
                          aria-describedby="postcode-status"
                        />
                        <p id="postcode-status" className="mt-1 min-h-5 text-sm" aria-live="polite">
                          {pcState === "checking" && <span className="text-slate-500">Checking with NIPOST…</span>}
                          {pcState === "verified" && <span className="font-medium text-emerald-700">✓ Postcode confirmed</span>}
                          {pcState === "unverified" && <span className="text-amber-700">Couldn’t confirm this code yet. You can still order; we’ll double-check it.</span>}
                          {pcState === "invalid" && <span className="text-rose-700">That doesn’t look like a valid postcode.</span>}
                          {pcState === "idle" && <span className="text-slate-500">{postcode.length}/{POSTCODE_LENGTH} characters</span>}
                        </p>
                      </div>

                      <textarea className={field} rows={2} placeholder="Notes for the shop or rider (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

                      <BankDetails />

                      {formError && <ErrorBanner message={formError} />}

                      <button
                        disabled={submitting || pcState === "invalid" || pcState === "checking"}
                        className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white active:bg-emerald-700 disabled:opacity-60"
                      >
                        {submitting ? "Placing order…" : `Place order · ${formatNaira(total)}`}
                      </button>
                    </form>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
