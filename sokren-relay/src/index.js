/*  SOKREN relay — Cloudflare Worker
    ------------------------------------------------------------------
    /ais            WebSocket. One shared upstream AISStream connection (key kept server-side)
                    fans out to every visitor. New visitors get a snapshot of every vessel the
                    hub has heard in the last 90 minutes, so the map fills instantly.
    /ais/status     JSON health line for the hub.
    /air/mil        ADS-B military aircraft worldwide (adsb.fi, adsb.lol fallback), cached 15 s.
    /air/point/LAT/LON/NM   all traffic within NM nautical miles, cached 15 s.
    /news?q=...     GDELT article search, cached 5 min.
    ------------------------------------------------------------------
    Free-plan friendly: a single Durable Object, no storage writes, cached fetches.          */

const BASE_BOXES = [            // ±3° around each SOKREN chokepoint — same list as the site
  [26.6, 56.4], [12.6, 43.4], [30.6, 32.35], [2.9, 100.8], [24.4, 119.6], [41.1, 29.1],
  [45.3, 36.6], [9.1, -79.7], [55.9, 12.7], [35.9, -5.6], [12.2, 47.5], [20.6, 121.0],
].map(([lat, lon]) => [[clampLat(lat - 3), clampLon(lon - 3)], [clampLat(lat + 3), clampLon(lon + 3)]]).concat([
  // Main shipping lanes within reach of shore receivers — same list as AIS_LANES in index.html
  [[48.5, -6.0], [51.5, 2.5]],     // English Channel
  [[51.3, 2.5], [54.5, 4.4]],      // North Sea: Rotterdam / IJmuiden approaches (offshore only — inland NL waterways swamp the feed)
  [[53.7, 5.5], [55.0, 8.2]],      // German Bight (Elbe / Weser approaches)
  [[36.5, -10.5], [44.0, -7.5]],   // Portugal / Cape Finisterre
  [[35.0, 10.0], [38.5, 16.0]],    // Sicily Channel / Malta
  [[34.5, 22.0], [38.5, 28.0]],    // Aegean / Crete
  [[31.0, 32.0], [36.5, 36.0]],    // Levant / Cyprus
  [[15.5, 36.5], [27.6, 43.0]],    // Red Sea (between Suez and Bab el-Mandeb)
  [[24.0, 48.0], [30.0, 53.4]],    // Persian Gulf (inner)
  [[17.0, 70.0], [23.0, 74.0]],    // India west coast (Mumbai)
  [[4.5, 77.0], [8.5, 83.0]],      // Sri Lanka / Dondra Head
  [[0.5, 103.5], [6.0, 109.0]],    // Singapore → South China Sea
  [[20.0, 112.0], [23.5, 117.0]],  // Pearl River Delta / Hong Kong
  [[28.5, 120.0], [32.5, 124.0]],  // Shanghai / Ningbo
  [[33.0, 126.0], [36.0, 131.0]],  // Korea Strait
  [[33.5, 135.0], [35.8, 141.0]],  // Japan Pacific coast / Tokyo Bay
  [[36.5, -77.0], [41.0, -71.0]],  // US East Coast (New York–Chesapeake)
  [[27.5, -95.5], [30.5, -88.0]],  // US Gulf (Houston–Mississippi)
  [[32.5, -121.0], [34.5, -117.0]],// Los Angeles / Long Beach
  [[-36.0, 16.0], [-33.0, 21.0]],  // Cape of Good Hope
  [[44.0, 28.5], [46.7, 33.0]],    // NW Black Sea (Odesa–Constanța)
  [[59.0, 22.0], [60.8, 30.0]],    // Gulf of Finland (Primorsk / Ust-Luga)
]);

