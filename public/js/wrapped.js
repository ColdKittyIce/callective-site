/* Callective Wrapped: a year in numbers, worked out in the browser from the show list and the call lists.
   Nothing here comes from chat text. Shows uploaded twice count once. A show's first and last turns
   include the intro and outro, so they're left out of "longest call". */
const Wrapped = (() => {
  let year = null;
  const NOT_A_PERSON = /^(all call|the host is|unknown caller|deleted user)/i; // queue names that were a bit, not a caller
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function nights(y) {
    const by = new Map();
    for (const e of C.episodes) { if (!e.d || !e.d.startsWith(y)) continue;
      const cur = by.get(e.d), score = x => (C.calls[x.id] ? 2 : 0) + (x.h ? 1 : 0);
      if (!cur || score(e) > score(cur)) by.set(e.d, e); }
    return [...by.values()].sort((a, b) => a.d.localeCompare(b.d));
  }
  function stats(y) {
    const N = nights(y), turns = [], perNight = [];
    for (const e of N) { const L = callsFor(e.id, e.sec).filter(c => !c.skip); perNight.push({ e, n: L.length });
      L.forEach((c, i) => { if (!NOT_A_PERSON.test(c.by)) turns.push({ ...c, e, mid: i > 0 && i < L.length - 1 }); }); }
    const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
    const callers = count(turns, t => t.by), hosts = count(N, e => e.h);
    // first-timers: no turn in any earlier year
    const before = new Set(); for (const e of C.episodes) if (e.d && e.d < `${y}-01-01` && C.calls[e.id]) for (const c of C.calls[e.id].calls) before.add(c.by);
    const firsts = [...new Set(turns.map(t => t.by))].filter(n => !before.has(n));
    // longest streak of shows in a row with a turn
    const withCalls = N.filter(e => C.calls[e.id]); let streak = { n: 0 };
    for (const [name] of callers.slice(0, 40)) { let run = 0, best = 0, end = null;
      for (const e of withCalls) { if (C.calls[e.id].calls.some(c => c.by === name && !c.skip)) { run++; if (run > best) { best = run; end = e; } } else run = 0; }
      if (best > streak.n) streak = { n: best, name, end }; }
    const longest = turns.filter(t => t.mid).sort((a, b) => (b.end - b.t) - (a.end - a.t))[0];
    const busiest = perNight.slice().sort((a, b) => b.n - a.n)[0];
    const longShow = N.slice().sort((a, b) => (b.sec || 0) - (a.sec || 0))[0];
    const months = new Array(12).fill(0); for (const t of turns) months[+t.e.d.slice(5, 7) - 1]++;
    const titled = turns.filter(t => t.title).length;
    return { N, turns, callers, hosts, firsts, streak, longest, busiest, longShow, months, titled, hours: N.reduce((s, e) => s + (e.sec || 0), 0) / 3600, listed: withCalls.length };
  }
  const tile = (big, small, cls = "") => `<div class="wr-tile ${cls}"><b>${big}</b><span>${small}</span></div>`;
  function render() {
    const S = stats(year), now = new Date().getFullYear() === +year;
    if (!S.N.length) { $("wr-body").innerHTML = `<p class="feed-empty">No shows on file for ${year}.</p>`; return; }
    const top = S.callers.slice(0, 10), max = top[0]?.[1] || 1, mmax = Math.max(1, ...S.months);
    $("wr-body").innerHTML = `
      <div class="wr-hero"><small>${now ? `${year} so far` : year}</small><b>${S.N.length} shows. ${S.turns.length.toLocaleString()} turns on the phone. Zero regrets.</b>
        <span>${Math.round(S.hours)} hours of Saturday nights you're never getting back, ${S.callers.length} different callers${S.firsts.length ? `, and ${S.firsts.length} of them made their first call this year` : ""}.</span></div>
      <div class="wr-tiles">
        ${S.longest ? tile(fmtLen(S.longest.end - S.longest.t), `Longest turn: <b>${esc(S.longest.by)}</b> on ${esc(fmtDate(S.longest.e.d))}${S.longest.title ? `, “${esc(S.longest.title)}”` : ""}. Somebody check on that roycipient.`, "pink") : ""}
        ${S.busiest?.n ? tile(S.busiest.n, `turns on the busiest night, ${esc(fmtDate(S.busiest.e.d))}${S.busiest.e.h ? `, hosted by ${esc(S.busiest.e.h)}` : ""}`) : ""}
        ${S.streak.n > 2 ? tile(S.streak.n, `shows in a row: <b>${esc(S.streak.name)}</b> never missed a turn. Does this person sleep?`, "volt") : ""}
        ${S.longShow ? tile(fmtLen(S.longShow.sec || 0), `Longest show: ${esc(fmtDate(S.longShow.d))}${S.longShow.h ? `, ${esc(S.longShow.h)}` : ""}`) : ""}
        ${S.hosts.length ? tile(S.hosts.length, `different hosts. Most shows: <b>${esc(S.hosts[0][0])}</b> (${S.hosts[0][1]})`, "cyan") : ""}
        ${tile(S.titled, `calls with a title so far. The rest are just vibes. <a href="#search/${encodeURIComponent("is:untitled " + year)}">Help name the rest →</a>`)}
      </div>
      <div class="wr-cols">
        <div class="wr-card hud"><h3>Phone hogs of the year</h3><ol class="wr-bars">${top.map(([n, v], i) => `<li><span class="wr-n">${i + 1}</span><button type="button" data-who="${esc(n)}">${esc(n)}</button><i style="width:${(v / max * 100).toFixed(1)}%"></i><em>${v}</em></li>`).join("")}</ol></div>
        <div class="wr-card hud"><h3>Turns by month</h3><div class="wr-months">${S.months.map((v, i) => `<div title="${MONTHS[i]}: ${v} turns"><i style="height:${(v / mmax * 100).toFixed(1)}%"></i><span>${MONTHS[i][0]}</span></div>`).join("")}</div>
          <h3 style="margin-top:18px">Hosts</h3><p class="wr-hosts">${S.hosts.map(([h, v]) => `<button type="button" data-host="${esc(h)}">${esc(h)} <em>${v}</em></button>`).join("")}</p></div>
      </div>
      ${S.firsts.length ? `<div class="wr-card hud wr-new"><h3>Popped their cherry in ${year}: first call ever</h3><p>${S.firsts.map(n => `<button type="button" data-who="${esc(n)}">${esc(n)}</button>`).join("")}</p></div>` : ""}
      <p class="ext">Counted from the show list and the Discord queue handoffs${S.listed < S.N.length ? ` (${S.listed} of ${S.N.length} shows have a call list; the rest predate the queue bot or didn't log turns)` : ""}. Shows uploaded twice count once.</p>`;
  }
  function setYear(y) { year = y; $("wr-years").querySelectorAll("[data-y]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.y === y))); render(); }
  function init() {
    const ys = [...new Set(C.episodes.map(e => (e.d || "").slice(0, 4)).filter(y => y >= "2025"))].sort();
    $("wr-years").innerHTML = ys.map(y => `<button class="yp-chip" type="button" data-y="${y}" aria-pressed="false">${y}</button>`).join("");
    $("wr-years").addEventListener("click", e => { const b = e.target.closest("[data-y]"); if (b) setYear(b.dataset.y); });
    $("wr-body").addEventListener("click", e => {
      const w = e.target.closest("[data-who]"); if (w) { location.hash = "search/" + encodeURIComponent(`by:${w.dataset.who.replace(/\s+/g, "")} ${year}`); return; }
      const h = e.target.closest("[data-host]"); if (h) location.hash = "search/" + encodeURIComponent(`host:${h.dataset.host.replace(/\s+/g, "")} ${year}`);
    });
    const m = location.hash.match(/^#wrapped\/(\d{4})/); setYear(m && ys.includes(m[1]) ? m[1] : ys[ys.length - 1]);
    document.addEventListener("calls-changed", () => year && render()); document.addEventListener("episodes-changed", () => year && render());
  }
  return { init };
})();
