import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-emerald-50 to-white text-slate-900">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-10">
        <header className="mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-emerald-700">RAHA</h1>
          <p className="mt-2 text-lg text-slate-600">
            Order from local shops, or send a parcel. We deliver to your door in Bauchi.
          </p>
        </header>

        <div className="space-y-4">
          <Link
            href="/market"
            className="block rounded-3xl bg-emerald-600 p-6 text-white shadow-lg shadow-emerald-600/20 active:scale-[0.99] active:bg-emerald-700"
          >
            <span className="text-3xl" aria-hidden>🛍️</span>
            <span className="mt-3 block text-2xl font-bold">Order Products</span>
            <span className="mt-1 block text-emerald-50">Browse shops near you and pay by bank transfer.</span>
          </Link>

          {/* /send is not built yet: shown disabled instead of linking to a 404. */}
          <div
            aria-disabled="true"
            className="block cursor-not-allowed rounded-3xl border-2 border-dashed border-slate-300 bg-white p-6 text-slate-500"
          >
            <span className="text-3xl" aria-hidden>📦</span>
            <span className="mt-3 flex items-center gap-2 text-2xl font-bold text-slate-700">
              Send a Parcel
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Coming soon</span>
            </span>
            <span className="mt-1 block">Have a rider pick up and deliver a package for you.</span>
          </div>
        </div>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">How it works</h2>
          <ol className="mt-3 space-y-3 text-slate-700">
            <li className="flex gap-3"><span className="font-bold text-emerald-700">1.</span> Pick items and enter your delivery address and postcode.</li>
            <li className="flex gap-3"><span className="font-bold text-emerald-700">2.</span> Pay by bank transfer. We confirm it and the shop starts preparing.</li>
            <li className="flex gap-3"><span className="font-bold text-emerald-700">3.</span> A rider picks up your order and brings it to you.</li>
          </ol>
        </section>

        <footer className="mt-auto pt-10 text-center text-sm text-slate-500">
          <span className="font-medium">Staff:</span>{" "}
          <Link href="/merchant" className="underline underline-offset-2">Seller</Link> ·{" "}
          <Link href="/driver" className="underline underline-offset-2">Rider</Link> ·{" "}
          <Link href="/admin" className="underline underline-offset-2">Dispatcher</Link>
        </footer>
      </main>
    </div>
  );
}
