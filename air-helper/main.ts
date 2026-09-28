// SOKREN air helper — runs on Deno Deploy.
// OpenSky blocks Cloudflare's network (even its login server), so the Cloudflare relay's
// AirHub can't reach it. This helper logs in to OpenSky and passes /states/all through.
// The relay calls it at most every 2 minutes; all caching and fan-out stay in the relay.
//
// Environment variables (set in the Deno dashboard, never in this file):
//   OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET  — OpenSky API client
//   HELPER_KEY                                — shared with the relay (wrangler secret AIR_HELPER_KEY)
//
// GET /        health, no key
// GET /check   (key) log in only — costs no OpenSky credits
// GET /states  (key) OpenSky /states/all, worldwide (4 credits)

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
let token = "", tokenExp = 0;

async function getToken(): Promise<string> {
  if (token && Date.now() < tokenExp) return token;
  const id = (Deno.env.get("OPENSKY_CLIENT_ID") || "").trim(), secret = (Deno.env.get("OPENSKY_CLIENT_SECRET") || "").trim();
  if (!id || !secret) throw new Error("OPENSKY_CLIENT_ID or OPENSKY_CLIENT_SECRET is not set in this Deno project");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret });
  const r = await fetch(TOKEN_URL, { method: "POST", body, signal: AbortSignal.timeout(15000) });
  if (!r.ok) {
    let why = ""; try { const e = await r.json(); why = [e.error, e.error_description].filter(Boolean).join(": "); } catch { /* not JSON */ }
    throw new Error("login failed (HTTP " + r.status + (why ? " " + why : "") + ")" + (id.endsWith("-api-client") ? "" : " · OPENSKY_CLIENT_ID doesn't end in -api-client"));
  }
  const d = await r.json();
  token = d.access_token;
  tokenExp = Date.now() + Math.max(60, (Number(d.expires_in) || 1800) - 120) * 1000;
  return token;
}

async function states(): Promise<Response> {
  const get = async () => fetch("https://opensky-network.org/api/states/all", { headers: { Authorization: "Bearer " + await getToken() }, signal: AbortSignal.timeout(30000) });
  let r = await get();
  if (r.status === 401) { token = ""; r = await get(); }
  const h = new Headers({ "Content-Type": "application/json" });
  for (const k of ["X-Rate-Limit-Remaining", "X-Rate-Limit-Retry-After-Seconds"]) { const v = r.headers.get(k); if (v) h.set(k, v); }
  return new Response(r.body, { status: r.status, headers: h });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/") return new Response("SOKREN air helper · ok\n");
  const key = (Deno.env.get("HELPER_KEY") || "").trim();   // trim: pasted values often carry a line break
  if (!key) return new Response("forbidden: HELPER_KEY is not set in this Deno project", { status: 403 });
  if ((req.headers.get("x-helper-key") || "").trim() !== key) return new Response("forbidden: key does not match HELPER_KEY", { status: 403 });
  try {
    if (url.pathname === "/check") { const t0 = Date.now(); await getToken(); return Response.json({ login: "ok", ms: Date.now() - t0 }); }
    if (url.pathname === "/states") return await states();
    return new Response("not found", { status: 404 });
  } catch (e) {
    // 200 + {error}: a 5xx status gets its body replaced by the edge in front of Deno Deploy
    const error = String((e as Error)?.message || e);
    console.error("helper error:", error);
    return Response.json({ error });
  }
});