const MSG_TYPES = ["PositionReport", "ShipStaticData", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "StaticDataReport"];
const SNAPSHOT_TTL = 90 * 60 * 1000;   // forget vessels silent this long
const IDLE_CLOSE = 3 * 60 * 1000;      // drop the upstream when nobody has been watching for this long
const MIN_FORWARD_GAP = 6 * 1000;      // per-vessel position throttle toward browsers (they redraw every 5 s anyway)
const EXTRA_BOX_TTL = 10 * 60 * 1000;  // a visitor's selected-situation box lives this long after they leave

function clampLat(v) { return Math.max(-90, Math.min(90, v)); }
function clampLon(v) { return Math.max(-180, Math.min(180, v)); }

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return list.includes(origin);
}
function corsHeaders(origin, allowed) {
  return allowed ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  } : {};
}
function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8", ...(extra || {}) } });
}

/* ---------- cached pass-through for JSON APIs (aircraft, news) ---------- */
async function cachedJSON(request, upstreams, ttlSeconds, ctx, origin, allowed) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  let hit = await cache.match(cacheKey);
  if (hit) {
    const h = new Headers(hit.headers);
    Object.entries(corsHeaders(origin, allowed)).forEach(([k, v]) => h.set(k, v));
    h.set("X-Relay-Cache", "hit");
    return new Response(hit.body, { status: hit.status, headers: h });
  }
  const errs = [];
  for (const u of upstreams) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 12000);
      let r;
      try { r = await fetch(u, { signal: c.signal, headers: { "User-Agent": "sokren-relay/1.0 (+https://www.sokren.com)", "Accept": "application/json" } }); }
      finally { clearTimeout(t); }
      if (!r.ok) { errs.push("HTTP " + r.status + " from " + new URL(u).host); continue; }
      let text = await r.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { errs.push("non-JSON from " + new URL(u).host); continue; }
      if (!parsed || typeof parsed !== "object") { errs.push("unexpected payload from " + new URL(u).host); continue; }
      // adsb.fi's point endpoint calls the list "aircraft"; the site expects readsb's "ac"
      if (Array.isArray(parsed.aircraft) && !parsed.ac) { parsed.ac = parsed.aircraft; delete parsed.aircraft; text = JSON.stringify(parsed); }
      const resp = new Response(text, { status: 200, headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=" + ttlSeconds,
        "X-Relay-Source": new URL(u).host,
      } });
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      const h = new Headers(resp.headers);
      Object.entries(corsHeaders(origin, allowed)).forEach(([k, v]) => h.set(k, v));
      h.set("X-Relay-Cache", "miss");
      return new Response(text, { status: 200, headers: h });
    } catch (e) { errs.push(new URL(u).host + ": " + String(e && e.message || e)); }
  }
  return json({ error: errs.join("; ") || "no upstream" }, 502, corsHeaders(origin, allowed));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = originAllowed(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

    if (url.pathname === "/" || url.pathname === "") {
      return new Response("SOKREN relay · ok\n\n/ais (websocket) · /ais/status · /air/mil · /air/point/LAT/LON/NM · /news?q=", { headers: { "Content-Type": "text/plain" } });
    }

    if (url.pathname === "/ais" || url.pathname === "/ais/status") {
      if (url.pathname === "/ais" && !allowed) return new Response("forbidden: origin not allowed", { status: 403 });
      if (url.pathname === "/ais" && (request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("expected a WebSocket upgrade", { status: 426 });
      const id = env.AIS_HUB.idFromName("global");
      const resp = await env.AIS_HUB.get(id).fetch(request);
      if (url.pathname === "/ais/status") {
        const h = new Headers(resp.headers);
        Object.entries(corsHeaders(origin, allowed)).forEach(([k, v]) => h.set(k, v));
        return new Response(resp.body, { status: resp.status, headers: h });
      }
      return resp;
    }

    if (!allowed) return json({ error: "origin not allowed" }, 403);

    if (url.pathname === "/air/mil") {
      // adsb.fi first: airplanes.live now needs approval (403) and adsb.lol rate-limits Cloudflare (429)
      return cachedJSON(request, ["https://opendata.adsb.fi/api/v2/mil", "https://api.adsb.lol/v2/mil"], 15, ctx, origin, allowed);
    }
    let m = url.pathname.match(/^\/air\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d{1,3})$/);
    if (m) {
      const lat = Number(m[1]).toFixed(3), lon = Number(m[2]).toFixed(3), nm = Math.min(250, Number(m[3]));
      return cachedJSON(request, ["https://opendata.adsb.fi/api/v2/lat/" + lat + "/lon/" + lon + "/dist/" + nm, "https://api.adsb.lol/v2/point/" + lat + "/" + lon + "/" + nm], 15, ctx, origin, allowed);
    }
    if (url.pathname === "/news") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
      if (!q) return json({ error: "q required" }, 400, corsHeaders(origin, allowed));
      const max = Math.min(50, Math.max(1, Number(url.searchParams.get("max") || 10) || 10));
      const span = /^\d{1,2}d$/.test(url.searchParams.get("timespan") || "") ? url.searchParams.get("timespan") : "3d";
      const g = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(q + " sourcelang:english") + "&mode=ArtList&format=json&maxrecords=" + max + "&timespan=" + span + "&sort=DateDesc";
      return cachedJSON(request, [g], 300, ctx, origin, allowed);
    }
    return new Response("not found", { status: 404 });
  },
};

