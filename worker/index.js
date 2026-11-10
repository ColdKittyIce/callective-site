/**
 * The Callective site worker.
 * Serves the static site from ./public and answers /api routes:
 *
 *   The Hall (host your own Callective; rooms are Hall durable objects, worker/hall.js)
 *   POST /api/hall              {title} open a room: returns {code, hostKey}
 *   GET  /api/hall/:code        room info; /api/hall/:code/ws is the room's WebSocket (chat + queue bot)
 *
 *   Shows
 *   GET  /api/ping              health check (no Prankcast call)
 *   GET  /api/status            is TheCallective live on Prankcast, plus the live stream address
 *   GET  /api/radio             what Callective Radio (the 24/7 player) is playing right now (the newest 10 shows)
 *   GET  /api/guestbook         the 1998 page's guestbook (POST signs it; flagged entries wait for the crew)
 *   GET  /api/suggest           community title ideas for calls, with vote counts
 *   POST /api/suggest           {ep, t, title} suggest a title (filtered, 12 actions an hour per person)
 *   POST /api/suggest/vote      {ep, t, id}    +1 an idea (one vote per person per call)
 *   POST /api/suggest/report    {ep, t, id}    3 reports hide it
 *   POST /api/mod/suggest       {ep, t, id}    crew hides one                    (ADMIN_TOKEN)
 *   GET  /api/autocalls         call lists for shows newer than calls.json, built by the cron from the Discord queue bot (worker/autocalls.js)
 *   GET  /api/calls             crew fixes to the call lists (titles, callers, blurbs)
 *   GET  /api/fixes             community fixes to who made a call / when it starts, with votes
 *   POST /api/fix               {ep, t, k:"by"|"at", val} suggest one (t = the call's original start, the key)
 *   POST /api/fix/up|down       {ep, t, id}    3 ups (not the suggester) make it permanent; 2 downs send it to the crew
 *   POST /api/mod/fix/approve|reject {ep, t, id}                        (ADMIN_TOKEN)
 *   POST /api/mod/calls         save one fix {ep, t, title, by} or {ep, desc}  (ADMIN_TOKEN)
 *   GET  /api/mod/guestbook     guestbook entries, posted and held        (ADMIN_TOKEN)
 *   POST /api/mod/gb/:id/approve|delete                                   (ADMIN_TOKEN)
 *   GET  /api/hits              the 1998 page's visitor counter (POST adds one)
 *   GET  /api/shows             which shows the site has its own copy of (R2)
 *   GET  /api/show/:id.mp3      a show's audio from the site's own copy (supports seeking)
 *   GET  /api/latest            newest episode posts (merged into the archive)
 *   GET  /api/episode/:id       audio URL and chat id for one Prankcast post
 *   GET  /api/chat/:cid         Prankcast chat replay for a broadcast, trimmed
 *   GET  /api/hls?u=            relays the live stream, only used if the browser can't read it directly
 *   GET  /api/cut/:id?from&to   a slice of a show as an MP3 (up to 20 min; &dl=1&name= to download; supports Range)
 *
 *
 *   Clips
 *   GET  /c/:id                 a clip's share page: a little player, plus tags so Discord shows a playable video
 *   GET  /c/:id.mp4             the clip as an MP4 (the clip card picture + the clip's MP3 audio, not re-encoded)
 *   GET  /api/clips             approved community clips
 *   GET  /api/clips/:id.mp3     an approved clip's audio (?dl=1 downloads it)
 *   POST /api/clips             send a clip: dest "board" or "crew" (private). Show slices with clean names post
 *                               straight to the board; anything flagged, and any uploaded audio, waits for the crew.
 *                               JSON {ep, from, to, ...} = a slice of a show (no upload, no storage, up to 20 min);
 *                               a form with an MP3 = an edited clip (up to 2 min, stored in R2)
 *   GET  /api/mod/pending       clips waiting / sent to the crew          (ADMIN_TOKEN)
 *   GET  /api/mod/clip/:id.mp3  hear a waiting clip                       (ADMIN_TOKEN)
 *   POST /api/mod/:id/approve   put it on the board                       (ADMIN_TOKEN)
 *   POST /api/mod/:id/reject    remove it                                 (ADMIN_TOKEN)
 *   GET  /api/mod/public        everything on the board                   (ADMIN_TOKEN)
 *   POST /api/mod/:id/remove    take a clip off the board                 (ADMIN_TOKEN)
 *   POST /api/clips/:id/report  a listener reports a clip (3 reports sends it back to the crew)
 *
 * Storage: KV namespace DB (clip records, rate limits), R2 bucket CLIPS (clip audio).
 * Nothing here writes to Prankcast or Discord, except the optional DISCORD_WEBHOOK heads-up for new clips.
 * (Discord is only read: the call lists for new shows, with the DISCORD_BOT_TOKEN secret.)
 */
import { mp4Head } from "./mp4.js";
import { screen } from "./screen.js";
import { autoCallsStep, autoCallsGet } from "./autocalls.js";
export { Hall } from "./hall.js";
const PROFILE = "thecallective";
const PC = "https://prankcast.com";
const UA = { "user-agent": "CallectiveSite/2.0 (+thecallective site worker)" };
// One limit everywhere: 10 minutes. Uploads come in as 64 kbps mono (≈4.8 MB for 10 min); 1,000 stored clips tops out near 5 GB, inside R2's free 10 GB.
const MAX_CLIP_BYTES = 5_200_000, MAX_CLIP_SEC = 602, MAX_REF_SEC = 600, UPLOADS_PER_HOUR = 6, UPLOADS_PER_DAY = 200, MAX_STORED_CLIPS = 1000;
const RADIO_EPOCH = Date.UTC(2026, 0, 1);
const RADIO_SHOWS = 10; // Callective Radio plays the newest 10 shows, from the site's own copies in R2

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/c/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });
    try { return await route(request, env, ctx, url); }
    catch (e) { return json({ error: "Upstream error", detail: String(e && e.message || e) }, 502); }
  },
  // Every 15 minutes: copy at most one new show into R2 and drop copies that fell out of the newest 10.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(mirrorStep(env).catch(e => console.log("mirror:", e && e.message)));
    ctx.waitUntil(mixSync(env, false).catch(e => console.log("mix:", e && e.message))); // the Suno playlist, about once an hour
    ctx.waitUntil(autoCallsStep(env, autoCtx(env)).catch(e => console.log("autocalls:", e && e.message))); // call lists for new shows, from Discord (read-only)
  }
};

