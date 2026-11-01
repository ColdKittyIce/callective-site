/* Caller pages (audit I1, Nov 2026): #caller/<name> = everything one person has done on the phone, built from the call lists.
   #callers = everyone, busiest first. Names are matched loosely (case, spaces and emoji ignored), so "despicabledogs"
   and "DespicableDogs" are one person. Nothing here comes from the Discord chat. */
const Callers = (() => {
  const key = s => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  let idx = null;
  const NOT_A_PERSON_C = /^(all ?call|the host is|unknown caller|deleted user)/i; // same as Wrapped: queue names that were a bit, not a caller
  function build() {
    const M = new Map();
    const get = k => { if (!M.has(k)) M.set(k, { k, names: new Map(), calls: [], hosted: [] }); return M.get(k); };
    // one episode per night (some shows were uploaded twice): the one with a call list and a host wins, like Wrapped
    const by = new Map(), score = x => (C.calls[x.id] ? 2 : 0) + (x.h ? 1 : 0) + (isRecent(x.id) ? .5 : 0);
    for (const e of C.episodes) { const n = e.d || e.id, cur = by.get(n); if (!cur || score(e) > score(cur)) by.set(n, e); }
    for (const e of by.values()) {
      if (!C.calls[e.id]) continue;
      for (const c of callsFor(e.id, e.sec)) { if (c.skip || !c.by || NOT_A_PERSON_C.test(c.by)) continue; const k = key(c.by); if (!k) continue; const P = get(k); P.names.set(c.by, (P.names.get(c.by) || 0) + 1); P.calls.push({ ...c, ep: e.id, d: e.d, len: Math.max(0, c.end - c.t) }); }
    }
    const seenNight = new Set();
    for (const e of C.episodes) { if (!e.h) continue; const k = key(e.h); if (!M.has(k)) continue; const night = k + "|" + (e.d || e.id); if (seenNight.has(night)) continue; seenNight.add(night); M.get(k).hosted.push(e); }
    for (const P of M.values()) { P.name = [...P.names].sort((a, b) => b[1] - a[1])[0][0]; P.calls.sort((a, b) => (b.d || "").localeCompare(a.d || "") || b.t - a.t); }
    idx = M; return M;
  }
  const index = () => idx || build();
  const link = name => { const k = key(name); return k && index().has(k) ? `<a class="who-link" href="#caller/${encodeURIComponent(k)}">${esc(name)}</a>` : esc(name); };
  const nights = P => new Set(P.calls.map(c => c.d || c.ep)).size;

  function page(k) {
    const P = index().get(k), box = $("cl-body");
    if (!P) { box.innerHTML = `<p class="feed-empty">No calls on file for that name. <a href="#callers">See everyone who's called</a> or <a href="#search">search</a>.</p>`; return; }
    const L = P.calls, first = L[L.length - 1], latest = L[0], longest = [...L].sort((a, b) => b.len - a.len)[0];
    const total = L.reduce((s, c) => s + c.len, 0), titled = L.filter(c => c.title).length;
    const years = {}; for (const c of L) { const y = (c.d || "").slice(0, 4); if (y) years[y] = (years[y] || 0) + 1; }
    const epOf = id => C.episodes.find(e => e.id === id);
    const callRow = c => { const e = epOf(c.ep), rec = isRecent(c.ep);
      const act = rec ? `<button class="btn sm" type="button" data-go="${c.ep}|${c.t}">▶ Play</button><button class="btn sm ghost" type="button" data-clip="${c.ep}|${c.t}|${c.end}|${esc(callLabel(c))}">✂ Clip</button>`
        : `<a class="btn sm" href="${PC_POST}${c.ep}?t=${Math.round(c.t)}" target="_blank" rel="noopener">▶ Prankcast ↗</a>`;
      return `<li class="cl-call"><div class="cl-when"><a href="#show/${c.ep}">${esc(fmtDate(c.d))}</a><small>${e && e.h ? `hosted by ${esc(e.h)}` : ""}</small></div>
        <div class="cl-what">${c.title ? `<b>${esc(c.title)}</b>${c.community ? ` <i class="cm">community</i>` : ""}` : `<span class="sp-untitled">No title yet</span>`}<small>at ${hms(c.t, true)} · ${fmtLen(c.len)}</small></div>
        <span class="cl-act">${act}<button class="btn sm ghost" type="button" data-moment="${c.ep}|${c.t}" title="Copy a link straight to this call">🔗</button></span></li>`; };
    // clip board clips cut from their calls, and their crew drops
    const clips = (typeof Board !== "undefined" ? Board.list : []).filter(x => x.ep != null && x.at != null && L.some(c => c.ep === x.ep && x.at >= c.t - 5 && x.at < c.end));
    const drops = C.clips.filter(x => key(x.who) === k);
    box.innerHTML = `
      <nav class="sp-nav"><a href="#callers">← Everyone who's called</a><span><a href="#search/${encodeURIComponent("by:" + P.name.replace(/\s+/g, ""))}">Search their calls</a></span></nav>
      <div class="sp-head hud cl-head">
        <p class="kicker">Caller file</p>
        <h2>${esc(P.name)}</h2>
        <div class="cl-stats">
          <div><b>${L.length}</b><span>calls</span></div>
          <div><b>${nights(P)}</b><span>show nights</span></div>
          <div><b>${fmtLen(total)}</b><span>on the phone</span></div>
          ${P.hosted.length ? `<div><b>${P.hosted.length}</b><span>shows hosted</span></div>` : ""}
          <div><b>${esc(fmtDate(first.d))}</b><span>first call</span></div>
          <div><b>${esc(fmtDate(latest.d))}</b><span>latest call</span></div>
        </div>
        <p class="cl-line">Longest call: <a href="#show/${longest.ep}">${fmtLen(longest.len)} on ${esc(fmtDate(longest.d))}</a>${longest.title ? `, “${esc(longest.title)}”` : ""}. By year: ${Object.entries(years).sort().map(([y, n]) => `${y}: ${n}`).join(" · ")}.${titled < L.length ? ` ${L.length - titled} of their calls still need a title.` : ""}</p>
        <div class="sp-acts"><button class="btn sm ghost" type="button" id="cl-share">🔗 Copy link to this page</button></div>
      </div>
      ${drops.length ? `<h3 class="cl-h">Their drops</h3><div class="cl-drops">${drops.map(x => `<button class="btn sm" type="button" data-drop="${esc(x.k)}">▶ ${esc(x.line)}</button>`).join("")}</div>` : ""}
      ${clips.length ? `<h3 class="cl-h">Clips from their calls</h3><ul class="cl-clips">${clips.map(x => `<li><a href="#clips">${esc(x.title)}</a><small>${esc(fmtDate(epOf(x.ep)?.d))}</small></li>`).join("")}</ul>` : ""}
      ${P.hosted.length ? `<h3 class="cl-h">Shows they hosted</h3><ul class="cl-clips">${P.hosted.map(e => `<li><a href="#show/${e.id}">${esc(niceTitle(e))}</a><small>${esc(fmtDate(e.d))}</small></li>`).join("")}</ul>` : ""}
      <h3 class="cl-h">Every call, newest first</h3>
      <ol class="cl-calls">${L.map(callRow).join("")}</ol>`;
  }
  function list() {
    const q = ($("cls-q")?.value || "").trim().toLowerCase(), all = [...index().values()].sort((a, b) => b.calls.length - a.calls.length || a.name.localeCompare(b.name));
    const L = q ? all.filter(P => [...P.names.keys()].some(n => n.toLowerCase().includes(q)) || P.k.includes(key(q))) : all;
    $("cls-list").innerHTML = L.map(P => `<li><a href="#caller/${encodeURIComponent(P.k)}"><b>${esc(P.name)}</b><span>${P.calls.length} call${P.calls.length === 1 ? "" : "s"} · since ${esc(fmtDate(P.calls[P.calls.length - 1].d))}</span></a></li>`).join("") || `<li class="feed-empty">Nobody by that name.</li>`;
    $("cls-count").textContent = `${L.length} callers`;
  }
  function fromHash() {
    const m = location.hash.match(/^#caller\/([^/?]+)/), all = /^#callers\b/.test(location.hash);
    if (!m && !all) return;
    $("cl-body").hidden = !m; $("cls-box").hidden = !!m;
    if (m) page(decodeURIComponent(m[1])); else list();
    window.scrollTo(0, 0);
  }
  function init() {
    $("cl-body").addEventListener("click", async e => {
      const g = e.target.closest("[data-go]"); if (g) { const [id, t] = g.dataset.go.split("|").map(Number); Replay.loadAt(id, t, true); return; }
      const c = e.target.closest("[data-clip]"); if (c) { const [id, t, end, ...n] = c.dataset.clip.split("|"); Replay.clipRange(+id, +t, +end, n.join("|")); return; }
      const mo = e.target.closest("[data-moment]"); if (mo) { const [id, t] = mo.dataset.moment.split("|").map(Number), u = momentUrl(id, t), ok = await copyText(u); toast(ok ? `Link copied: opens at ${hms(t, true)}` : u); return; }
      const d = e.target.closest("[data-drop]"); if (d) { const a = new Audio(`clips/${d.dataset.drop}.mp3`); Media.claim(a); a.play().catch(() => {}); return; }
      if (e.target.closest("#cl-share")) { const ok = await copyText(location.href); toast(ok ? "Link copied." : location.href); }
    });
    $("cls-q").addEventListener("input", list);
    document.addEventListener("calls-changed", () => { idx = null; if (Router.page === "caller") fromHash(); });
    document.addEventListener("episodes-changed", () => { idx = null; });
    addEventListener("hashchange", fromHash); fromHash();
  }
  return { init, link, key, get index() { return index(); } };
})();
