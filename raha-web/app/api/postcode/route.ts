import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy to the official NIPOST Postcode API (https://docs.postcode.gov.ng).
 * Every upstream endpoint needs an API key, so the key stays on the server:
 *   POSTCODE_API_KEY=nipost_test_...  (sandbox)  or  nipost_live_...  (production)
 *   POSTCODE_MAX_LEVEL=1              (optional; levels 2+ cost credits and return house addresses)
 *
 * GET /api/postcode?action=verify&code=AA 99 H77 BB 55[&level=1]
 * GET /api/postcode?action=autocomplete&q=EK 01 A
 * GET /api/postcode?action=reverse&lat=..&lng=..[&max_distance_m=25]
 * GET /api/postcode?action=nearby&lat=..&lng=..[&radius=300]
 * GET /api/postcode?action=states
 * GET /api/postcode?action=lgas&state=XX
 * GET /api/postcode?action=districts&state=XX&lga=01
 * GET /api/postcode?action=areas&state=XX&lga=01&district=A01
 */

const UPSTREAM_BASE = "https://api.postcode.gov.ng";
const UPSTREAM_TIMEOUT_MS = 8000;

// 2 letters, 2 digits (01-99), 3 letters/digits, 2 letters, 2 digits (01-99) = 11 chars
const COMPACT_RE = /^[A-Z]{2}(0[1-9]|[1-9][0-9])[A-Z0-9]{3}[A-Z]{2}(0[1-9]|[1-9][0-9])$/;

type Normalized = { compact: string; canonical: string; display: string };

function normalizePostcode(input: string): Normalized | null {
  const compact = input.replace(/[\s-]+/g, "").toUpperCase();
  if (!COMPACT_RE.test(compact)) return null;
  const parts = [
    compact.slice(0, 2),
    compact.slice(2, 4),
    compact.slice(4, 7),
    compact.slice(7, 9),
    compact.slice(9, 11),
  ];
  return { compact, canonical: parts.join("-"), display: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Upstream call
// ---------------------------------------------------------------------------
type UpstreamResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: string; message: string; retryAfter?: string };

async function callUpstream(
  path: string,
  params: Record<string, string>
): Promise<UpstreamResult> {
  const apiKey = process.env.POSTCODE_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      code: "not_configured",
      message: "Postcode service is not configured on the server.",
    };
  }

  const url = new URL(path, UPSTREAM_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      code: timedOut ? "upstream_timeout" : "upstream_unreachable",
      message: timedOut
        ? "The postcode service took too long to respond."
        : "Could not reach the postcode service.",
    };
  }

  const body = (await res.json().catch(() => null)) as {
    data?: unknown;
    error?: { code?: string; message?: string };
  } | null;

  if (res.ok) return { ok: true, data: body?.data ?? null };

  const upstreamCode = body?.error?.code ?? "upstream_error";
  const upstreamMessage = body?.error?.message ?? `Upstream returned ${res.status}.`;

  // Key / credit / scope problems are our configuration, not the caller's mistake.
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    console.error(`[postcode] upstream ${res.status} ${upstreamCode}: ${upstreamMessage}`);
    return {
      ok: false,
      status: 502,
      code: "upstream_auth",
      message: "The postcode service is temporarily unavailable.",
    };
  }
  if (res.status === 429) {
    return {
      ok: false,
      status: 429,
      code: "rate_limited",
      message: "Postcode service is busy. Try again shortly.",
      retryAfter: res.headers.get("retry-after") ?? "30",
    };
  }
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    return { ok: false, status: res.status, code: upstreamCode, message: upstreamMessage };
  }
  console.error(`[postcode] upstream ${res.status} ${upstreamCode}: ${upstreamMessage}`);
  return {
    ok: false,
    status: 502,
    code: "upstream_error",
    message: "The postcode service returned an unexpected error.",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fail(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

function passthroughError(r: Extract<UpstreamResult, { ok: false }>) {
  return fail(
    r.status,
    r.code,
    r.message,
    r.retryAfter ? { "Retry-After": r.retryAfter } : undefined
  );
}

function numberParam(sp: URLSearchParams, name: string, min: number, max: number): number | null {
  const raw = sp.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// Best-effort per-IP limiter (in-memory, per server instance) to protect the shared API key.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  }
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function maxLevel(): number {
  const n = Number.parseInt(process.env.POSTCODE_MAX_LEVEL ?? "1", 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

const REFERENCE_CACHE = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return fail(429, "rate_limited", "Too many requests. Try again in a minute.", {
      "Retry-After": "60",
    });
  }

  const sp = request.nextUrl.searchParams;
  const action = sp.get("action") ?? "verify";

  switch (action) {
    case "verify": {
      const rawCode = sp.get("code");
      if (!rawCode) return fail(400, "missing_code", "Provide a postcode in ?code=.");

      const pc = normalizePostcode(rawCode);
      if (!pc) {
        return fail(
          400,
          "invalid_format",
          "Postcode must look like AA 99 H77 BB 55: 2 letters, 2 digits (01-99), 3 letters/digits, 2 letters, 2 digits (01-99)."
        );
      }

      const level = Number.parseInt(sp.get("level") ?? "1", 10);
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        return fail(400, "invalid_level", "level must be an integer from 1 to 5.");
      }
      if (level > maxLevel()) {
        return fail(403, "level_not_allowed", "That lookup level is not enabled on this server.");
      }

      const r = await callUpstream("/v1/lookup", { code: pc.canonical, level: String(level) });
      if (!r.ok) {
        // A code that is well-formed but unknown upstream is a clean "not valid", not a failure.
        if (r.status === 404) {
          return NextResponse.json({ valid: false, postcode: pc, level, details: null });
        }
        return passthroughError(r);
      }

      const details = r.data as { valid?: boolean } | null;
      return NextResponse.json({
        valid: details?.valid === true,
        postcode: pc,
        level,
        details,
      });
    }

    case "autocomplete": {
      const q = sp.get("q")?.trim();
      if (!q || q.length > 20) {
        return fail(400, "invalid_query", "Provide a partial postcode in ?q= (max 20 characters).");
      }
      const r = await callUpstream("/v1/search/autocomplete", { q });
      return r.ok ? NextResponse.json(r.data) : passthroughError(r);
    }

    case "reverse": {
      const lat = numberParam(sp, "lat", -90, 90);
      const lng = numberParam(sp, "lng", -180, 180);
      if (lat === null || lng === null) {
        return fail(400, "invalid_coordinates", "Provide valid ?lat= and ?lng= values.");
      }
      const params: Record<string, string> = { lat: String(lat), lng: String(lng) };
      const dist = numberParam(sp, "max_distance_m", 0, 250);
      if (dist !== null) params.max_distance_m = String(dist);
      const r = await callUpstream("/v1/search/reverse", params);
      return r.ok ? NextResponse.json(r.data) : passthroughError(r);
    }

    case "nearby": {
      const lat = numberParam(sp, "lat", -90, 90);
      const lng = numberParam(sp, "lng", -180, 180);
      if (lat === null || lng === null) {
        return fail(400, "invalid_coordinates", "Provide valid ?lat= and ?lng= values.");
      }
      const params: Record<string, string> = { lat: String(lat), lng: String(lng) };
      const radius = numberParam(sp, "radius", 1, 300);
      if (radius !== null) params.radius = String(radius);
      const r = await callUpstream("/v1/search/nearby", params);
      return r.ok ? NextResponse.json(r.data) : passthroughError(r);
    }

    case "states": {
      const r = await callUpstream("/v1/reference/states", {});
      return r.ok ? NextResponse.json(r.data, { headers: REFERENCE_CACHE }) : passthroughError(r);
    }

    case "lgas": {
      const state = sp.get("state")?.toUpperCase();
      if (!state || !/^[A-Z]{2}$/.test(state)) {
        return fail(400, "invalid_state", "Provide a 2-letter state code in ?state=.");
      }
      const r = await callUpstream("/v1/reference/lgas", { state });
      return r.ok ? NextResponse.json(r.data, { headers: REFERENCE_CACHE }) : passthroughError(r);
    }

    case "districts": {
      const state = sp.get("state")?.toUpperCase();
      const lga = sp.get("lga");
      if (!state || !/^[A-Z]{2}$/.test(state) || !lga || !/^(0[1-9]|[1-9][0-9])$/.test(lga)) {
        return fail(400, "invalid_params", "Provide ?state= (2 letters) and ?lga= (01-99).");
      }
      const r = await callUpstream("/v1/reference/districts", { state, lga });
      return r.ok ? NextResponse.json(r.data, { headers: REFERENCE_CACHE }) : passthroughError(r);
    }

    case "areas": {
      const state = sp.get("state")?.toUpperCase();
      const lga = sp.get("lga");
      const district = sp.get("district")?.toUpperCase();
      if (
        !state || !/^[A-Z]{2}$/.test(state) ||
        !lga || !/^(0[1-9]|[1-9][0-9])$/.test(lga) ||
        !district || !/^[A-Z0-9]{3}$/.test(district)
      ) {
        return fail(
          400,
          "invalid_params",
          "Provide ?state= (2 letters), ?lga= (01-99) and ?district= (3 characters)."
        );
      }
      const r = await callUpstream("/v1/reference/areas", { state, lga, district });
      return r.ok ? NextResponse.json(r.data, { headers: REFERENCE_CACHE }) : passthroughError(r);
    }

    default:
      return fail(
        400,
        "unknown_action",
        "action must be one of: verify, autocomplete, reverse, nearby, states, lgas, districts, areas."
      );
  }
}
