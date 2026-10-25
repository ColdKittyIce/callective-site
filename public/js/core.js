/* core: helpers, data, the live API, synthesized phone sounds, shared media */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PC_POST = "https://prankcast.com/thecallective/posts/";
const CREW = new Set(["iregretjumping","icecat","despicabledogs","drtomservo","thecallective","andyanderson","criefaux","phonelosers","milkbox"]);

const C = { episodes: [], clips: [], calls: {}, api: null, live: null };

function hms(s, forceH) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h || forceH ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
function fmtDate(d) {
  return d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Undated";
}
function fmtLen(sec) { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; }
function niceTitle(e) { return /^the callective$/i.test((e.t || "").trim()) ? "The Callective (untitled upload)" : (e.t || "").trim(); }

let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

async function getJSON(url, ms = 6000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

/* The live API exists only when the site runs on its Cloudflare Worker. Everywhere else the page uses its baked data. */
async function detectApi() {
  try { const s = await getJSON("/api/ping", 3500); if (s && s.ok) C.api = "/api"; } catch (e) { C.api = null; }
  if (C.api) { try { const s = await getJSON("/api/status", 5000); if (typeof s.live === "boolean") C.live = s; } catch (e) {} }
  document.documentElement.dataset.api = C.api ? "on" : "off";
  return C.api;
}

/* ---------- synthesized phone sounds (Web Audio) ---------- */
let AC = null;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (AC.state === "suspended") AC.resume().catch(() => {});
  return AC;
}
function tone(freqs, dur, vol = .12, when = 0, type = "sine") {
  const a = ac(); if (!a) return; const t0 = a.currentTime + when;
  const g = a.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .01); g.gain.setValueAtTime(vol, t0 + dur - .02); g.gain.linearRampToValueAtTime(0, t0 + dur);
  g.connect(a.destination);
  for (const f of [].concat(freqs)) { const o = a.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g); o.start(t0); o.stop(t0 + dur + .02); }
}
function click(when = 0, vol = .35) {
  const a = ac(); if (!a) return; const t0 = a.currentTime + when;
  const len = Math.floor(a.sampleRate * .018), b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = .8;
  const g = a.createGain(); g.gain.value = vol; s.connect(f).connect(g).connect(a.destination); s.start(t0);
}
const SFX = {
  ringback(n = 1) { for (let i = 0; i < n; i++) tone([440, 480], 1.4, .08, i * 2.4); return n * 2.4 - 1; },
  sit() { tone(913.8, .27, .1, 0); tone(1370.6, .27, .1, .29); tone(1776.7, .38, .1, .58); return 1.1; },
  busy() { for (let i = 0; i < 4; i++) tone([480, 620], .25, .09, i * .5); },
  pickup() { click(0, .5); click(.06, .3); },
  hangup() { click(0, .6); tone(120, .08, .2, 0, "square"); },
  thump() { const a = ac(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(140, a.currentTime); o.frequency.exponentialRampToValueAtTime(40, a.currentTime + .25);
    g.gain.setValueAtTime(.6, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .3); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .32); click(0, .6); },
  shutter() { click(0, .5); click(.09, .4); }
};

/* ---------- clips (switchboard drops) ---------- */
const clipPlayers = new Set();
function playClip(k, vol = 1) {
  const a = new Audio(`clips/${k}.mp3`); a.volume = clamp(vol, 0, 1);
  clipPlayers.add(a); a.addEventListener("ended", () => clipPlayers.delete(a));
  a.play().catch(() => {});
  const c = C.clips.find(x => x.k === k), label = c ? `${c.who}, “${c.line}”` : k;
  if (typeof Player !== "undefined") Player.set({ kind: "drop", el: a, title: label, page: "switchboard", clip: () => Player.clipFrom(a, `clips/${k}.mp3`, label) });
  return a;
}
function stopClips() { clipPlayers.forEach(a => a.pause()); clipPlayers.clear(); }

/* ---------- long-form media: hold music, songs, replay. One at a time. ---------- */
const Media = {
  els: new Set(),
  claim(el) { this.els.forEach(x => { if (x !== el && !x.paused) x.pause(); }); this.els.add(el); }
};

/* The site plays the newest 10 shows itself (from its own copies). Anything older opens on Prankcast. */
const RECENT = 10;
function recentIds() { return new Set(C.episodes.filter(e => e.sec > 600).sort((a, b) => b.id - a.id).slice(0, RECENT).map(e => e.id)); }
const isRecent = id => recentIds().has(+id);

async function loadData() {
  const [eps, clips, calls] = await Promise.all([getJSON("data/episodes.json"), getJSON("data/clips.json"), getJSON("data/calls.json").catch(() => ({}))]);
  C.episodes = eps.sort((a, b) => b.id - a.id); C.clips = clips; C.calls = calls || {};
}
/* Call lists (who made each call, and when it starts). Built from the Discord queue bot's handoffs, checked by the crew. */
function callsFor(id, dur) {
  const L = C.calls[id]?.calls; if (!L) return [];
  // t = the host's !next (where a clip starts and the previous one ends, so banter stays in). ring = when the phone starts ringing (where "jump" lands).
  const end = dur || C.episodes.find(e => e.id === +id)?.sec;
  return L.map((c, i) => { const nx = L.slice(i + 1).find(x => !x.skip); return { ...c, n: i + 1, at: c.ring || c.t, end: nx ? nx.t : (end || c.t + 600) }; });
}
function callAt(id, t, dur) { const L = callsFor(id, dur).filter(c => !c.skip); for (let i = L.length - 1; i >= 0; i--) if (t >= L[i].t) return L[i]; return null; }
async function mergeLatest() {
  if (!C.api) return;
  try {
    const latest = await getJSON(C.api + "/latest");
    const have = new Set(C.episodes.map(e => e.id)); let added = 0;
    for (const e of latest.posts || []) if (!have.has(e.id)) { C.episodes.push(e); added++; }
    if (added) { C.episodes.sort((a, b) => b.id - a.id); document.dispatchEvent(new CustomEvent("episodes-changed")); }
  } catch (e) {}
}