/* ======================= AIS hub (Durable Object) ======================= */
export class AisHub {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.up = null;                 // upstream WebSocket to AISStream
    this.upState = "idle";          // idle | connecting | open | error
    this.upDiag = "";
    this.snapshot = new Map();      // mmsi -> { pos: text|null, stat: text|null, t: ms }
    this.lastFwd = new Map();       // mmsi -> ms of last forwarded position
    this.extra = new Map();         // boxKey -> { box, until }
    this.subKey = "";               // last subscription sent upstream
    this.stats = { msgs: 0, fwd: 0, lastMsg: 0, connectedAt: 0, reconnects: 0 };
    this.lastClientSeen = Date.now();
    this.backoff = 5000;
    this.subTimer = null;
    // restore hibernated client sockets' attachments (extra boxes) after a restart
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.boxes) this.addExtra(a.boxes);
    }
  }

  clients() { return this.ctx.getWebSockets(); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ais/status") {
      return json({
        upstream: this.upState, diag: this.upDiag, clients: this.clients().length,
        vessels: this.snapshot.size, extraBoxes: this.extra.size,
        messages: this.stats.msgs, forwarded: this.stats.fwd,
        lastMessageAgoSec: this.stats.lastMsg ? Math.round((Date.now() - this.stats.lastMsg) / 1000) : null,
        upSinceSec: this.stats.connectedAt ? Math.round((Date.now() - this.stats.connectedAt) / 1000) : null,
        reconnects: this.stats.reconnects,
      });
    }
    // WebSocket from a browser
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);          // hibernation-friendly accept
    server.serializeAttachment({ boxes: [], joined: Date.now() });
    this.lastClientSeen = Date.now();
    this.ensureUpstream();
    this.sendSnapshot(server);
    this.sendStatus(server);
    await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---- browser → hub: {"boxes":[[[lat,lon],[lat,lon]], ...]} to add a selected-situation box ---- */
  async webSocketMessage(ws, message) {
    let m; try { m = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); } catch (e) { return; }
    if (m && Array.isArray(m.boxes)) {
      const boxes = m.boxes.filter(validBox).slice(0, 2).map(b => [[clampLat(+b[0][0]), clampLon(+b[0][1])], [clampLat(+b[1][0]), clampLon(+b[1][1])]]);
      const a = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...a, boxes });
      this.addExtra(boxes);
      this.scheduleResubscribe();
    }
    if (m && m.ping) { try { ws.send(JSON.stringify({ MessageType: "RelayPong", t: Date.now() })); } catch (e) { /* ignore */ } }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) { /* ignore */ } this.lastClientSeen = Date.now(); }
  async webSocketError(ws) { try { ws.close(); } catch (e) { /* ignore */ } }

  addExtra(boxes) {
    const now = Date.now();
    for (const b of boxes) { const k = JSON.stringify(b); this.extra.set(k, { box: b, until: now + EXTRA_BOX_TTL }); }
  }

  currentBoxes() {
    const now = Date.now();
    for (const [k, v] of this.extra) if (v.until < now) this.extra.delete(k);
    // keep boxes that a live client still wants
    for (const ws of this.clients()) { const a = ws.deserializeAttachment(); if (a && a.boxes) for (const b of a.boxes) { const k = JSON.stringify(b); const e = this.extra.get(k); if (e) e.until = now + EXTRA_BOX_TTL; else this.extra.set(k, { box: b, until: now + EXTRA_BOX_TTL }); } }
    return BASE_BOXES.concat(Array.from(this.extra.values()).map(e => e.box)).slice(0, 60);
  }

  scheduleResubscribe() {
    if (this.subTimer) return;
    this.subTimer = setTimeout(() => { this.subTimer = null; this.subscribe(); }, 1500);   // AISStream allows 1 update / s
  }

  subscribe() {
    if (!this.up || this.upState !== "open") return;
    const boxes = this.currentBoxes();
    const key = JSON.stringify(boxes);
    if (key === this.subKey) return;
    this.subKey = key;
    try {
      this.up.send(JSON.stringify({ APIKey: this.env.AISSTREAM_KEY, BoundingBoxes: boxes, FilterMessageTypes: MSG_TYPES }));
    } catch (e) { this.upDiag = "subscribe failed: " + (e && e.message); }
  }

  /* ---- upstream ---- */
  async ensureUpstream() {
    if (this.up && (this.upState === "open" || this.upState === "connecting")) return;
    if (!this.env.AISSTREAM_KEY) { this.upState = "error"; this.upDiag = "AISSTREAM_KEY secret not set on the worker"; this.broadcastStatus(); return; }
    this.upState = "connecting"; this.upDiag = "connecting to AISStream";
    let resp;
    try {
      // Workers open outbound WebSockets through fetch() with an http(s) URL and an Upgrade header
      const u = String(this.env.AIS_UPSTREAM || "wss://stream.aisstream.io/v0/stream").replace(/^wss:/, "https:").replace(/^ws:/, "http:");
      resp = await fetch(u, { headers: { Upgrade: "websocket" } });
    } catch (e) { return this.upstreamFailed("connect error: " + (e && e.message)); }
    const ws = resp.webSocket;
    if (!ws) return this.upstreamFailed("upstream refused websocket (HTTP " + resp.status + ")");
    ws.accept();
    this.up = ws; this.upState = "open"; this.subKey = "";
    this.stats.connectedAt = Date.now(); this.stats.msgs = 0; this.backoff = 5000;
    this.upDiag = "connected · subscribing";
    this.subscribe();
    ws.addEventListener("message", ev => this.onUpstream(ev.data));
    ws.addEventListener("close", ev => { if (this.up === ws) { this.up = null; this.upstreamFailed("upstream closed (code " + ev.code + (ev.reason ? " " + ev.reason : "") + ")"); } });
    ws.addEventListener("error", () => { if (this.up === ws) { this.up = null; this.upstreamFailed("upstream socket error"); } });
    this.broadcastStatus();
  }

  upstreamFailed(why) {
    this.upState = "error"; this.upDiag = why; this.up = null; this.subKey = "";
    this.broadcastStatus();
    if (this.clients().length) {
      const wait = this.backoff; this.backoff = Math.min(60000, this.backoff * 2); this.stats.reconnects++;
      setTimeout(() => { if (this.clients().length) this.ensureUpstream(); }, wait);
    }
  }

  onUpstream(data) {
    let text = data;
    if (text instanceof ArrayBuffer) { try { text = new TextDecoder().decode(text); } catch (e) { return; } }
    if (typeof text !== "string") return;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m) return;
    if (m.error) { this.upDiag = "AISStream: " + String(m.error); this.broadcastStatus(); return; }
    if (m.MessageType === "SubscriptionConfirmation") { this.upDiag = "subscribed · " + this.currentBoxes().length + " areas" + (m.Message && m.Message.CompressionEnabled ? " · compressed" : ""); this.broadcastStatus(); return; }
    if (!m.MetaData || m.MetaData.MMSI == null) return;
    const now = Date.now();
    this.stats.msgs++; this.stats.lastMsg = now;
    const mmsi = String(m.MetaData.MMSI);
    const rec = this.snapshot.get(mmsi) || { pos: null, stat: null, t: 0 };
    const mt = m.MessageType;
    let forward = true;
    if (mt === "PositionReport" || mt === "StandardClassBPositionReport" || mt === "ExtendedClassBPositionReport") {
      rec.pos = text; rec.t = now;
      const last = this.lastFwd.get(mmsi) || 0;
      if (now - last < MIN_FORWARD_GAP) forward = false; else this.lastFwd.set(mmsi, now);
    } else {
      rec.stat = text; if (!rec.t) rec.t = now;
    }
    this.snapshot.set(mmsi, rec);
    if (!forward) return;
    this.stats.fwd++;
    for (const ws of this.clients()) { try { ws.send(text); } catch (e) { /* client gone */ } }
  }

  sendSnapshot(ws) {
    const now = Date.now();
    const out = [];
    for (const [mmsi, rec] of this.snapshot) {
      if (now - rec.t > SNAPSHOT_TTL) { this.snapshot.delete(mmsi); this.lastFwd.delete(mmsi); continue; }
      if (rec.pos) out.push(rec.pos);
      if (rec.stat) out.push(rec.stat);
    }
    // chunked so no single frame is huge; each chunk is a JSON array of raw AISStream messages
    for (let i = 0; i < out.length; i += 400) {
      try { ws.send("[" + out.slice(i, i + 400).join(",") + "]"); } catch (e) { return; }
    }
  }

  statusMessage() {
    return JSON.stringify({ MessageType: "RelayStatus", upstream: this.upState, diag: this.upDiag, clients: this.clients().length, vessels: this.snapshot.size, connectedAt: this.stats.connectedAt, t: Date.now() });
  }
  sendStatus(ws) { try { ws.send(this.statusMessage()); } catch (e) { /* ignore */ } }
  broadcastStatus() { const s = this.statusMessage(); for (const ws of this.clients()) { try { ws.send(s); } catch (e) { /* ignore */ } } }

  /* ---- housekeeping every minute while anyone is connected ---- */
  async alarm() {
    const now = Date.now();
    for (const [mmsi, rec] of this.snapshot) if (now - rec.t > SNAPSHOT_TTL) { this.snapshot.delete(mmsi); this.lastFwd.delete(mmsi); }
    const n = this.clients().length;
    if (n) this.lastClientSeen = now;
    if (!n && this.up && now - this.lastClientSeen > IDLE_CLOSE) {
      const ws = this.up; this.up = null; this.upState = "idle"; this.upDiag = "idle · no viewers";
      try { ws.close(1000, "idle"); } catch (e) { /* ignore */ }
    }
    if (n) {
      if (this.upState === "open" && this.stats.lastMsg && now - this.stats.lastMsg > 120 * 1000) {
        // silent upstream: recycle it
        const ws = this.up; this.up = null; try { ws.close(1000, "stale"); } catch (e) { /* ignore */ }
        this.upstreamFailed("no data for 2 min · reconnecting");
      } else this.ensureUpstream();
      this.subscribe();
      this.broadcastStatus();
    }
    if (n || this.up) await this.ctx.storage.setAlarm(now + 60 * 1000);
  }
}

function validBox(b) {
  return Array.isArray(b) && b.length === 2 && Array.isArray(b[0]) && Array.isArray(b[1]) && b[0].length === 2 && b[1].length === 2 && b.flat().every(v => Number.isFinite(+v));
}