async function route(request, env, ctx, url) {
      const p = url.pathname.replace(/\/+$/, ""), M = request.method;
      let m;
      if (p === "/api/ping") return json({ ok: true });
      if ((m = p.match(/^\/c\/([a-z0-9-]+)\.mp4$/))) return clipVideo(env, ctx, m[1], request);
      if ((m = p.match(/^\/c\/([a-z0-9-]+)$/))) return clipPage(env, ctx, m[1], url);
      if (p === "/api/status") return json(await getStatus(ctx), 200, 60);
      if (p === "/api/radio") return cached(request, ctx, 15, () => radio(env, url, ctx));
      if (p === "/api/latest") return json(await memo(ctx, "latest", 1800, latest), 200, 1800);
      if ((m = p.match(/^\/api\/episode\/(\d+)$/))) {
        const ep = { ...(await memo(ctx, "ep2" + m[1], 604800, () => episode(m[1]))) };
        if ((await mirrored(env, ctx)).some(x => x.id === +m[1])) ep.mp3 = `/api/show/${m[1]}.mp3`;
        return json(ep, 200, 300);
      }
      if ((m = p.match(/^\/api\/show\/(\d+)\.mp3$/))) return showAudio(env, m[1], request);
      if (p === "/api/shows") return json({ radio: RADIO_SHOWS, copies: await mirrored(env, ctx, true) }, 200, 60);
      if ((m = p.match(/^\/api\/chat\/(\d+)$/))) return cached(request, ctx, 604800, () => chat(m[1]));
      if (p === "/api/hls") return env.HLS_RELAY === "on" ? hls(url, ctx) : json({ error: "Relay is off" }, 404);
      if ((m = p.match(/^\/api\/cut\/(\d+)$/))) return cut(env, m[1], url, ctx, request);
      if ((m = p.match(/^\/api\/g98\/([a-z0-9]+)\.gif$/))) return gif98(env, m[1]);
      if ((m = p.match(/^\/api\/media\/([a-z0-9-]+)\.mp3$/))) return mediaAudio(env, m[1], request);
      if (p === "/api/mix") return json(await mixGet(env, ctx), 200, 300);
      if ((m = p.match(/^\/api\/mix\/([0-9a-f-]{36})\.mp3$/))) return mixAudio(env, m[1], request, url);
      if (p === "/api/hall" && M === "POST") return hallNew(request, env);
      if (p === "/api/hall-ice") return hallIce(env, ctx);
      if ((m = p.match(/^\/api\/hall\/([A-Za-z]{2,6}-\d{4})(\/ws)?$/))) return hallGo(request, env, m[1].toUpperCase(), !!m[2]);
      if (p === "/api/hits") return hits(env, M === "POST");
      if (p === "/api/suggest" && M === "GET") return cached(request, ctx, 30, () => sgAll(env));
      if ((m = p.match(/^\/api\/suggest(?:\/(vote|report))?$/)) && M === "POST") return sgPost(request, env, m[1] || "add");
      if (p === "/api/fixes" && M === "GET") return cached(request, ctx, 30, () => cfAll(env));
      if ((m = p.match(/^\/api\/fix(?:\/(up|down))?$/)) && M === "POST") return cfPost(request, env, m[1] || "add");
      if (p === "/api/autocalls" && M === "GET") return json(await autoCallsGet(env), 200, 300);
      if (p === "/api/calls" && M === "GET") return json(env.DB ? JSON.parse(await env.DB.get("callfix") || "{}") : {}, 200, 30);
      if (p === "/api/guestbook" && M === "GET") return cached(request, ctx, 20, () => gbList(env, "g:"));
      if (p === "/api/guestbook" && M === "POST") return gbPost(request, env);
      if (p === "/api/clips" && M === "GET") return clipsList(env);
      if (p === "/api/clips" && M === "POST") return clipsPost(request, env, ctx);
      if ((m = p.match(/^\/api\/clips\/([a-z0-9-]+)\/report$/)) && M === "POST") return report(env, m[1], request);
      if ((m = p.match(/^\/api\/clips\/([a-z0-9-]+)\.mp3$/)) && M === "GET") return clipAudio(env, ctx, m[1], "a:", url, request);
      if (p.startsWith("/api/mod/")) {
        if (!env.ADMIN_TOKEN || (request.headers.get("authorization") || "") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Wrong crew password" }, 401);
        if (p === "/api/mod/pending") return clipsList(env, "p:");
        if (p === "/api/mod/public") return clipsList(env, "a:", true);
        if (p === "/api/mod/calls" && M === "POST") return callFix(request, env);
        if ((m = p.match(/^\/api\/mod\/fix\/(approve|reject)$/)) && M === "POST") return cfPost(request, env, m[1], true);
        if (p === "/api/mod/suggest" && M === "POST") return sgPost(request, env, "remove", true);
        if (p === "/api/mod/guestbook") return json({ pub: (await gbList(env, "g:")).entries, held: (await gbList(env, "h:")).entries });
        if ((m = p.match(/^\/api\/mod\/gb\/([a-z0-9-]+)\/(approve|delete)$/)) && M === "POST") return gbAct(env, m[1], m[2]);
        if ((m = p.match(/^\/api\/mod\/clip\/([a-z0-9-]+)\.mp3$/))) return clipAudio(env, ctx, m[1], "p:", url, request);
        if ((m = p.match(/^\/api\/mod\/([a-z0-9-]+)\/(approve|reject|remove)$/)) && M === "POST") return modAct(env, m[1], m[2]);
      }
      return json({ error: "Not found" }, 404);
}

/* ---------- helpers ---------- */
function cors() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" }; }
function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store", ...cors() } });
}
async function cached(request, ctx, ttl, make) {
  const cache = caches.default, key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key); if (hit) return hit;
  const res = json(await make(), 200, ttl);
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
// Same idea for values the worker uses itself (so many routes can share one Prankcast lookup).
async function memo(ctx, name, ttl, make) {
  const cache = caches.default, key = new Request(`https://memo.callective.internal/${name}`);
  const hit = await cache.match(key); if (hit) return hit.json();
  const v = await make();
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(v), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` } })));
  return v;
}
async function nextData(path) {
  const r = await fetch(PC + path, { headers: UA, cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error(`Prankcast ${r.status}`);
  const m = (await r.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("No page data");
  return JSON.parse(m[1]).props.pageProps;
}
const parse = x => typeof x === "string" ? JSON.parse(x) : x;
const first = x => Array.isArray(x) ? x[0] : x;
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

const HOSTS = { drtomservo: "Dr. Tom Servo", iregretjumping: "iregretjumping", iragarrettjumping: "iregretjumping", rbcp: "RBCP", criefaux: "CrieFaux", andyanderson: "Andy Anderson",
  milkbox: "milkbox", despicabledogs: "DespicableDogs", drakedragsaw: "Moxie", moxie: "Moxie", moxietxt: "Moxie", icecat: "IceCat", wildone: "wild-one", ronmexico: "RonMexico", nerdstrong: "Nerdstrong", devonanustart: "DevonAnustart" };
const renameT = t => t.replace(/drake ?dragsaw/gi, "Moxie"); // Drake Dragsaw goes by Moxie now (Oct 31 2026)
function hostOf(title) { const m = String(title).match(/hosted by @?([A-Za-z .\-]+?)(?: -|\)|$|\s\d| \()/i); if (!m) return null; return HOSTS[m[1].replace(/[ .\-]/g, "").toLowerCase()] || m[1].trim(); }
function dateOf(title, start) {
  const m = String(title).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; }
  if (start) { const d = new Date(start.replace(" ", "T") + "Z"); d.setUTCHours(d.getUTCHours() - 5); return d.toISOString().slice(0, 10); }
  return null;
}
function secs(b) { if (!b || !b.start_date || !b.end_date) return 0; return Math.max(0, (Date.parse(b.end_date.replace(" ", "T") + "Z") - Date.parse(b.start_date.replace(" ", "T") + "Z")) / 1000); }
function toEpisode(po) { let b = null; try { b = first(parse(po.broadcast_contents_json)); } catch (e) {}
  return { id: po.post_id, t: renameT((po.post_title || "").trim()), d: dateOf(po.post_title, b && b.start_date), h: hostOf(po.post_title), sec: Math.round(secs(b)), n: (po.post_description || "").slice(0, 200), chat: 0 }; }

/* ---------- Prankcast routes ---------- */
// Prankcast's own player plays `${stream_url_active}pl-0.m3u8` (HLS) while a show is live.
async function status() {
  const prof = first(parse((await nextData(`/${PROFILE}`)).ssr_data_profile)) || {};
  const live = Number(prof.stream_status) > 0;
  const base = prof.stream_url_active || prof.stream_url || null;
  let hlsUrl = null;
  if (live && base) hlsUrl = /\.m3u8(\?|$)/.test(base) ? base : base + "pl-0.m3u8";
  return { live, hls: hlsUrl, video: String(prof.stream_bol_video) === "1", bid: prof.broadcast_id || null,
    lastStart: prof.stream_start_date || null, lastEnd: prof.stream_end_date || null, checked: new Date().toISOString() };
}
// Checked at most once a minute per Cloudflare location, however many people have the site open.
const getStatus = ctx => memo(ctx, "status", 60, status);
async function latest() {
  const posts = parse((await nextData(`/${PROFILE}`)).ssr_data_posts) || [];
  return { posts: (Array.isArray(posts) ? posts : [posts]).filter(p => p && p.post_type === 5).map(toEpisode).filter(e => e.sec > 600) };
}
async function episode(id) {
  const po = first(parse((await nextData(`/${PROFILE}/posts/${id}`)).ssr_data_posts));
  if (!po) throw new Error("Post not found");
  let mp3 = null; try { mp3 = first(parse(po.post_contents_json)).url || null; } catch (e) {}
  let b = null; try { b = first(parse(po.broadcast_contents_json)); } catch (e) {}
  return { id: po.post_id, cid: po.content_id || null, mp3, title: po.post_title, sec: Math.round(secs(b)) || null, st: (b && b.start_date) || null };
}
function chatRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(x => x.user_name && x.message && !/has entered chat/.test(x.message) && x.message.trim() !== "📞" && !x.bol_private)
    .map(x => [Math.round(x.broadcast_duration || 0), x.user_name, String(x.message)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, t) => "[gif" + (t ? ": " + t.slice(0, 60) : "") + "]")
      .replace(/https?:\/\/\S+/g, "[link]")
      // never show a phone number or email from chat (call recipients' numbers get posted sometimes)
      .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[number removed]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]")
      .replace(/\s+/g, " ").trim().slice(0, 300)])
    .filter(m => m[2]);
}
async function chat(cid) {
  const r = await fetch(`${PC}/api/private/chat/select?id=${PROFILE}&filter=broadcast&bid=${cid}&cache=x`, { headers: UA });
  if (!r.ok) throw new Error(`Chat ${r.status}`);
  return { cid: +cid, messages: chatRows(await r.json()) };
}
/* Relay for the live stream. Only the current live stream's host is allowed, so this can't be used as an open proxy. */
async function hls(url, ctx) {
  const st = await getStatus(ctx);
  const u = url.searchParams.get("u") || st.hls;
  if (!st.live || !st.hls || !u) return json({ error: "Not live" }, 404);
  let target; try { target = new URL(u, st.hls); } catch (e) { return json({ error: "Bad address" }, 400); }
  if (target.host !== new URL(st.hls).host || !/^https?:$/.test(target.protocol)) return json({ error: "Not allowed" }, 403);
  const r = await fetch(target.toString(), { headers: UA, cf: { cacheTtl: /\.m3u8/.test(target.pathname) ? 1 : 60 } });
  const type = r.headers.get("content-type") || "";
  if (/\.m3u8/.test(target.pathname) || /mpegurl/i.test(type)) {
    const via = x => `/api/hls?u=${encodeURIComponent(new URL(x, target).toString())}`;
    const text = (await r.text()).split("\n").map(line => {
      const l = line.trim(); if (!l) return line;
      if (l.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, x) => `URI="${via(x)}"`);
      return via(l);
    }).join("\n");
    return new Response(text, { status: r.status, headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store", ...cors() } });
  }
  return new Response(r.body, { status: r.status, headers: { "content-type": type || "application/octet-stream", "cache-control": "public, max-age=60", ...cors() } });
}

/* ---------- Callective Radio: one shared, shuffled loop of every episode ---------- */
// Everyone hears the same thing: the position is worked out from the clock, not from when you pressed play.
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function radioOrder(list, cycle) {
  const a = list.slice().sort((x, y) => x.id - y.id), r = rng(cycle * 7919 + a.length);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function radioAt(list, t) {
  const total = list.reduce((s, e) => s + e.sec, 0), el = (t - RADIO_EPOCH) / 1000;
  const cycle = Math.floor(el / total); let pos = el - cycle * total;
  for (const e of radioOrder(list, cycle)) { if (pos < e.sec) return { ep: e, offset: pos }; pos -= e.sec; }
  return null;
}
async function allEpisodes(env, ctx) {
  const base = await (await env.ASSETS.fetch(new Request("https://assets.local/data/episodes.json"))).json();
  let extra = []; try { extra = (await memo(ctx, "latest", 1800, latest)).posts || []; } catch (e) {}
  const have = new Set(base.map(e => e.id));
  return base.concat(extra.filter(e => !have.has(e.id))).filter(e => e.sec > 600);
}
// What the automatic call lists need from the rest of the worker.
const autoCtx = env => ({
  episodes: () => allEpisodes(env, { waitUntil() {} }),
  info: id => episode(id),
  staticIds: async () => new Set(Object.keys(await (await env.ASSETS.fetch(new Request("https://assets.local/data/calls.json"))).json()))
});
const newest = list => list.slice().sort((a, b) => b.id - a.id).slice(0, RADIO_SHOWS);
async function radio(env, url, ctx) {
  const list = newest(await allEpisodes(env, ctx));
  const now = Date.now(), cur = radioAt(list, now);
  const next = []; let t = now + (cur.ep.sec - cur.offset) * 1000 + 500;
  for (let i = 0; i < 4; i++) { const n = radioAt(list, t); next.push({ ...slim(n.ep), at: t - 500 }); t += n.ep.sec * 1000; }
  return { now, ep: slim(cur.ep), offset: +cur.offset.toFixed(2), endsAt: now + Math.round((cur.ep.sec - cur.offset) * 1000), next, count: list.length };
}
const slim = e => ({ id: e.id, t: e.t, d: e.d, h: e.h, sec: e.sec, chat: e.chat || 0 });

/* ---------- the site's own copies of the newest shows (R2: shows/<id>.mp3) ---------- */
// Only ever reads from Prankcast and writes to this site's own bucket. Nothing on Prankcast is changed or deleted.
async function listCopies(env) {
  if (!env.CLIPS) return [];
  const out = []; let cursor;
  do { const pg = await env.CLIPS.list({ prefix: "shows/", cursor, include: ["customMetadata"] });
    for (const o of pg.objects) { const id = +o.key.slice(6).replace(/\.mp3$/, ""); if (id) out.push({ id, size: o.size, uploaded: o.uploaded, sec: +(o.customMetadata?.sec || 0) }); }
    cursor = pg.truncated ? pg.cursor : null; } while (cursor);
  return out;
}
const mirrored = (env, ctx, fresh) => fresh ? listCopies(env) : memo(ctx, "copies", 300, () => listCopies(env));
async function mirrorStep(env) {
  if (!env.CLIPS) return;
  const fakeCtx = { waitUntil() {} };
  const want = newest(await allEpisodes(env, fakeCtx)), wantIds = new Set(want.map(e => e.id)), have = await listCopies(env);
  for (const c of have) if (!wantIds.has(c.id)) await env.CLIPS.delete(`shows/${c.id}.mp3`); // our own copy only
  const haveIds = new Set(have.map(c => c.id));
  for (const e of want) {
    if (haveIds.has(e.id)) continue;
    const info = await episode(e.id); if (!info.mp3) continue;
    const r = await fetch(info.mp3, { headers: UA });
    if (!r.ok || !r.body) throw new Error(`copy ${e.id}: ${r.status}`);
    await env.CLIPS.put(`shows/${e.id}.mp3`, r.body, { httpMetadata: { contentType: "audio/mpeg" }, customMetadata: { sec: String(e.sec || 0), d: e.d || "", h: e.h || "" } });
    return; // one show per run keeps each run short
  }
}
async function showAudio(env, id, request) {
  if (!env.CLIPS) return json({ error: "Storage not set up" }, 500);
  const obj = await env.CLIPS.get(`shows/${id}.mp3`, { range: request.headers });
  if (!obj) return json({ error: "Not found" }, 404);
  const h = new Headers({ "content-type": "audio/mpeg", "accept-ranges": "bytes", "cache-control": "public, max-age=86400", etag: obj.httpEtag, ...cors() });
  if (obj.range && request.headers.get("range")) {
    const off = obj.range.offset ?? (obj.size - obj.range.suffix), len = obj.range.length ?? (obj.size - off);
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`); h.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(obj.body, { headers: h });
}

