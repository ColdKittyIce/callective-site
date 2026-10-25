/* Clip board: community clips cut from the archive, approved by the crew. Plus the crew's mod panel (dial M-O-D). */
const Board = (() => {
  let clips = [], sort = "new", demo = false, cur = null;
  const aud = () => $("cbaud");

  function wave(peaks) { return `<span class="cb-wave" aria-hidden="true">${[...(peaks || "")].map(d => `<i style="height:${10 + (+d) * 9}%"></i>`).join("")}</span>`; }
  function epInfo(id) { const e = C.episodes.find(x => x.id === id); return e ? `${fmtDate(e.d)}${e.h ? " · " + e.h : ""}` : ""; }

  function card(c) {
    const from = `From ${esc(epInfo(c.ep) || "the archive")}${c.at != null ? ` at ${hms(c.at, true)}` : ""} ↗`;
    const src = c.ep ? (isRecent(c.ep) ? `<button class="cb-src" type="button" data-goto="${c.ep}" data-at="${c.at || 0}">${from}</button>` : `<a class="cb-src" href="${PC_POST}${c.ep}" target="_blank" rel="noopener">${from}</a>`) : "";
    return `<article class="cb-card hud${cur === c.id ? " playing" : ""}" data-id="${esc(c.id)}">
      <button class="cb-play" type="button" data-cbplay="${esc(c.id)}" aria-label="Play ${esc(c.title)}"><span class="tri" aria-hidden="true"></span></button>
      <div class="cb-body"><b>${esc(c.title)}</b><span class="cb-by">clipped by ${esc(c.by || "an anonymous caller")} · ${(+c.sec || 0) >= 60 ? `${Math.floor(c.sec / 60)}m ${Math.round(c.sec % 60)}s` : (+c.sec || 0).toFixed(1) + "s"}${c.live ? " · from a live show" : ""}</span>${wave(c.peaks)}${src}</div>
      <div class="cb-acts">${(+c.sec || 0) <= 122 ? `<button class="btn sm ghost cb-remix" type="button" data-remix="${esc(c.id)}">Remix</button>` : ""}<button class="cb-rep" type="button" data-report="${esc(c.id)}" title="Report this clip">⚑ Report</button><a class="btn sm ghost" href="${dlUrl(c)}" download="callective-${esc(String(c.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50))}.mp3">Download</a></div></article>`;
  }
  function render() {
    const q = $("cb-q").value.trim().toLowerCase();
    let L = clips.filter(c => !q || `${c.title} ${c.by} ${epInfo(c.ep)}`.toLowerCase().includes(q));
    if (sort === "new") L.sort((a, b) => (b.created || 0) - (a.created || 0));
    if (sort === "short") L.sort((a, b) => a.sec - b.sec);
    if (sort === "show") L.sort((a, b) => (b.ep || 0) - (a.ep || 0) || (a.at || 0) - (b.at || 0));
    $("cbgrid").innerHTML = L.map(card).join("") || `<p class="feed-empty">${clips.length ? "No clips match that." : "No clips yet. Be the first: tune in to the radio and hit ✂ Clip it."}</p>`;
  }
  const url = c => demo ? `clips/${c.id}.mp3` : `${C.api}/clips/${encodeURIComponent(c.id)}.mp3`;
  const dlUrl = c => demo ? url(c) : url(c) + "?dl=1";
  function play(id) {
    const c = clips.find(x => x.id === id); if (!c) return;
    if (cur === id && !aud().paused) { aud().pause(); return; }
    cur = id; aud().src = url(c); Media.claim(aud()); aud().play().catch(() => toast("That clip wouldn't play."));
    Player.set({ kind: "clip", el: aud(), title: c.title, page: "clips", seek: true, clip: () => Player.clipFrom(aud(), url(c), c.title, 60) });
    document.querySelectorAll(".cb-card").forEach(el => el.classList.toggle("playing", el.dataset.id === id));
  }
  async function load() {
    if (C.api) {
      try { const r = await getJSON(`${C.api}/clips`, 8000); clips = (r.clips || []); demo = false;
        $("cb-note").textContent = clips.length ? `${clips.length} clips on the board.` : "";
      } catch (e) { $("cb-note").textContent = "The clip board didn't load. Refresh to try again."; }
    } else {
      demo = true;
      clips = C.clips.slice(0, 9).map((c, i) => ({ id: c.k, title: c.line.replace(/[.”“]$/g, ""), by: "example", sec: c.sec, peaks: "3579864257986532468975324689", created: 9 - i }));
      $("cb-note").textContent = "These are examples from the patch bay. On the live site, this board fills with clips people send in.";
    }
    render(); document.dispatchEvent(new CustomEvent("board-changed"));
  }
  function init() {
    $("cb-q").addEventListener("input", render);
    $("cb-sort").addEventListener("click", e => { const b = e.target.closest("[data-sort]"); if (!b) return; sort = b.dataset.sort; $("cb-sort").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render(); });
    $("cbgrid").addEventListener("click", e => {
      const p = e.target.closest("[data-cbplay]"); if (p) { play(p.dataset.cbplay); return; }
      const g = e.target.closest("[data-goto]"); if (g) { Replay.loadAt(+g.dataset.goto, +g.dataset.at || 0); return; }
      const rp = e.target.closest("[data-report]");
      if (rp) { if (demo) { toast("Reporting works on the live site."); return; } if (!confirm("Report this clip to the crew?")) return;
        fetch(`${C.api}/clips/${encodeURIComponent(rp.dataset.report)}/report`, { method: "POST" }).then(() => { toast("Thanks. The crew will take a look."); rp.disabled = true; rp.textContent = "Reported"; }).catch(() => toast("That didn't go through.")); return; }
      const r = e.target.closest("[data-remix]"); if (r) { const c = clips.find(x => x.id === r.dataset.remix); if (c) { Lab.loadUrl(url(c), c.title); go("lab"); } }
    });
    const a = aud(); a.addEventListener("ended", () => { cur = null; render(); });
    load();
  }
  return { init, reload: load, play, get list() { return demo ? [] : clips; } };
})();

