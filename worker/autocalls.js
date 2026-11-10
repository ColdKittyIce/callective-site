/**
 * Automatic call lists for new shows.
 *
 * The hand-checked lists in public/data/calls.json stop at 10/24/26. For every newer show, the cron reads the
 * Callective Discord channel for that show's time window (READ ONLY, with CallBot's token) and builds the list
 * from the queue bot's "!next" handoffs, the same way the hand-checked ones were made:
 *   - a call runs from one handoff to the next (the first one starts at 0:00, so the intro banter is in it)
 *   - the caller is the name the bot gives when the turn ends; costume nicknames are mapped back (callnames.js)
 *   - the last caller is the one the final "Now calling" pinged (their server nickname / display name)
 *   - a turn under 20 seconds is marked skipped
 * Times line up with the Prankcast broadcast start (`st` from the episode).
 *
 * Gentle on Discord and on the free plan: it looks for a new show every 3 days. When it finds one, it reads it
 * 8 pages of 100 messages per run (the cron runs every 15 minutes, so a show takes about half an hour), then any other
 * new show the same way, then goes quiet for another 3 days. Between checks it never calls Discord. Never posts, edits or deletes anything.
 * Needs the secret DISCORD_BOT_TOKEN (`npx wrangler secret put DISCORD_BOT_TOKEN`). Without it, this does nothing.
 *
 * KV "autocalls" = { shows: { <id>: { calls: [...], made } | { none: true, why } }, job: {...while a show is being read} }
 */
import { NICK, KNOWN } from "./callnames.js";

const CHANNEL = "1315742525775941642"; // #the-callective-saturdays-at-7pm-est
const DAPI = "https://discord.com/api/v10";
const CHECK_EVERY_MS = 3 * 864e5; // look for a new show every 3 days
const PAGES_PER_RUN = 8, SKIP_SEC = 20, LEAD_MS = 15 * 60e3, TAIL_MS = 20 * 60e3, MAX_TRIES = 12;
const DISCORD_EPOCH = 1420070400000;
const snow = ms => (BigInt(Math.max(0, ms - DISCORD_EPOCH)) << 22n).toString();
const norm = s => String(s || "").replace(/[‘’]/g, "'").trim();

// The name the site uses for a caller, from the nickname the bot printed (or, for the last caller, the name of the
// person the final "Now calling" pinged). Costume nicknames the map doesn't know yet go up as is; the crew or
// listeners can fix them on the show page (✎ Fix).
export function callerName(nick, alt) {
  for (const x of [nick, alt]) {
    const n = norm(x); if (!n) continue;
    if (KNOWN.has(n)) return n;
    if (NICK[n]) return NICK[n];
  }
  return norm(nick) || norm(alt) || "Unknown caller";
}

// One queue-bot handoff from a message, or null. Patrick ("… **X**'s off … Now calling: <@id>") and the old queue bot
// ("X has been removed from the queue. Next up: <@id>").
function handoff(m) {
  const a = m.author || {}; if (!a.bot) return null;
  const c = String(m.content || ""); if (!/Now calling|Next up/.test(c)) return null;
  const line = c.split("\n")[0];
  let ended = null, x;
  if ((x = line.match(/^\W*\**(.+?)\**\s+has been removed from the queue/))) ended = x[1];
  else if ((x = line.match(/\*\*(.+?)\*\*/))) ended = x[1];
  const nx = c.match(/(?:Now calling|Next up)[^<]*<@!?(\d+)>/);
  const nextId = nx ? nx[1] : null;
  let nextNick = null;
  if (nextId) { const u = (m.mentions || []).find(u => u.id === nextId); if (u) nextNick = (u.member && u.member.nick) || u.global_name || u.username || null; }
  return { ms: Date.parse(m.timestamp), ended, nextId, nextNick };
}