/* ---------- big audio files (over the 25 MB static limit) ----------
   They live in the repo's media/ folder (not deployed as static files). The first request copies the file
   from GitHub into R2 (media/<name>-<version>.mp3); after that it streams from R2 with Range support. */
const MEDIA = { "phone-book-megamix-full": "1" };
async function mediaAudio(env, name, request) {
  if (!MEDIA[name]) return json({ error: "Not found" }, 404);
  if (!env.CLIPS) return json({ error: "Storage not set up" }, 500);
  const key = `media/${name}-${MEDIA[name]}.mp3`;
  if (!(await env.CLIPS.head(key))) {
    const r = await fetch(`https://raw.githubusercontent.com/ColdKittyIce/callective-site/main/media/${name}.mp3`);
    const len = +r.headers.get("content-length");
    if (!r.ok || !len) return json({ error: "Couldn't fetch the file" }, 502);
    const fl = new FixedLengthStream(len); r.body.pipeTo(fl.writable);
    await env.CLIPS.put(key, fl.readable, { httpMetadata: { contentType: "audio/mpeg" } });
  }
  const obj = await env.CLIPS.get(key, { range: request.headers });
  if (!obj) return json({ error: "Not found" }, 404);
  const h = new Headers({ "content-type": "audio/mpeg", "accept-ranges": "bytes", "cache-control": "public, max-age=604800", etag: obj.httpEtag, ...cors() });
  if (obj.range && request.headers.get("range")) {
    const off = obj.range.offset ?? (obj.size - obj.range.suffix), len = obj.range.length ?? (obj.size - off);
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`); h.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("content-length", String(obj.size));
  return new Response(obj.body, { headers: h });
}

/* ---------- cutting a piece of an episode ---------- */
const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
async function readPiece(env, id, mp3, a, z) {
  if (env.CLIPS) { const o = await env.CLIPS.get(`shows/${id}.mp3`, { range: { offset: a, length: z - a + 1 } }); if (o) return o.body; }
  const r = await fetch(mp3, { headers: { range: `bytes=${a}-${z}` } });
  // A 200 here would be the whole multi-hour show, so never pass it through.
  if (r.status !== 206) { try { await r.body?.cancel(); } catch (e) {} throw new Error(`Audio storage answered ${r.status} instead of a piece`); }
  return r.body;
}
async function mp3Layout(env, id, mp3) {
  const b = new Uint8Array(await new Response(await readPiece(env, id, mp3, 0, 65535)).arrayBuffer()); let off = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) off = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
  let kbps = 128;
  for (let i = off; i < b.length - 4; i++) {
    if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) { const ver = (b[i + 1] >> 3) & 3, idx = b[i + 2] >> 4; const tbl = ver === 3 ? BITRATES[1] : BITRATES[2]; if (idx > 0 && idx < 15) { kbps = tbl[idx]; off = i; break; } }
  }
  return { start: off, bytesPerSec: kbps * 1000 / 8 };
}
// A slice of a show as its own MP3: just the bytes for that stretch, read from the site's copy (or Prankcast as a fallback).
// Supports Range so long slices (whole calls) can be seeked. ?dl=1&name= makes it a download.
const fileName = t => "callective-" + String(t || "clip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + ".mp3";
async function slice(env, ctx, request, id, from, to, extra = {}) {
  const ep = await memo(ctx, "ep2" + id, 604800, () => episode(id)); if (!ep.mp3) return json({ error: "No audio for that show" }, 404);
  const lay = await memo(ctx, "lay" + id, 2592000, () => mp3Layout(env, id, ep.mp3));
  const a = Math.floor(lay.start + from * lay.bytesPerSec), z = Math.floor(lay.start + to * lay.bytesPerSec), size = z - a + 1;
  let s0 = 0, s1 = size - 1, status = 200;
  const rg = (request.headers.get("range") || "").match(/bytes=(\d*)-(\d*)/);
  if (rg && (rg[1] || rg[2])) { if (rg[1]) { s0 = +rg[1]; s1 = rg[2] ? Math.min(+rg[2], size - 1) : size - 1; } else { s0 = Math.max(0, size - +rg[2]); } if (s0 > s1) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } }); status = 206; }
  let body; try { body = await readPiece(env, id, ep.mp3, a + s0, a + s1); } catch (e) { return json({ error: "Couldn't read that part of the show" }, 502); }
  const h = { "content-type": "audio/mpeg", "accept-ranges": "bytes", "content-length": String(s1 - s0 + 1), "cache-control": "public, max-age=86400", ...cors(), ...extra };
  if (status === 206) h["content-range"] = `bytes ${s0}-${s1}/${size}`;
  return new Response(body, { status, headers: h });
}
async function cut(env, id, url, ctx, request) {
  const from = Math.max(0, +url.searchParams.get("from") || 0), to = +url.searchParams.get("to") || 0;
  if (!(to > from) || to - from > MAX_REF_SEC + 10) return json({ error: "Pick a piece between 1 second and 10 minutes long" }, 400);
  const extra = url.searchParams.get("dl") ? { "content-disposition": `attachment; filename="${fileName(url.searchParams.get("name"))}"` } : {};
  return slice(env, ctx, request, id, from, to, extra);
}

/* ---------- crew fixes to call lists (titles, who called, show blurbs). One small KV document. ---------- */
async function callFix(request, env) {
  if (!env.DB) return json({ error: "Storage isn't set up" }, 500);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const ep = String(+b.ep || ""); if (!ep || ep === "0") return json({ error: "Which show?" }, 400);
  const all = JSON.parse(await env.DB.get("callfix") || "{}"), show = all[ep] || (all[ep] = { c: {} });
  if (b.desc != null) show.desc = clean(b.desc, 400);
  if (b.t != null) { const k = String(Math.round(+b.t)), c = show.c[k] || (show.c[k] = {});
    if (b.title != null) c.title = clean(b.title, 120); if (b.by != null) c.by = clean(b.by, 60); }
  await env.DB.put("callfix", JSON.stringify(all));
  return json({ ok: true, fix: show });
}

/* ---------- community title suggestions ----------
   Anyone can suggest a title for a call that doesn't have one. It shows up right away if it passes the filter.
   Others can +1 it or suggest a better one; the most votes wins. 3 reports from different people hide one.
   A crew title (✎) always wins. One small KV document per show ("sg:<show id>"); voters are stored as short hashes, never IPs. */
const SG_PER_CALL = 6, SG_ACTIONS_PER_HOUR = 12;
async function sgAll(env) {
  if (!env.DB) return {}; const out = {}; let cursor;
  do { const pg = await env.DB.list({ prefix: "sg:", cursor }); for (const k of pg.keys) { const doc = JSON.parse(await env.DB.get(k.name) || "{}"), show = {};
      for (const [t, L] of Object.entries(doc)) { const vis = L.filter(x => !x.hide).map(x => ({ id: x.id, title: x.title, v: x.v.length })); if (vis.length) show[t] = vis; }
      if (Object.keys(show).length) out[k.name.slice(3)] = show; }
    cursor = pg.list_complete ? null : pg.cursor; } while (cursor);
  return out;
}
async function who(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + (env.ADMIN_TOKEN || "cx")));
  return [...new Uint8Array(h)].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sgPost(request, env, action, crew) {
  if (!env.DB) return json({ error: "Storage isn't set up" }, 500);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const ep = String(+b.ep || ""), t = String(Math.round(+b.t)); if (!ep || ep === "0" || !(+t >= 0)) return json({ error: "Which call?" }, 400);
  const me = await who(request, env);
  if (!crew) { const rl = `sgr:${me}:${new Date().toISOString().slice(0, 13)}`, used = +(await env.DB.get(rl) || 0);
    if (used >= SG_ACTIONS_PER_HOUR) return json({ error: "Easy there. Try again in an hour" }, 429);
    await env.DB.put(rl, String(used + 1), { expirationTtl: 3700 }); }
  const key = "sg:" + ep, doc = JSON.parse(await env.DB.get(key) || "{}"), L = doc[t] || (doc[t] = []);
  if (action === "add") {
    const title = clean(b.title, 80); if (title.length < 3) return json({ error: "A few more words, please" }, 400);
    if (screen(title)) return json({ error: "That one tripped the filter (no links, numbers or slurs)" }, 400);
    const n = title.toLowerCase().replace(/[^a-z0-9]+/g, ""), same = L.find(x => x.title.toLowerCase().replace(/[^a-z0-9]+/g, "") === n);
    for (const x of L) x.v = x.v.filter(v => v !== me); // one vote per person per call
    if (same) { same.v.push(me); }
    else { if (L.filter(x => !x.hide).length >= SG_PER_CALL) return json({ error: "This call has plenty of ideas already. Vote for one instead" }, 409);
      L.push({ id: crypto.randomUUID().slice(0, 8), title, v: [me], r: [], ts: Date.now() }); }
  } else {
    const x = L.find(y => y.id === b.id); if (!x) return json({ error: "Not found" }, 404);
    if (action === "vote") { for (const y of L) y.v = y.v.filter(v => v !== me); x.v.push(me); }
    if (action === "report") { if (!x.r.includes(me)) x.r.push(me); if (x.r.length >= 3) x.hide = true; }
    if (action === "remove") x.hide = true;
  }
  await env.DB.put(key, JSON.stringify(doc));
  return json({ ok: true, call: L.filter(x => !x.hide).map(x => ({ id: x.id, title: x.title, v: x.v.length, mine: x.v.includes(me) })) });
}

/* ---------- community fixes: who made a call and when it starts (audit I2, Nov 2026) ----------
   Anyone can suggest a fix. 3 upvotes from other people make it permanent: it's written into "callfix", same as a crew fix.
   2 downvotes stop it and send it to the crew to approve or reject. One vote per person per fix; the suggester's vote is
   counted as theirs, not as one of the 3. One KV document per show ("cf:<show id>"), keyed by the call's original start. */
const CF_UP = 3, CF_DOWN = 2, CF_OPEN_PER_CALL = 4, CF_MAX_SEC = 6 * 3600;
const cfOut = (x, me) => ({ id: x.id, k: x.k, val: x.val, up: x.up.length, dn: x.dn.length, st: x.st, ...(me ? { mine: x.by === me ? "own" : x.up.includes(me) ? "up" : x.dn.includes(me) ? "down" : "" } : {}) });
async function cfAll(env) {
  if (!env.DB) return {}; const out = {}; let cursor;
  do { const pg = await env.DB.list({ prefix: "cf:", cursor }); for (const k of pg.keys) { const doc = JSON.parse(await env.DB.get(k.name) || "{}"), show = {};
      for (const [t, L] of Object.entries(doc)) { const vis = L.filter(x => x.st === "open" || x.st === "flag").map(x => cfOut(x)); if (vis.length) show[t] = vis; }
      if (Object.keys(show).length) out[k.name.slice(3)] = show; }
    cursor = pg.list_complete ? null : pg.cursor; } while (cursor);
  return out;
}
async function cfApply(env, ep, t, x) {
  const all = JSON.parse(await env.DB.get("callfix") || "{}"), show = all[ep] || (all[ep] = { c: {} }), c = show.c[t] || (show.c[t] = {});
  if (x.k === "by") c.by = x.val; else c.at = +x.val;
  await env.DB.put("callfix", JSON.stringify(all));
}
async function cfPost(request, env, action, crew) {
  if (!env.DB) return json({ error: "Storage isn't set up" }, 500);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const ep = String(+b.ep || ""), t = String(Math.round(+b.t)); if (!ep || ep === "0" || !(+t >= 0)) return json({ error: "Which call?" }, 400);
  const me = await who(request, env);
  if (!crew) { const rl = `sgr:${me}:${new Date().toISOString().slice(0, 13)}`, used = +(await env.DB.get(rl) || 0);
    if (used >= SG_ACTIONS_PER_HOUR) return json({ error: "Easy there. Try again in an hour" }, 429);
    await env.DB.put(rl, String(used + 1), { expirationTtl: 3700 }); }
  const key = "cf:" + ep, doc = JSON.parse(await env.DB.get(key) || "{}"), L = doc[t] || (doc[t] = []);
  const live = () => L.filter(x => x.st === "open" || x.st === "flag");
  let x, applied = false;
  const up = y => { y.dn = y.dn.filter(v => v !== me); if (y.by !== me && !y.up.includes(me)) y.up.push(me); };
  if (action === "add") {
    const k = b.k === "at" ? "at" : b.k === "by" ? "by" : null; if (!k) return json({ error: "Fix who called, or when it starts" }, 400);
    let val;
    if (k === "by") { val = clean(b.val, 40); if (val.length < 2) return json({ error: "Type the caller's name" }, 400);
      if (screen(val)) return json({ error: "That name tripped the filter (no links, numbers or slurs)" }, 400); }
    else { val = Math.round(+b.val); if (!(val >= 0 && val <= CF_MAX_SEC)) return json({ error: "That time doesn't fit this show" }, 400); }
    const norm = v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
    x = live().find(y => y.k === k && norm(y.val) === norm(val));
    if (x) up(x);
    else { if (live().length >= CF_OPEN_PER_CALL) return json({ error: "This call has enough fixes waiting. Vote on one instead" }, 409);
      x = { id: crypto.randomUUID().slice(0, 8), k, val, by: me, up: [], dn: [], st: "open", ts: Date.now() }; L.push(x); }
  } else {
    x = L.find(y => y.id === b.id); if (!x) return json({ error: "Not found" }, 404);
    if (!crew && x.st !== "open" && x.st !== "flag") return json({ error: "That one's already settled" }, 409);
    if (action === "up") up(x);
    if (action === "down") { if (x.by === me) { x.st = "gone"; } else { x.up = x.up.filter(v => v !== me); if (!x.dn.includes(me)) x.dn.push(me); if (x.dn.length >= CF_DOWN) x.st = "flag"; } }
    if (action === "approve") { x.st = "open"; applied = true; }
    if (action === "reject") x.st = "no";
  }
  if (x.st === "open" && (applied || x.up.length >= CF_UP)) {
    await cfApply(env, ep, t, x); x.st = "done"; applied = true;
    for (const y of L) if (y !== x && y.k === x.k && (y.st === "open" || y.st === "flag")) y.st = "old"; // the call's settled now
  }
  await env.DB.put(key, JSON.stringify(doc));
  return json({ ok: true, applied, call: live().map(y => cfOut(y, me)) });
}

/* ---------- real 90s GIFs for the 1998 page ----------
   Picked from the Internet Archive's GeoCities collection (gifcities.org). The first request copies each one into R2,
   so after that the site serves its own copy and never asks the Archive again. Only these names are allowed. */
const G98 = { phone: "ITIO4JSORE2E73YN2ZL7EJAJ3V2BECLH", phone3: "IN247ZSIHFK36HRRZ5DKUCAPLYB7CQQJ", flamebar: "4GWM5R7ZEIYA5M7TH7HPQOCFVC67JUFL",
  fire: "7XCJH5B6O4BVBAFOY5QJPFOXRMSOV3DL", campfire: "FUUQ4XTCRKKLJUMVV3MOA4WF76IZTTGM", skull: "2TXWUNOD5M3HFTWFTHIRKFAMMMDS3EIN", skull2: "C5WW2WBHWFVNSQVZH3PG3NQHF5OQWBXJ",
  redskull: "BJLYVRBWWRPPMLICRGSQ4N5J3GCYYQTT", construction: "4EMVT763OYXVU23TRDIYOMIG63UTTR6H", sorry: "AA7OX7BZBGRUV6IJLHCTCAY6KDZHP2TY", constr2: "3BRQCUJYYW2BZTHNT5NCVMX7GBP3AKFT",
  netscape: "2HWGKKL26HMWLHET7A5GJT3T5X6XSGLN", welcome: "CX2IO4Z3E5UPA7PEP5UZKKZSRHFUKFTF", guestbook: "52YCYR75K3XSH2E3QUE2ZR3QTGZLT2R3", guestbook2: "3ICNUIOT7RE7QTYOODZMWINASVD4O5TF",
  rainbow: "2EFGA4USC76OJCYG3H4UFFY564YFCCYJ", newb: "4GWF4AMXUG5DHQG3CG5JEFA6JPUZJPEV", stars: "2D5BTPJP2UJ3R6SCF2KF4NW374RNGK3B", baby: "7EJDSXOHSHL4PATBBPPIVKEWDVXZQXM2" };
async function gif98(env, key) {
  if (!G98[key]) return json({ error: "Not found" }, 404);
  const h = { "content-type": "image/gif", "cache-control": "public, max-age=31536000, immutable", ...cors() }, rk = `g98/${key}.gif`;
  if (env.CLIPS) { const o = await env.CLIPS.get(rk); if (o) return new Response(o.body, { headers: h }); }
  const r = await fetch(`https://blob.gifcities.org/gifcities/${G98[key]}.gif`, { cf: { cacheTtl: 31536000 } });
  if (!r.ok) return json({ error: "Couldn't fetch that GIF" }, 502);
  const buf = await r.arrayBuffer(); if (buf.byteLength > 200000) return json({ error: "Too big" }, 413);
  if (env.CLIPS) try { await env.CLIPS.put(rk, buf, { httpMetadata: { contentType: "image/gif" } }); } catch (e) {}
  return new Response(buf, { headers: h });
}

/* ---------- the 1998 page's hit counter (each browser counts once a day) ---------- */
async function hits(env, add) {
  if (!env.DB) return json({ hits: 0 });
  let n = +(await env.DB.get("hits") || 0);
  if (add) { n += 1; try { await env.DB.put("hits", String(n)); } catch (e) {} }
  return json({ hits: n });
}

/* ---------- the 1998 page's guestbook ----------
   Entries post straight up unless the filter trips (then they wait for the crew). 3 per hour per person, 2,000 kept at most. */
async function gbList(env, prefix) {
  if (!env.DB) return { entries: [] };
  const out = []; let cursor;
  do { const pg = await env.DB.list({ prefix, cursor, limit: 1000 }); for (const k of pg.keys) if (k.metadata) out.push({ id: k.name.slice(2), ...k.metadata }); cursor = pg.list_complete ? null : pg.cursor; } while (cursor && out.length < 2000);
  out.sort((a, b) => b.t - a.t);
  return { entries: prefix === "g:" ? out.slice(0, 300) : out };
}
async function gbPost(request, env) {
  if (!env.DB) return json({ error: "Guestbook isn't set up" }, 500);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const n = clean(b.name, 30) || "anonymous", msg = clean(b.msg, 200); if (!msg) return json({ error: "Write something first" }, 400);
  const ip = request.headers.get("cf-connecting-ip") || "unknown", hour = new Date().toISOString().slice(0, 13), rl = `gr:${ip}:${hour}`, used = +(await env.DB.get(rl) || 0);
  if (used >= 3) return json({ error: "Easy there. Try again in an hour" }, 429);
  if (+(await env.DB.get("gbcount") || 0) >= 2000) return json({ error: "The guestbook is full" }, 507);
  const id = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 4), flag = screen(n, msg), md = { n, m: msg, t: Date.now(), ...(flag ? { flag } : {}) };
  await env.DB.put((flag ? "h:" : "g:") + id, "1", { metadata: md });
  await env.DB.put(rl, String(used + 1), { expirationTtl: 3700 });
  await env.DB.put("gbcount", String(+(await env.DB.get("gbcount") || 0) + 1));
  return json({ ok: true, held: !!flag, entry: { id, ...md } });
}
async function gbAct(env, id, action) {
  if (action === "approve") { const k = await env.DB.getWithMetadata("h:" + id); if (!k.value) return json({ error: "Not found" }, 404); const md = { ...k.metadata }; delete md.flag; await env.DB.put("g:" + id, "1", { metadata: md }); await env.DB.delete("h:" + id); return json({ ok: true }); }
  await env.DB.delete("g:" + id); await env.DB.delete("h:" + id);
  await env.DB.put("gbcount", String(Math.max(0, +(await env.DB.get("gbcount") || 1) - 1)));
  return json({ ok: true });
}

