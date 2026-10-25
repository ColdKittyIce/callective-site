/* Search everything: calls (who made them, titles), shows, the clip board and patch bay drops.
   Chat logs are deliberately NOT searchable (house rule: chat is offline material, never mined on the site).
   Forgiving on purpose: emoji and punctuation are ignored, nicknames map to the usual name (rozin → rosin, tom man → Dr. Tom Servo),
   words can be partial, and a one-letter typo in a longer word still matches.
   Extras: "exact phrase", by:name, host:name, year:2025, and #search/your+words links. */
const Search = (() => {
  const norm = s => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const squash = s => norm(s).replace(/ /g, "");
  // Other names people type → a word that appears in the usual name.
  const ALIAS = {
    rozin: "rosin", r0sin: "rosin", r0s1nz: "rosin", roz: "rosin", rossito: "rosin", aaron: "rosin",
    cosmonaut: "cyber", kosmonaut: "cyber", spaceman: "cyber", cyberspace: "cyber",
    tomman: "servo", tom: "servo", drtom: "servo", servo: "servo",
    ira: "iregretjumping", jumping: "iregretjumping", governor: "iregretjumping",
    dogs: "despicabledogs", dd: "despicabledogs", ddogs: "despicabledogs", despicable: "despicabledogs",
    ant: "anteatertpose", anteater: "anteatertpose", tpose: "anteatertpose", anty: "anteatertpose",
    imp: "greenimp", quackers: "greenimp", bucees: "bucee", bucee: "bucee", lally: "lallybirdie", birdie: "lallybirdie",
    wildone: "wildone", wild: "wildone", ned: "neddy", hellraiser: "neddy", andy: "andyanderson", drake: "dragsaw",
    criefaux: "criefaux", crie: "criefaux", cryfawkes: "criefaux", deltron: "deltron3000", starry: "starry", stacy: "starry"
  };
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  let index = null, type = "all", year = "", sortBy = "best", limit = 40, last = "";

  /* ---------- the index ---------- */
  function dateWords(d) {
    if (!d) return ""; const [y, m, dd] = d.split("-").map(Number);
    return `${y} ${MONTHS[m - 1]} ${MONTHS[m - 1].slice(0, 3)} ${m}/${dd} ${m}/${dd}/${String(y).slice(2)} ${m}-${dd}`;
  }
  function build() {
    const R = [], eps = Object.fromEntries(C.episodes.map(e => [e.id, e]));
    for (const e of C.episodes) {
      const info = C.calls[e.id], calls = info ? callsFor(e.id, e.sec).filter(c => !c.skip) : [];
      R.push({ type: "show", ep: e.id, d: e.d, title: niceTitle(e), host: e.h || "", desc: info?.desc || e.n || "", n: calls.length,
        callers: [...new Set(calls.map(c => c.by))], text: `${niceTitle(e)} ${e.h || ""} ${info?.desc || e.n || ""} ${dateWords(e.d)}` });
      for (const c of calls) R.push({ type: "call", ep: e.id, d: e.d, t: c.t, end: c.end, by: c.by, title: c.title || "", community: !!c.community, host: e.h || "", text: `${c.by} ${c.title || ""}` });
    }
    for (const k of (typeof Board !== "undefined" ? Board.list : [])) {
      const e = eps[k.ep]; R.push({ type: "clip", id: k.id, ep: k.ep, at: k.at, d: e?.d || "", title: k.title, by: k.by || "", sec: k.sec, text: `${k.title} ${k.by || ""} ${e ? niceTitle(e) : ""}` });
    }
    for (const k of C.clips) R.push({ type: "drop", k: k.k, by: k.who, title: k.line, d: "", text: `${k.who} ${k.line}` });
    for (const r of R) { r.n_ = norm(r.text); r.s_ = r.n_.replace(/ /g, ""); r.w_ = r.n_.split(" "); r.who_ = squash(r.by || r.host || ""); }
    index = R;
  }
  /* ---------- matching ---------- */
  function lev1(a, b) { // true if a and b are at most one edit apart
    if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
    return d + (a.length - i) + (b.length - j) <= 1;
  }
  function parse(q) {
    const f = { terms: [], phrases: [], by: "", host: "", year: "", type: "", untitled: false };
    q = q.replace(/"([^"]+)"/g, (_, p) => { const n = norm(p); if (n) f.phrases.push(n); return " "; });
    for (const raw of q.split(/\s+/).filter(Boolean)) {
      if (/^(is:)?untitled$/i.test(raw) || /^is:(notitle|missing)$/i.test(raw)) { f.untitled = true; f.type = "call"; continue; }
      const m = raw.match(/^(by|host|year|in|from):(.+)$/i);
      if (m) { const k = m[1].toLowerCase(), v = m[2]; if (k === "by" || k === "from") f.by = squash(v); else if (k === "host") f.host = squash(v); else if (k === "year") f.year = v.slice(0, 4); else f.type = v.toLowerCase().replace(/s$/, ""); continue; }
      if (/^(19|20)\d\d$/.test(raw)) { f.year = raw; continue; }
      const t = squash(raw); if (t) f.terms.push(t);
    }
    // Two words that make one known name ("tom man", "green imp", "wild one") count as one word.
    for (let i = 0; i < f.terms.length - 1; i++) { const two = f.terms[i] + f.terms[i + 1];
      if (ALIAS[two] || index?.some(r => r.who_ && r.who_.startsWith(two))) { f.terms.splice(i, 2, two); i--; } }
    return f;
  }
  function termScore(r, t) {
    const a = ALIAS[t], cands = a && a !== t ? [t, a] : [t]; let best = 0;
    for (const x of cands) {
      const boost = x === t ? 1 : .9;
      if (r.who_ && r.who_.includes(x)) best = Math.max(best, (r.who_ === x ? 6 : 4) * boost);
      if (r.w_.includes(x)) best = Math.max(best, 3 * boost);
      else if (r.w_.some(w => w.startsWith(x))) best = Math.max(best, 2.2 * boost);
      else if (x.length >= 3 && r.s_.includes(x)) best = Math.max(best, 1.6 * boost);
      else if (x.length >= 5 && r.w_.some(w => w.length >= 4 && lev1(w, x))) best = Math.max(best, 1 * boost);
    }
    return best;
  }
  function run(q) {
    const f = parse(q), want = f.type || (type === "all" ? "" : type), yr = f.year || year;
    const pool = index;
    const hits = [];
    for (const r of pool) {
      if (want && r.type !== want) continue;
      if (yr && !(r.d || "").startsWith(yr)) continue;
      if (f.by && !(r.who_ || "").includes(ALIAS[f.by] || f.by)) continue;
      if (f.host && !squash(r.host || "").includes(ALIAS[f.host] || f.host)) continue;
      if (f.untitled && (r.type !== "call" || r.title)) continue;
      let s = 0, ok = true;
      for (const p of f.phrases) { if (r.n_.includes(p)) s += 4; else { ok = false; break; } }
      if (!ok) continue;
      for (const t of f.terms) { const v = termScore(r, t); if (!v) { ok = false; break; } s += v; }
      if (!ok) continue;
      if (!f.terms.length && !f.phrases.length && !f.by && !f.host && !yr && !f.untitled) continue;
      s += { call: .4, show: .3, clip: .5, drop: .1, chat: 0 }[r.type] || 0;
      hits.push({ r, s });
    }
    const byDate = (a, b) => (b.r.d || "").localeCompare(a.r.d || "") || (a.r.t || 0) - (b.r.t || 0);
    if (sortBy === "new") hits.sort(byDate); else if (sortBy === "old") hits.sort((a, b) => -byDate(a, b)); else hits.sort((a, b) => b.s - a.s || byDate(a, b));
    return { f, hits };
  }

  /* ---------- who is this? ---------- */
  function callerCard(f) {
    const keys = [f.by, ...f.terms].filter(Boolean); if (!keys.length) return "";
    const calls = index.filter(r => r.type === "call"), names = new Map();
    for (const c of calls) names.set(c.by, (names.get(c.by) || 0) + 1);
    let who = null;
    for (const k of keys) { const x = ALIAS[k] || k; const hit = [...names.keys()].filter(n => squash(n) === x || (x.length >= 3 && squash(n).includes(x))).sort((a, b) => names.get(b) - names.get(a))[0]; if (hit) { who = hit; break; } }
    if (!who) return "";
    const mine = calls.filter(c => c.by === who), shows = new Set(mine.map(c => c.ep)), dates = mine.map(c => c.d).filter(Boolean).sort();
    const hosted = C.episodes.filter(e => e.h && squash(e.h) === squash(who)).length, titled = mine.filter(c => c.title).length;
    const years = {}; for (const c of mine) { const y = (c.d || "").slice(0, 4); if (y) years[y] = (years[y] || 0) + 1; }
    return `<div class="s-who hud"><div><small>Caller</small><b>${esc(who)}</b></div>
      <dl><div><dt>Turns</dt><dd>${mine.length}</dd></div><div><dt>Shows</dt><dd>${shows.size}</dd></div>${hosted ? `<div><dt>Hosted</dt><dd>${hosted}</dd></div>` : ""}
      <div><dt>First</dt><dd>${esc(fmtDate(dates[0]))}</dd></div><div><dt>Latest</dt><dd>${esc(fmtDate(dates[dates.length - 1]))}</dd></div>
      <div><dt>By year</dt><dd>${Object.entries(years).sort().map(([y, n]) => `${y}: ${n}`).join(" · ")}</dd></div></dl>
      <button class="btn sm" type="button" data-sq="by:${esc(who.replace(/\s+/g, ""))}">All ${mine.length} of their calls</button>
      ${titled < mine.length ? `<p class="ext">${titled ? `${titled} of ${mine.length} ${titled === 1 ? "has a title" : "have titles"} so far.` : "No titles yet for these. The crew can add them on the Replay page."}</p>` : ""}</div>`;
  }

  /* ---------- drawing ---------- */
  function mark(s, f) {
    let out = esc(s); const words = [...f.terms.map(t => ALIAS[t] || t), ...f.phrases].filter(w => w.length >= 2).sort((a, b) => b.length - a.length);
    if (!words.length) return out;
    const re = new RegExp(`(${words.map(w => w.split("").map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9<>&]*")).join("|")})`, "gi");
    return out.replace(/(^|>)([^<]*)/g, (m, a, txt) => a + txt.replace(re, "<mark>$1</mark>"));
  }
  const when = r => r.d ? esc(fmtDate(r.d)) : "";
  function row(h, f) {
    const r = h.r, rec = r.ep && isRecent(r.ep);
    if (r.type === "call") return `<li class="s-row call"><span class="s-k">Call</span><div class="s-main"><b>${mark(r.by, f)}</b>${r.title ? `<em>${mark(r.title, f)}${r.community ? ` <i class="cm">community</i>` : ""}</em>` : rec ? `<em class="s-untitled">No title yet. Heard it? ▶ Play, then tap 💡+ to name it.</em>` : ""}<small>${when(r)}${r.host ? ` · hosted by ${esc(r.host)}` : ""} · at ${hms(r.t, true)} · ${fmtLen(r.end - r.t)}</small></div>
      <div class="s-acts">${rec ? `<button class="btn sm" type="button" data-play="${r.ep}" data-t="${r.t}">▶ Play</button><button class="btn sm ghost" type="button" data-clip="${r.ep}" data-t="${r.t}" data-end="${r.end}" data-name="${esc(callLabel(r))}">✂</button>` : `<a class="btn sm ghost" href="${PC_POST}${r.ep}" target="_blank" rel="noopener" title="Jump to ${hms(r.t, true)} on Prankcast">Prankcast ↗</a>`}</div></li>`;
    if (r.type === "show") return `<li class="s-row show"><span class="s-k">Show</span><div class="s-main"><b>${mark(r.title, f)}</b>${r.desc ? `<em>${mark(r.desc, f)}</em>` : ""}<small>${when(r)}${r.host ? ` · hosted by ${mark(r.host, f)}` : ""}${r.n ? ` · ${r.n} calls` : ""}</small>${r.callers.length ? `<small class="s-callers">${r.callers.map(n => `<button type="button" data-sq="by:${esc(n.replace(/\s+/g, ""))}">${mark(n, f)}</button>`).join("")}</small>` : ""}</div>
      <div class="s-acts">${rec ? `<button class="btn sm" type="button" data-show="${r.ep}">▶ Play here</button>` : `<a class="btn sm ghost" href="${PC_POST}${r.ep}" target="_blank" rel="noopener">Prankcast ↗</a>`}</div></li>`;
    if (r.type === "clip") return `<li class="s-row clip"><span class="s-k">Clip</span><div class="s-main"><b>${mark(r.title, f)}</b><small>clipped by ${mark(r.by || "anonymous", f)}${r.d ? ` · from ${when(r)}` : ""}</small></div><div class="s-acts"><button class="btn sm" type="button" data-cb="${esc(r.id)}">▶ Play</button></div></li>`;
    if (r.type === "drop") return `<li class="s-row drop"><span class="s-k">Drop</span><div class="s-main"><b>${mark(r.title, f)}</b><small>${mark(r.by, f)} · patch bay</small></div><div class="s-acts"><button class="btn sm" type="button" data-drop="${esc(r.k)}">▶</button></div></li>`;
    return "";
  }
  const LABEL = { call: "Calls", show: "Shows", clip: "Clips", drop: "Drops", };
  function render() {
    const q = $("sq").value.trim(); if (!index) build();
    try { history.replaceState(null, "", "#search" + (q ? "/" + encodeURIComponent(q) : "")); } catch (e) {}
    if (!q && !year) { $("s-res").innerHTML = ""; $("s-count").textContent = ""; $("s-who-box").innerHTML = ""; $("s-more").hidden = true; return; }
    const { f, hits } = run(q);
    $("s-who-box").innerHTML = type === "all" || type === "call" ? callerCard(f) : "";
    const counts = {}; for (const h of hits) counts[h.r.type] = (counts[h.r.type] || 0) + 1;
    $("s-types").querySelectorAll("[data-type]").forEach(b => { const k = b.dataset.type; b.querySelector("i").textContent = k === "all" ? (hits.length || "") : (counts[k] || ""); });
    $("s-count").textContent = hits.length ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : "";
    if (!hits.length) {
      $("s-res").innerHTML = `<p class="feed-empty">Nothing for that. Try fewer words, part of a name, or another year.</p>`; $("s-more").hidden = true; return;
    }
    if (type === "all" && !f.type) {
      const groups = ["call", "show", "clip", "drop"].filter(k => counts[k]);
      $("s-res").innerHTML = groups.map(k => { const L = hits.filter(h => h.r.type === k);
        return `<h3 class="s-h">${LABEL[k]} <span>${L.length}</span></h3><ol class="s-list">${L.slice(0, 8).map(h => row(h, f)).join("")}</ol>${L.length > 8 ? `<button class="btn sm ghost s-all" type="button" data-type-go="${k}">See all ${L.length} ${LABEL[k].toLowerCase()} →</button>` : ""}`; }).join("");
      $("s-more").hidden = true;
    } else {
      $("s-res").innerHTML = `<ol class="s-list">${hits.slice(0, limit).map(h => row(h, f)).join("")}</ol>`;
      $("s-more").hidden = hits.length <= limit; $("s-more").textContent = `Show more (${hits.length - limit} left)`;
    }
  }
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { limit = 40; render(); }, 140); };
  function setType(k) { type = k; limit = 40; $("s-types").querySelectorAll("[data-type]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === k))); render(); }

  function init() {
    $("sq").addEventListener("input", later);
    $("sq").addEventListener("keydown", e => { if (e.key === "Escape") { $("sq").value = ""; render(); } });
    $("s-types").addEventListener("click", e => { const b = e.target.closest("[data-type]"); if (b) setType(b.dataset.type); });
    $("s-years").addEventListener("click", e => { const b = e.target.closest("[data-year]"); if (!b) return; year = year === b.dataset.year ? "" : b.dataset.year; $("s-years").querySelectorAll("[data-year]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.year === year))); render(); });
    $("s-sort").addEventListener("change", e => { sortBy = e.target.value; render(); });
    $("s-more").addEventListener("click", () => { limit += 60; render(); });
    $("page-search").addEventListener("click", e => {
      const sq = e.target.closest("[data-sq]"); if (sq) { $("sq").value = sq.dataset.sq; setType("call"); window.scrollTo(0, 0); return; }
      const tg = e.target.closest("[data-type-go]"); if (tg) { setType(tg.dataset.typeGo); window.scrollTo(0, 0); return; }
      const ex = e.target.closest("[data-ex]"); if (ex) { $("sq").value = ex.dataset.ex; render(); return; }
      const p = e.target.closest("[data-play]"); if (p) { Replay.loadAt(+p.dataset.play, +p.dataset.t, true); return; }
      const cl = e.target.closest("[data-clip]"); if (cl) { Replay.clipRange(+cl.dataset.clip, +cl.dataset.t, +cl.dataset.end, cl.dataset.name); return; }
      const s = e.target.closest("[data-show]"); if (s) { Replay.load(+s.dataset.show); return; }
      const cb = e.target.closest("[data-cb]"); if (cb) { Board.play(cb.dataset.cb); return; }
      const d = e.target.closest("[data-drop]"); if (d) playClip(d.dataset.drop);
    });
    const years = [...new Set(C.episodes.map(e => (e.d || "").slice(0, 4)).filter(Boolean))].sort();
    $("s-years").innerHTML = `<span>Year:</span>` + years.map(y => `<button class="yp-chip" type="button" data-year="${y}" aria-pressed="false">${y}</button>`).join("");
    const rebuild = () => { index = null; if (Router.page === "search") render(); };
    document.addEventListener("episodes-changed", rebuild); document.addEventListener("calls-changed", rebuild); document.addEventListener("board-changed", rebuild);
    document.addEventListener("page", e => { if (e.detail === "search") { fromHash(); setTimeout(() => $("sq").focus(), 50); } });
    // "/" jumps to search from anywhere (unless you're typing somewhere).
    document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); go("search"); } });
    if (Router.page === "search") fromHash();
  }
  function fromHash() { const m = location.hash.match(/^#search\/(.+)$/); const q = m ? decodeURIComponent(m[1]) : ""; if (q && q !== $("sq").value) $("sq").value = q; index = null; render(); }
  return { init };
})();