export function buildCalls(H, stMs, sec) {
  const hs = H.map(h => ({ ...h, t: Math.round((h.ms - stMs) / 1000) })).filter(h => h.t > 30 && h.t < sec).sort((a, b) => a.t - b.t);
  if (!hs.length) return [];
  const calls = []; let start = 0, prevNick = null;
  for (const h of hs) { calls.push({ t: start, by: callerName(h.ended, prevNick) }); start = h.t; prevNick = h.nextNick; }
  const last = hs[hs.length - 1];
  calls.push({ t: start, by: callerName(last.nextNick) });
  for (let i = 0; i < calls.length - 1; i++) if (calls[i + 1].t - calls[i].t < SKIP_SEC) calls[i].skip = true;
  return calls;
}

async function discord(env, path) {
  const r = await fetch(DAPI + path, { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "user-agent": "CallectiveSite (read-only call lists, 1.0)" } });
  if (!r.ok) throw new Error(`Discord ${r.status}`);
  return r.json();
}

/**
 * One cron step. ctx: { episodes: () => all episodes [{id, sec}], info: id => {st, sec}, staticIds: Set of ids in calls.json }
 */
export async function autoCallsStep(env, ctx) {
  if (!env.DISCORD_BOT_TOKEN || !env.DB) return;
  const state = JSON.parse(await env.DB.get("autocalls") || "{}"); state.shows = state.shows || {};
  let job = state.job;
  if (!job) {
    if (state.idleSince && Date.now() - state.idleSince < CHECK_EVERY_MS) return; // checked recently: leave Discord alone
    const staticIds = await ctx.staticIds(), floor = Math.max(0, ...[...staticIds].map(Number));
    const todo = (await ctx.episodes()).filter(e => e.id > floor && !staticIds.has(String(e.id)) && !state.shows[e.id]).sort((a, b) => a.id - b.id)[0];
    if (!todo) { state.idleSince = Date.now(); await env.DB.put("autocalls", JSON.stringify(state)); return; } // nothing new: check again in 3 days
    const info = await ctx.info(todo.id);
    if (!info.st) return;
    const st = Date.parse(String(info.st).replace(" ", "T") + "Z"), sec = info.sec || todo.sec;
    delete state.idleSince;
    job = state.job = { id: todo.id, st, sec, end: st + sec * 1000, after: snow(st - LEAD_MS), H: [], tries: 0 };
  }
  try {
    let done = false;
    for (let p = 0; p < PAGES_PER_RUN && !done; p++) {
      const page = await discord(env, `/channels/${CHANNEL}/messages?limit=100&after=${job.after}`);
      if (!page.length) { done = true; break; }
      let maxId = job.after;
      for (const m of page) {
        if (BigInt(m.id) > BigInt(maxId)) maxId = m.id;
        if (Date.parse(m.timestamp) > job.end + TAIL_MS) { done = true; continue; }
        const h = handoff(m); if (h) job.H.push(h);
      }
      job.after = maxId;
      if (page.length < 100) done = true;
    }
    if (done) {
      const calls = buildCalls(job.H, job.st, job.sec);
      state.shows[job.id] = calls.length ? { calls, made: Date.now() } : { none: true, why: "no queue-bot handoffs in Discord", made: Date.now() };
      delete state.job;
    }
  } catch (e) {
    job.tries++; job.err = String(e && e.message || e);
    if (job.tries >= MAX_TRIES) { state.shows[job.id] = { none: true, why: job.err, made: Date.now() }; delete state.job; }
  }
  await env.DB.put("autocalls", JSON.stringify(state));
}

// What the site loads: { <show id>: { calls: [...], auto: true } } for shows that got a list.
export async function autoCallsGet(env) {
  if (!env.DB) return {};
  const s = JSON.parse(await env.DB.get("autocalls") || "{}"), out = {};
  for (const [id, v] of Object.entries(s.shows || {})) if (v.calls && v.calls.length) out[id] = { calls: v.calls, auto: true };
  return out;
}