/* ---------- crew mod panel ---------- */
const Mod = (() => {
  let token = ""; try { token = sessionStorage.getItem("cx-mod") || ""; } catch (e) {}
  const hdr = () => ({ authorization: `Bearer ${token}` });
  let blobs = [];
  function open() {
    if (!C.api) { openTakeover(`<div class="card" style="padding:22px;max-width:520px;display:flex;flex-direction:column;gap:12px"><b class="mod-h">CREW LOGIN</b><p>The mod panel works on the live site. Dial it there.</p><button class="btn" type="button" data-close>Hang up</button></div>`); return; }
    openTakeover(`<div class="card mod" style="padding:20px;width:min(860px,100%);max-height:86vh;overflow:auto;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><b class="mod-h">CREW LOGIN // INBOX</b><button class="btn sm ghost" type="button" data-close>Hang up</button></div>
      <form id="mod-login" style="display:flex;gap:8px;flex-wrap:wrap"><label class="sr" for="mod-tok">Crew password</label><input id="mod-tok" class="lab-in" type="password" placeholder="Crew password" value="${esc(token)}" style="flex:1;min-width:0"><button class="btn sm" type="submit">Load the queue</button></form>
      <div id="mod-list" class="mod-list"><p class="ext">Enter the crew password to see clips sent to the crew and clips waiting for the board.</p></div></div>`);
    $("mod-login").addEventListener("submit", e => { e.preventDefault(); token = $("mod-tok").value.trim(); try { sessionStorage.setItem("cx-mod", token); } catch (err) {} list(); });
    $("mod-list").addEventListener("click", act);
    if (token) list();
  }
  const row = (c, kind) => {
    const crew = c.dest === "crew", tag = kind === "pub" ? "On the board" : crew ? "Sent to the crew" : `Held${c.flag ? ": " + c.flag : ""}`;
    const len = (+c.sec || 0) >= 60 ? `${Math.floor(c.sec / 60)}m ${Math.round(c.sec % 60)}s` : `${(+c.sec || 0).toFixed(1)}s`;
    const btns = kind === "pub" ? `<button class="btn sm red" type="button" data-mod="remove">Take down</button>`
      : `<button class="btn sm solid" type="button" data-mod="approve">${crew ? "Put on the board" : "Approve"}</button><button class="btn sm red" type="button" data-mod="reject">${crew ? "Delete" : "Reject"}</button>`;
    return `<div class="mod-row${crew ? " crew" : ""}${kind === "pub" ? " pub" : ""}" data-id="${esc(c.id)}"><div style="min-width:0"><span class="mod-tag">${esc(tag)}</span><b>${esc(c.title)}</b><span class="ext">${esc(c.by || "anonymous")} · ${len}${c.live ? " · live show" : c.ep ? ` · show ${c.ep} at ${hms(c.at || 0, true)}` : " · uploaded or remixed"}</span>${c.note ? `<p class="mod-note">“${esc(c.note)}”</p>` : ""}<div class="mod-play"><button class="btn sm" type="button" data-modplay="${esc(c.id)}" data-pub="${kind === "pub" ? 1 : ""}">▶ Listen</button><audio controls preload="none" hidden></audio></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${btns}<button class="btn sm" type="button" data-moddl="${esc(c.id)}" data-title="${esc(c.title)}" data-pub="${kind === "pub" ? 1 : ""}">Download</button></div></div>`;
  };
  async function list() {
    const box = $("mod-list"); box.innerHTML = `<p class="ext">Loading…</p>`; blobs.forEach(u => URL.revokeObjectURL(u)); blobs = [];
    try {
      const r = await fetch(`${C.api}/mod/pending`, { headers: hdr() }); if (r.status === 401) { box.innerHTML = `<p class="ext">Wrong password.</p>`; return; }
      const { clips } = await r.json(); const pub = (await (await fetch(`${C.api}/mod/public`, { headers: hdr() })).json()).clips || [];
      const held = clips.filter(c => c.dest !== "crew"), crew = clips.filter(c => c.dest === "crew");
      box.innerHTML = `<h4 class="mod-sec">Waiting for a look (${held.length})</h4>${held.map(c => row(c, "held")).join("") || `<p class="ext">Nothing held. Clean clips from shows post on their own.</p>`}
        <h4 class="mod-sec">Sent to the crew (${crew.length})</h4>${crew.map(c => row(c, "crew")).join("") || `<p class="ext">Nothing sent privately.</p>`}
        <h4 class="mod-sec">On the board (${pub.length})</h4>${pub.map(c => row(c, "pub")).join("") || `<p class="ext">The board is empty.</p>`}
        <h4 class="mod-sec">1998 guestbook</h4><div id="mod-gb"><p class="ext">Loading…</p></div>`;
      gbList();
    } catch (e) { box.innerHTML = `<p class="ext">Couldn't load the inbox.</p>`; }
  }
  async function gbList() {
    const box = $("mod-gb"); if (!box) return;
    try {
      const j = await (await fetch(`${C.api}/mod/guestbook`, { headers: hdr() })).json();
      const ent = (e, held) => `<div class="mod-row gb" data-gb="${esc(e.id)}"><div style="min-width:0"><span class="mod-tag">${held ? `Held${e.flag ? ": " + esc(e.flag) : ""}` : "Posted"}</span><b>${esc(e.n)}</b><p class="mod-note" style="color:var(--text)">${esc(e.m)}</p><span class="ext">${new Date(e.t).toLocaleString()}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${held ? `<button class="btn sm solid" type="button" data-gbact="approve">Approve</button>` : ""}<button class="btn sm red" type="button" data-gbact="delete">Delete</button></div></div>`;
      box.innerHTML = (j.held || []).map(e => ent(e, true)).join("") + ((j.pub || []).map(e => ent(e, false)).join("") || `<p class="ext">No entries yet.</p>`);
    } catch (e) { box.innerHTML = `<p class="ext">Couldn't load the guestbook.</p>`; }
  }
  async function act(e) {
    const ga = e.target.closest("[data-gbact]");
    if (ga) { const r0 = ga.closest("[data-gb]"); ga.disabled = true; const r = await fetch(`${C.api}/mod/gb/${encodeURIComponent(r0.dataset.gb)}/${ga.dataset.gbact}`, { method: "POST", headers: hdr() }); if (r.ok) { toast(ga.dataset.gbact === "approve" ? "Approved." : "Deleted."); gbList(); } else { ga.disabled = false; toast("That didn't go through."); } return; }
    // Clips waiting for a look need the crew password, which an <audio> tag can't send, so fetch the file first and play it from memory.
    const pl = e.target.closest("[data-modplay]");
    if (pl) { const el = pl.parentElement.querySelector("audio"); pl.disabled = true; pl.textContent = "Loading…";
      try { const r = await fetch(pl.dataset.pub ? `${C.api}/clips/${encodeURIComponent(pl.dataset.modplay)}.mp3` : `${C.api}/mod/clip/${encodeURIComponent(pl.dataset.modplay)}.mp3`, { headers: hdr() });
        if (!r.ok) throw new Error(r.status); const u = URL.createObjectURL(await r.blob()); blobs.push(u);
        el.src = u; el.hidden = false; pl.remove(); Media.claim(el); el.play().catch(() => {});
      } catch (err) { pl.disabled = false; pl.textContent = "▶ Listen"; toast("That clip didn't load. Try again."); }
      return; }
    const d = e.target.closest("[data-moddl]");
    if (d) { const r = await fetch(d.dataset.pub ? `${C.api}/clips/${encodeURIComponent(d.dataset.moddl)}.mp3` : `${C.api}/mod/clip/${encodeURIComponent(d.dataset.moddl)}.mp3`, { headers: hdr() }); const u = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = u; a.download = `callective-${d.dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.mp3`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return; }
    const b = e.target.closest("[data-mod]"); if (!b) return; const row = b.closest(".mod-row"), id = row.dataset.id;
    b.disabled = true;
    const r = await fetch(`${C.api}/mod/${encodeURIComponent(id)}/${b.dataset.mod}`, { method: "POST", headers: hdr() });
    if (r.ok) { row.remove(); toast(b.dataset.mod === "approve" ? "Approved. It's on the board." : b.dataset.mod === "remove" ? "Taken down." : "Rejected and removed."); Board.reload(); } else { b.disabled = false; toast("That didn't go through."); }
  }
  return { open };
})();