/* ---------- clip board ---------- */
// Records live in KV as "p:<id>" (waiting, or sent privately to the crew) or "a:<id>" (approved, public).
// Metadata carries the card data so one list() fills the board.
async function clipsList(env, prefix = "a:", fresh = false) {
  if (!env.DB) return json({ clips: [] });
  const out = []; let cursor;
  do { const page = await env.DB.list({ prefix, cursor, limit: 1000 }); for (const k of page.keys) if (k.metadata) out.push({ id: k.name.slice(2), ...k.metadata }); cursor = page.list_complete ? null : page.cursor; } while (cursor && out.length < 3000);
  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return json({ clips: out }, 200, prefix === "a:" && !fresh ? 30 : 0);
}
async function clipAudio(env, ctx, id, prefix, url, request) {
  if (!env.DB || !env.CLIPS) return json({ error: "Storage not set up" }, 500);
  const rec = await env.DB.getWithMetadata(prefix + id); if (!rec.value) return json({ error: "Not found" }, 404);
  const md = rec.metadata || {}, extra = url.searchParams.get("dl") ? { "content-disposition": `attachment; filename="${fileName(md.title || id)}"` } : {};
  // A clip from a show is just "show X, from A to B": play that slice. Nothing extra is stored.
  if (md.ref) return slice(env, ctx, request, md.ref.ep, md.ref.from, md.ref.to, { ...extra, "cache-control": prefix === "a:" ? "public, max-age=86400" : "no-store" });
  const obj = await env.CLIPS.get(`clips/${id}.mp3`); if (!obj) return json({ error: "Not found" }, 404);
  return new Response(obj.body, { headers: { "content-type": "audio/mpeg", "cache-control": prefix === "a:" ? "public, max-age=604800" : "no-store", ...cors(), ...extra } });
}
/* ---------- shareable clip links ----------
   /c/<id> is a small page with Open Graph video tags. Discord (and most chat apps) only show a player for video,
   so /c/<id>.mp4 wraps the clip's MP3 in an MP4 with one still picture. Only the MP4 header is built here
   (and saved in R2 as mp4h/<id>); the audio bytes stream straight from the clip's source, untouched. */
