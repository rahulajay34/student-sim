// Live USD→INR exchange rate.
//
// Anthropic/OpenAI bill in USD; the Usage page shows INR. We fetch a daily rate
// from a free FX API and cache it (the host persists the cached record — app_config
// on Supabase, a JSON collection on the legacy server). usd_cost is stored per
// event in USD; the current rate is applied at read time, so re-rating is free and
// FX moves apply to historical rows too.
//
// Storage-agnostic: the host loads the cached record, calls resolveUsdInrRate(),
// and persists the returned record when it changed.

export const FX_FALLBACK = 86.5;          // sane default if the network is unavailable
export const FX_TTL_MS = 12 * 60 * 60 * 1000;  // refresh at most twice a day

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Try a couple of free, key-less FX endpoints. Returns a positive number or null.
export async function fetchUsdInr(fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return null;
  const sources = [
    { url: "https://open.er-api.com/v6/latest/USD", pick: (j) => j?.rates?.INR },
    { url: "https://api.exchangerate.host/latest?base=USD&symbols=INR", pick: (j) => j?.rates?.INR },
  ];
  for (const s of sources) {
    try {
      const res = await f(s.url, { signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined });
      if (!res.ok) continue;
      const j = await res.json();
      const rate = num(s.pick(j));
      if (rate && rate > 0) return rate;
    } catch {
      /* try next source */
    }
  }
  return null;
}

export function isStale(cached, nowMs) {
  if (!cached || !num(cached.rate)) return true;
  const t = Date.parse(cached.fetchedAt || "");
  return !Number.isFinite(t) || nowMs - t > FX_TTL_MS;
}

/**
 * resolveUsdInrRate(cached, { nowMs, nowIso, fetchImpl })
 * Returns { record, changed } where record = { rate, fetchedAt, source }.
 * Falls back to the cached value, then FX_FALLBACK, if the fetch fails.
 */
export async function resolveUsdInrRate(cached, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = opts.nowIso ?? new Date(nowMs).toISOString();
  if (!isStale(cached, nowMs)) return { record: cached, changed: false };

  const rate = await fetchUsdInr(opts.fetchImpl);
  if (rate) {
    return { record: { rate, fetchedAt: nowIso, source: "live" }, changed: true };
  }
  if (cached && num(cached.rate)) {
    // Keep the stale rate but don't hammer the API again immediately.
    return { record: { ...cached, fetchedAt: nowIso, source: "stale" }, changed: true };
  }
  return { record: { rate: FX_FALLBACK, fetchedAt: nowIso, source: "fallback" }, changed: true };
}
