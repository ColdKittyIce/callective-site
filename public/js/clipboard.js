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
      <div class="cb-body"><b>${esc(c.title)}</b><span class="cb-by">clipped by ${esc(c.by || "an anonymous caller")} · ${(+c.sec || 0).toFixed(1)}s${c.live ? " · from a live show" : ""}</span>${wave(c.peaks)}${src}</div>
      <div class="cb-acts"><button class="btn sm ghost cb-remix" type="button" data-remix="${esc(c.id)}">Remix</button><a class="btn sm ghost" href="${dlUrl(c)}" download="callective-${esc(String(c.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50))}.mp3">Download</a></div></article>`;
  }
  function render() {
    const q = $("cb-q").value.trim().toLowerCase();
    let L = clips.filter(c => !q || `${c.title} ${c.by} ${epInfo(c.ep)}`.toLowerCase().includes(q));
    if (sort === "new") L.sort((a, b) => (b.created || 0) - (a.created || 0));
    if (sort === "short") L.sort((a, b) => a.sec - b.sec);
    if (sort === "show") L.sort((a, b) => (b.ep || 0) - (a.ep || 0) || (a.at || 0) - (b.at || 0));
    $("cbgrid").innerHTML = L.map(card).join("") || `<p class="feed-empty">${clips.length ? "No clips match that." : "No clips yet. Be the first: tune in to the radio and hit Clip it."}</p>`;
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
    render();
  }
  function init() {
    $("cb-q").addEventListener("input", render);
    $("cb-sort").addEventListener("click", e => { const b = e.target.closest("[data-sort]"); if (!b) return; sort = b.dataset.sort; $("cb-sort").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render(); });
    $("cbgrid").addEventListener("click", e => {
      const p = e.target.closest("[data-cbplay]"); if (p) { play(p.dataset.cbplay); return; }
      const g = e.target.closest("[data-goto]"); if (g) { Replay.loadAt(+g.dataset.goto, +g.dataset.at || 0); return; }
      const r = e.target.closest("[data-remix]"); if (r) { const c = clips.find(x => x.id === r.dataset.remix); if (c) { Lab.loadUrl(url(c), c.title); go("lab"); } }
    });
    const a = aud(); a.addEventListener("ended", () => { cur = null; render(); });
    load();
  }
  return { init, reload: load };
})();

/* ---------- crew mod panel ---------- */
const Mod = (() => {
  let token = ""; try { token = sessionStorage.getItem("cx-mod") || ""; } catch (e) {}
  const hdr = () => ({ authorization: `Bearer ${token}` });
  let blobs = [];
  function open() {
    if (!C.api) { openTakeover(`<div class="card" style="padding:22px;max-width:520px;display:flex;flex-direction:column;gap:12px"><b class="mod-h">CREW LOGIN</b><p>The mod panel works on the live site. Dial it there.</p><button class="btn" type="button" data-close>Hang up</button></div>`); return; }
    openTakeover(`<div class="card mod" style="padding:20px;width:min(860px,100%);max-height:86vh;overflow:auto;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><b class="mod-h">CREW LOGIN // CLIP INBOX</b><button class="btn sm ghost" type="button" data-close>Hang up</button></div>
      <form id="mod-login" style="display:flex;gap:8px;flex-wrap:wrap"><label class="sr" for="mod-tok">Crew password</label><input id="mod-tok" class="lab-in" type="password" placeholder="Crew password" value="${esc(token)}" style="flex:1;min-width:0"><button class="btn sm" type="submit">Load the queue</button></form>
      <div id="mod-list" class="mod-list"><p class="ext">Enter the crew password to see clips sent to the crew and clips waiting for the board.</p></div></div>`);
    $("mod-login").addEventListener("submit", e => { e.preventDefault(); token = $("mod-tok").value.trim(); try { sessionStorage.setItem("cx-mod", token); } catch (err) {} list(); });
    $("mod-list").addEventListener("click", act);
    if (token) list();
  }
  async function list() {
    const box = $("mod-list"); box.innerHTML = `<p class="ext">Loading…</p>`; blobs.forEach(u => URL.revokeObjectURL(u)); blobs = [];
    try {
      const r = await fetch(`${C.api}/mod/pending`, { headers: hdr() }); if (r.status === 401) { box.innerHTML = `<p class="ext">Wrong password.</p>`; return; }
      const { clips } = await r.json();
      if (!clips.length) { box.innerHTML = `<p class="ext">Nothing in the inbox.</p>`; return; }
      box.innerHTML = clips.map(c => { const crew = c.dest === "crew";
        return `<div class="mod-row${crew ? " crew" : ""}" data-id="${esc(c.id)}"><div style="min-width:0"><span class="mod-tag">${crew ? "Sent to the crew" : "For the clip board"}</span><b>${esc(c.title)}</b><span class="ext">${esc(c.by || "anonymous")} · ${(+c.sec).toFixed(1)}s${c.live ? " · live show" : c.ep ? ` · show ${c.ep} at ${hms(c.at || 0, true)}` : " · uploaded or remixed"}</span>${c.note ? `<p class="mod-note">“${esc(c.note)}”</p>` : ""}<audio controls preload="none" data-src="${esc(c.id)}"></audio></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm solid" type="button" data-mod="approve">${crew ? "Put on the board" : "Approve"}</button><button class="btn sm" type="button" data-moddl="${esc(c.id)}" data-title="${esc(c.title)}">Download</button><button class="btn sm red" type="button" data-mod="reject">${crew ? "Delete" : "Reject"}</button></div></div>`; }).join("");
      for (const el of box.querySelectorAll("audio[data-src]")) {
        el.addEventListener("play", async () => { if (el.src) return; const r2 = await fetch(`${C.api}/mod/clip/${encodeURIComponent(el.dataset.src)}.mp3`, { headers: hdr() }); const u = URL.createObjectURL(await r2.blob()); blobs.push(u); el.src = u; el.play(); }, { once: true });
      }
    } catch (e) { box.innerHTML = `<p class="ext">Couldn't load the queue.</p>`; }
  }
  async function act(e) {
    const d = e.target.closest("[data-moddl]");
    if (d) { const r = await fetch(`${C.api}/mod/clip/${encodeURIComponent(d.dataset.moddl)}.mp3`, { headers: hdr() }); const u = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = u; a.download = `callective-${d.dataset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.mp3`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return; }
    const b = e.target.closest("[data-mod]"); if (!b) return; const row = b.closest(".mod-row"), id = row.dataset.id;
    b.disabled = true;
    const r = await fetch(`${C.api}/mod/${encodeURIComponent(id)}/${b.dataset.mod}`, { method: "POST", headers: hdr() });
    if (r.ok) { row.remove(); toast(b.dataset.mod === "approve" ? "Approved. It's on the board." : "Rejected and removed."); Board.reload(); } else { b.disabled = false; toast("That didn't go through."); }
  }
  return { open };
})();