async function clipSource(env, ctx, id) {
  const rec = await env.DB.getWithMetadata("a:" + id); if (!rec.value) return null;
  const md = rec.metadata || {};
  if (md.ref) {
    const ep = await memo(ctx, "ep2" + md.ref.ep, 604800, () => episode(md.ref.ep)); if (!ep.mp3) return null;
    const lay = await memo(ctx, "lay" + md.ref.ep, 2592000, () => mp3Layout(env, md.ref.ep, ep.mp3));
    const a = Math.floor(lay.start + md.ref.from * lay.bytesPerSec), z = Math.floor(lay.start + md.ref.to * lay.bytesPerSec);
    return { md, size: z - a + 1, read: (o, l) => readPiece(env, md.ref.ep, ep.mp3, a + o, a + o + l - 1) };
  }
  const head = await env.CLIPS.head(`clips/${id}.mp3`); if (!head) return null;
  return { md, size: head.size, read: async (o, l) => (await env.CLIPS.get(`clips/${id}.mp3`, { range: { offset: o, length: l } })).body };
}
async function clipMp4Head(env, id, src) {
  const k = `mp4h/${id}`, o = await env.CLIPS.get(k);
  if (o) return { head: new Uint8Array(await o.arrayBuffer()), start: +o.customMetadata.start, end: +o.customMetadata.end };
  const mp3 = new Uint8Array(await new Response(await src.read(0, src.size)).arrayBuffer());
  const h = mp4Head(mp3);
  await env.CLIPS.put(k, h.head, { customMetadata: { start: String(h.start), end: String(h.end) } });
  return h;
}
async function clipVideo(env, ctx, id, request) {
  if (!env.DB || !env.CLIPS) return json({ error: "Storage not set up" }, 500);
  const src = await clipSource(env, ctx, id); if (!src) return json({ error: "Not found" }, 404);
  let H; try { H = await clipMp4Head(env, id, src); } catch (e) { return json({ error: "Couldn't build the video" }, 502); }
  const hl = H.head.length, total = hl + (H.end - H.start);
  let s0 = 0, s1 = total - 1, status = 200;
  const rg = (request.headers.get("range") || "").match(/bytes=(\d*)-(\d*)/);
  if (rg && (rg[1] || rg[2])) { if (rg[1]) { s0 = +rg[1]; s1 = rg[2] ? Math.min(+rg[2], total - 1) : total - 1; } else s0 = Math.max(0, total - +rg[2]); if (s0 > s1) return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } }); status = 206; }
  const len = s1 - s0 + 1, out = new FixedLengthStream(len);
  ctx.waitUntil((async () => {
    const w = out.writable.getWriter();
    try {
      if (s0 < hl) await w.write(H.head.subarray(s0, Math.min(hl, s1 + 1)));
      if (s1 >= hl) { const a0 = Math.max(0, s0 - hl), a1 = s1 - hl; const r = (await src.read(H.start + a0, a1 - a0 + 1)).getReader();
        for (;;) { const { done, value } = await r.read(); if (done) break; await w.write(value); } }
      await w.close();
    } catch (e) { try { await w.abort(e); } catch (x) {} }
  })());
  const h = { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": String(len), "cache-control": "public, max-age=86400", ...cors() };
  if (status === 206) h["content-range"] = `bytes ${s0}-${s1}/${total}`;
  return new Response(out.readable, { status, headers: h });
}
const hx = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function clipPage(env, ctx, id, url) {
  if (!env.DB) return json({ error: "Storage not set up" }, 500);
  const rec = await env.DB.getWithMetadata("a:" + id);
  const o = url.origin;
  if (!rec.value) return new Response(`<!doctype html><meta charset="utf-8"><title>Clip not found</title><meta http-equiv="refresh" content="2;url=${o}/#clips"><body style="background:#05040c;color:#e6f4ff;font-family:system-ui;padding:40px">That clip isn't on the board anymore. Taking you to the clip board…</body>`, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const md = rec.metadata || {}, ep = md.ep ? (await allEpisodes(env, ctx).catch(() => [])).find(e => e.id === md.ep) : null;
  const len = (+md.sec || 0) >= 60 ? `${Math.floor(md.sec / 60)}m ${Math.round(md.sec % 60)}s` : `${Math.round(+md.sec || 0)}s`;
  const when = ep?.d ? new Date(ep.d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
  const desc = [`A Callective clip${when ? ` from the ${when} show` : ""}${ep?.h ? `, hosted by ${ep.h}` : ""}`, len, md.by ? `Clipped by ${md.by}.` : ""].filter(Boolean).join(" · ");
  const t = hx(md.title || "A Callective clip"), d = hx(desc), v = `${o}/c/${id}.mp4`, img = `${o}/img/clip-card.jpg`, page = `${o}/c/${id}`;
  const show = md.ep ? `<a href="${o}/#show/${md.ep}">The whole show →</a>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t} · The Callective</title><meta name="description" content="${d}">
<meta property="og:site_name" content="The Callective"><meta property="og:type" content="video.other"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:url" content="${page}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="720">
<meta property="og:video" content="${v}"><meta property="og:video:url" content="${v}"><meta property="og:video:secure_url" content="${v}"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="1280"><meta property="og:video:height" content="720">
<meta name="twitter:card" content="player"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}"><meta name="twitter:player" content="${page}?embed=1"><meta name="twitter:player:width" content="640"><meta name="twitter:player:height" content="200"><meta name="twitter:player:stream" content="${v}"><meta name="twitter:player:stream:content_type" content="video/mp4">
<meta name="theme-color" content="#ff2bd6"><link rel="icon" href="${o}/img/mark.webp">
<style>body{margin:0;background:#05040c;color:#e6f4ff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}
.c{width:min(640px,100%);border:1px solid #2b2650;background:#0a0919;padding:18px;box-shadow:0 0 30px #ff2bd633}
.k{font:12px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#ff2bd6}h1{font-size:24px;margin:6px 0 4px;color:#18f0ff;text-shadow:0 0 10px #18f0ff66}
p{color:#8e9ac4;margin:0 0 12px;font-size:14px}audio{width:100%}a{color:#e9ff3b}.l{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:14px}
${url.searchParams.get("embed") ? ".l,.k{display:none}.c{border:0;box-shadow:none;padding:10px}body{min-height:0}" : ""}</style></head>
<body><main class="c"><div class="k">The Callective · clip</div><h1>${t}</h1><p>${d}</p><audio controls preload="metadata" src="${o}/api/clips/${id}.mp3"></audio>
<div class="l"><a href="${o}/#clips">More clips on the board →</a>${show}<a href="${o}/">The Callective</a></div></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
function looksLikeMp3(b) { return (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0); }
async function clipsPost(request, env, ctx) {
  if (!env.DB || !env.CLIPS) return json({ error: "Clip storage isn't set up yet" }, 500);
  const ip = request.headers.get("cf-connecting-ip") || "unknown", hour = new Date().toISOString().slice(0, 13);
  const rlKey = `rl:${ip}:${hour}`, used = +(await env.DB.get(rlKey) || 0);
  if (used >= UPLOADS_PER_HOUR) return json({ error: "That's a lot of clips. Try again in an hour" }, 429);
  // Hard ceilings for the whole site, so storage can never run away (about 2 MB a clip at most):
  // no more than UPLOADS_PER_DAY sends a day from everyone combined, and no more than MAX_STORED_CLIPS kept at once.
  const dayKey = `day:${new Date().toISOString().slice(0, 10)}`, today = +(await env.DB.get(dayKey) || 0);
  if (today >= UPLOADS_PER_DAY) return json({ error: "The clip inbox is full for today. Try again tomorrow" }, 429);
  const stored = +(await env.DB.get("count") || 0);
  if (stored >= MAX_STORED_CLIPS) return json({ error: "The clip board is full right now. The crew has been told" }, 507);
  if ((request.headers.get("content-type") || "").includes("application/json")) return refPost(request, env, ctx, { rlKey, used, dayKey, today });
  let form; try { form = await request.formData(); } catch (e) { return json({ error: "Send the clip as a form" }, 400); }
  const file = form.get("file"); let meta = {}; try { meta = JSON.parse(form.get("meta") || "{}"); } catch (e) {}
  if (!file || typeof file === "string") return json({ error: "No audio attached" }, 400);
  if (file.size > MAX_CLIP_BYTES) return json({ error: "Clips can be 10 minutes at most" }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeMp3(bytes)) return json({ error: "That isn't an MP3" }, 415);
  const title = clean(meta.title, 80); if (!title) return json({ error: "Give the clip a name" }, 400);
  const sec = Math.min(MAX_CLIP_SEC, Math.max(0, +meta.sec || 0)); if (sec > MAX_CLIP_SEC - 0.5) return json({ error: "Clips can be 10 minutes at most" }, 400);
  const id = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 6);
  const dest = meta.dest === "crew" ? "crew" : "board";
  const md = { title, by: clean(meta.by, 40), ep: Number.isInteger(meta.ep) ? meta.ep : null, at: Number.isFinite(+meta.at) && meta.at !== null ? Math.round(+meta.at) : null,
    live: !!meta.live, sec: +sec.toFixed(1), peaks: String(meta.peaks || "").replace(/[^0-9]/g, "").slice(0, 48), created: Date.now(), dest, note: clean(meta.note, 300),
    flag: screen(title, meta.by) || (dest === "board" ? "recorded audio" : undefined) };
  await env.CLIPS.put(`clips/${id}.mp3`, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
  await env.DB.put("p:" + id, "1", { metadata: md });
  await env.DB.put(rlKey, String(used + 1), { expirationTtl: 3700 });
  await env.DB.put(dayKey, String(today + 1), { expirationTtl: 90000 });
  await env.DB.put("count", String(stored + 1));
  if (env.DISCORD_WEBHOOK) ctx.waitUntil(notify(env.DISCORD_WEBHOOK, md, bytes));
  return json({ ok: true, id, status: dest === "crew" ? "sent to the crew" : "waiting" });
}
/* ---------- Host your own Callective (rooms live in the Hall durable object, worker/hall.js) ---------- */
const HALL_WORDS = ["BUTT", "CAW", "DING", "LUNK", "QUACK", "BELL", "DIAL", "RING", "HOLD", "FART", "TOMMAN", "PEE", "GOOSE", "PIZZA", "HOTEL", "BUSY", "PATCH", "ROTARY"];
async function ipTag(request) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hall:" + ip));
  return [...new Uint8Array(d)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hallNew(request, env) {
  if (!env.HALL) return json({ error: "Rooms aren't set up yet" }, 500);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const title = clean(b.title, 60) || "The Callective";
  if (screen(title)) return json({ error: "Try a different room name" }, 400);
  if (env.DB) { // 6 new rooms an hour per person
    const k = `hallrl:${await ipTag(request)}:${new Date().toISOString().slice(0, 13)}`, n = +(await env.DB.get(k) || 0);
    if (n >= 6) return json({ error: "That's a lot of rooms. Try again in an hour" }, 429);
    await env.DB.put(k, String(n + 1), { expirationTtl: 3700 });
  }
  for (let tries = 0; tries < 6; tries++) {
    const r = crypto.getRandomValues(new Uint32Array(2)), code = `${HALL_WORDS[r[0] % HALL_WORDS.length]}-${String(r[1] % 10000).padStart(4, "0")}`;
    const res = await env.HALL.get(env.HALL.idFromName(code)).fetch("https://hall/create", { method: "POST", body: JSON.stringify({ code, title }) });
    if (res.status === 409) continue;
    const o = await res.json(); return json({ code, title, hostKey: o.hostKey });
  }
  return json({ error: "Couldn't find a free code. Try again" }, 503);
}
// Voice connection helpers. STUN is free and works for most home networks. If TURN keys are set up
// (Cloudflare Realtime → TURN; secrets TURN_KEY_ID + TURN_KEY_API_TOKEN), strict networks get a relay too.
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
async function hallIce(env, ctx) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ iceServers: STUN });
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${String(env.TURN_KEY_ID).trim()}/credentials/`;
  const opt = { method: "POST", headers: { authorization: `Bearer ${String(env.TURN_KEY_API_TOKEN).trim()}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }) };
  let why = "";
  for (const path of ["generate-ice-servers", "generate"]) { // newer endpoint first, then the original one
    try {
      const r = await fetch(base + path, opt), txt = await r.text();
      if (!r.ok) { why += `${path}:${r.status} `; continue; }
      const o = JSON.parse(txt), ice = o.iceServers; if (!ice) { why += `${path}:noice `; continue; }
      return json({ iceServers: [...STUN, ...(Array.isArray(ice) ? ice : [ice])], turn: true });
    } catch (e) { why += `${path}:err `; }
  }
  return json({ iceServers: STUN, turn: false, turnError: why.trim() }); // status codes only, never the key
}
async function hallGo(request, env, code, ws) {
  if (!env.HALL) return json({ error: "Rooms aren't set up yet" }, 500);
  const stub = env.HALL.get(env.HALL.idFromName(code)), u = new URL(request.url);
  if (!ws) { const r = await stub.fetch("https://hall/info"); return json(await r.json(), r.status); }
  const h = new Headers(request.headers); h.set("x-ip", await ipTag(request));
  return stub.fetch(new Request("https://hall/ws" + u.search, { headers: h }));
}

/* ---------- the auto-post filter ----------
   Clips cut from a show go straight onto the board unless the words people typed trip this.
   It looks for slurs, phone numbers (prank calls involve real people), emails and links. Anything flagged waits for the crew. */
// A clip that's a slice of a show: no audio upload, so it takes no storage.
async function refPost(request, env, ctx, rl) {
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const ep = Number.isInteger(b.ep) ? b.ep : null, from = +b.from, to = +b.to;
  if (!ep || !(from >= 0) || !(to > from)) return json({ error: "That clip is missing its show or times" }, 400);
  if (to - from > MAX_REF_SEC + 1) return json({ error: "Clips can be 10 minutes at most" }, 400);
  const title = clean(b.title, 80); if (!title) return json({ error: "Give the clip a name" }, 400);
  const id = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 6), dest = b.dest === "crew" ? "crew" : "board";
  const md = { title, by: clean(b.by, 40), ep, at: Math.round(from), sec: +(to - from).toFixed(1), ref: { ep, from: +from.toFixed(2), to: +to.toFixed(2) }, created: Date.now(), dest, note: clean(b.note, 300) };
  const flag = screen(md.title, md.by);
  if (flag) md.flag = flag;
  const auto = dest === "board" && !flag; // clean show clips go straight to the board
  await env.DB.put((auto ? "a:" : "p:") + id, "1", { metadata: auto ? { ...md, note: "" } : md });
  await env.DB.put(rl.rlKey, String(rl.used + 1), { expirationTtl: 3700 });
  await env.DB.put(rl.dayKey, String(rl.today + 1), { expirationTtl: 90000 });
  if (env.DISCORD_WEBHOOK) ctx.waitUntil(notify(env.DISCORD_WEBHOOK, { ...md, auto }, null));
  return json({ ok: true, id, status: dest === "crew" ? "sent to the crew" : auto ? "posted" : "held", flag: flag || null });
}
async function notify(hook, md, bytes) {
  const what = md.dest === "crew" ? `📨 Clip sent to the crew` : md.auto ? `📼 New clip on the board` : `🚩 Clip held for a look${md.flag ? ` (${md.flag})` : ""}`;
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify({ content: `${what}: **${md.title}** by ${md.by || "anonymous"} (${md.sec}s)${md.live ? " from the live show" : md.ep ? ` from show ${md.ep}` : ""}${md.ref ? ` (${Math.floor(md.sec / 60)}m ${Math.round(md.sec % 60)}s slice)` : ""}.${md.note ? `\n> ${md.note}` : ""}\n${md.auto ? "Dial M-O-D on the site if it needs to come down." : "Dial M-O-D on the site to see it."}`, allowed_mentions: { parse: [] } }));
  if (bytes) fd.append("files[0]", new Blob([bytes], { type: "audio/mpeg" }), "clip.mp3");
  try { await fetch(hook, { method: "POST", body: fd }); } catch (e) {}
}
// Three different listeners reporting a clip pulls it off the board and back to the crew.
async function report(env, id, request) {
  const k = await env.DB.getWithMetadata("a:" + id); if (!k.value) return json({ ok: true });
  const ip = request.headers.get("cf-connecting-ip") || "unknown", mine = `rp:${id}:${ip}`;
  if (await env.DB.get(mine)) return json({ ok: true, already: true });
  await env.DB.put(mine, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  const n = +(await env.DB.get("rc:" + id) || 0) + 1;
  if (n >= 3) { await env.DB.put("p:" + id, "1", { metadata: { ...k.metadata, flag: "reported by listeners" } }); await env.DB.delete("a:" + id); await env.DB.delete("rc:" + id); }
  else await env.DB.put("rc:" + id, String(n), { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ ok: true });
}
async function modAct(env, id, action) {
  if (action === "remove") {
    const pub = await env.DB.getWithMetadata("a:" + id); if (!pub.value) return json({ error: "Not on the board" }, 404);
    await env.DB.delete("a:" + id); await env.CLIPS.delete(`mp4h/${id}`);
    if (!pub.metadata?.ref) { await env.CLIPS.delete(`clips/${id}.mp3`); await env.DB.put("count", String(Math.max(0, (+(await env.DB.get("count")) || 1) - 1))); }
    return json({ ok: true });
  }
  const k = await env.DB.getWithMetadata("p:" + id);
  if (!k.value) return json({ error: "Not in the queue" }, 404);
  if (action === "approve") { const md = { ...k.metadata, note: "" }; delete md.flag; await env.DB.put("a:" + id, "1", { metadata: md }); await env.DB.delete("p:" + id); }
  else {
    await env.DB.delete("p:" + id);
    if (!k.metadata?.ref) { await env.CLIPS.delete(`clips/${id}.mp3`); await env.DB.put("count", String(Math.max(0, (+(await env.DB.get("count")) || 1) - 1))); }
  }
  return json({ ok: true });
}


/* ---------- The Callective Mix: IceCat's Suno playlist, kept in sync (Nov 2026) ----------
   About once an hour (cron) the worker reads the public playlist through the same endpoint suno.com's own page uses
   (unofficial: if Suno changes it, the last good list stays up). Only songs Suno lets anyone play are listed: a song
   has to be public on Suno, or its audio comes back "forbidden". Audio streams from Suno's CDN through /api/mix/<id>.mp3,
   so nothing is stored in R2. */
const MIX_PLAYLIST = "5296ac6d-e931-443f-8824-526220aef2eb", MIX_EVERY = 55 * 60 * 1000;
async function mixFetchPage(n) {
  const hdr = { "user-agent": "Mozilla/5.0 (compatible; CallectiveSite/1.0; +https://thecallective.com)", accept: "application/json" };
  let last = null;
  for (const base of ["https://suno.com/a/api", "https://studio-api.prod.suno.com/api"]) {
    try { const r = await fetch(`${base}/playlist/${MIX_PLAYLIST}/?page=${n}`, { headers: hdr }); if (r.ok) return await r.json(); last = `${base} ${r.status}`; } catch (e) { last = `${base} ${e.message}`; }
  }
  throw new Error("playlist: " + last);
}
async function mixSync(env, force) {
  const old = env.DB ? JSON.parse(await env.DB.get("mix") || "null") : null;
  if (!force && old && old.v === 3 && Date.now() - (old.at || 0) < MIX_EVERY) return old;
  const songs = [], seen = new Set(); let total = 0, hidden = 0, noaudio = 0, name = "", page = 0;
  while (page < 10) {
    const j = await mixFetchPage(page); name = j.name || name; total = j.num_total_results || total;
    const L = (j.playlist_clips || []).map(x => x.clip || x); if (!L.length) break;
    for (const c of L) {
      if (!c || !c.id || seen.has(c.id) || c.status !== "complete" || c.is_trashed) continue; seen.add(c.id);
      const open = c.is_public || (/^https:\/\/cdn\d?\.suno\.ai\//.test(c.audio_url || ""));
      if (!open) { hidden++; continue; }
      // Newer Suno songs have no public mp3 on cdn1 (their app streams a scrambled .m4a instead), so only songs with a real mp3 count.
      const ok = await fetch(`https://cdn1.suno.ai/${c.id}.mp3`, { method: "HEAD" }).then(r => r.ok).catch(() => false);
      if (!ok) { noaudio++; continue; }
      songs.push({ id: c.id, t: clean(c.title || "Untitled", 80), sec: Math.round(c.metadata?.duration || 0), img: /^https:\/\/cdn\d?\.suno\.ai\//.test(c.image_url || "") ? c.image_url : "" });
    }
    if (songs.length + hidden + noaudio >= total) break; page++;
  }
  const out = { v: 3, at: Date.now(), name, total, hidden, noaudio, songs, playlist: `https://suno.com/playlist/${MIX_PLAYLIST}` };
  if (env.DB) await env.DB.put("mix", JSON.stringify(out));
  return out;
}
async function mixGet(env, ctx) {
  const old = env.DB ? JSON.parse(await env.DB.get("mix") || "null") : null;
  if (old && old.v === 3 && Date.now() - (old.at || 0) < MIX_EVERY) return old;
  try { return await mixSync(env, true); }
  catch (e) { if (old && env.DB) { old.v = 3; old.at = Date.now() - MIX_EVERY + 10 * 60 * 1000; old.lastError = e.message; await env.DB.put("mix", JSON.stringify(old)); } return old || { songs: [], error: e.message }; } // try again in 10 minutes
}
async function mixAudio(env, id, request, url) {
  const mix = env.DB ? JSON.parse(await env.DB.get("mix") || "null") : null;
  const song = mix && mix.songs.find(x => x.id === id); if (!song) return json({ error: "Not in the mix" }, 404);
  const h = {}; const rg = request.headers.get("range"); if (rg) h.range = rg;
  const r = await fetch(`https://cdn1.suno.ai/${id}.mp3`, { headers: h, cf: { cacheTtl: 86400, cacheEverything: true } }), ext = "mp3", type = "audio/mpeg";
  if (!r.ok && r.status !== 206) return json({ error: "Suno didn't send the song" }, 502);
  const out = new Headers(); for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) { const v = r.headers.get(k); if (v) out.set(k, v); }
  out.set("content-type", type); out.set("cache-control", "public, max-age=86400"); out.set("access-control-allow-origin", "*");
  if (url.searchParams.get("dl")) out.set("content-disposition", `attachment; filename="callective-${song.t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}.${ext}"`);
  return new Response(r.body, { status: r.status, headers: out });
}
