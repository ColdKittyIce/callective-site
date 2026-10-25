/* One page per show (#show/<id>): title, date, host, blurb, the call order with timestamps and titles.
   Newest 10 shows play right here. Older ones open on Prankcast at the call: post links take ?t=<seconds>. */
const ShowPage = (() => {
  let id = null, open = null;
  function ideas(c) {
    const L = c.ideas || [];
    return `<div class="ideas sp-ideas" data-t="${c.t}">${L.length ? `<ol>${L.map(x => `<li><button type="button" class="idea-v" data-vote="${esc(x.id)}" title="+1 this title">▲ ${x.v}</button><span>${esc(x.title)}</span><button type="button" class="idea-r" data-rep="${esc(x.id)}" title="Report this one">⚑</button></li>`).join("")}</ol>` : `<p>No ideas yet. What was this call?</p>`}
      <form class="idea-f"><label class="sr" for="sp-idea-in">Suggest a title</label><input id="sp-idea-in" maxlength="80" placeholder="Suggest a title" autocomplete="off"><button class="btn sm" type="submit">Suggest</button></form>
      <small>One vote per person per call. No phone numbers, links or slurs. The crew can still change any title.</small></div>`;
  }
  async function ideaAct(t, action, extra) { try { await suggestAct(action, id, t, extra); toast(action === "add" ? "Thanks! Your title is up." : action === "vote" ? "Voted." : "Reported. Thanks."); } catch (e) { toast(e.message); } }
  const order = () => C.episodes.filter(e => e.d).slice().sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id);
  function render() {
    const e = C.episodes.find(x => x.id === id), box = $("sp-body");
    if (!e) { box.innerHTML = `<p class="feed-empty">That show isn't on file. <a href="#directory">See all shows</a>.</p>`; return; }
    const rec = isRecent(e.id), info = C.calls[e.id], L = callsFor(e.id, e.sec), real = L.filter(c => !c.skip);
    const O = order(), i = O.findIndex(x => x.id === e.id), prev = O[i - 1], next = O[i + 1];
    const desc = info?.desc || e.n || "";
    const act = c => rec
      ? `<button class="btn sm" type="button" data-go="${c.t}" title="Play from ${hms(c.t, true)}">▶ Play</button><button class="btn sm ghost" type="button" data-clip="${c.t}" data-end="${c.end}" data-name="${esc(callLabel(c))}" title="Clip this whole call">✂</button>`
      : `<a class="btn sm" href="${PC_POST}${e.id}?t=${Math.round(c.t)}" target="_blank" rel="noopener" title="Opens on Prankcast at ${hms(c.t, true)}">▶ Prankcast ↗</a>`;
    box.innerHTML = `
      <nav class="sp-nav"><a href="#directory">← All shows</a><span>${prev ? `<a href="#show/${prev.id}">‹ ${esc(fmtDate(prev.d))}</a>` : ""}${next ? `<a href="#show/${next.id}">${esc(fmtDate(next.d))} ›</a>` : ""}</span></nav>
      <div class="sp-head hud">
        <p class="kicker">${esc(fmtDate(e.d))}${e.h ? ` · hosted by ${esc(e.h)}${e.hq ? ` (${esc(e.hq)})` : ""}` : ""}</p>
        <h2>${esc(niceTitle(e))}</h2>
        ${desc ? `<p class="sp-desc">${esc(desc)}</p>` : ""}
        <p class="sp-meta"><span>${fmtLen(e.sec || 0)}</span>${real.length ? `<span>${real.length} calls</span>` : ""}${real.length ? `<span>${[...new Set(real.map(c => c.by))].length} callers</span>` : ""}</p>
        <div class="sp-acts">${rec ? `<button class="btn red solid" type="button" data-go="0">▶ Play this show here</button>` : ""}<a class="btn sm${rec ? " ghost" : ""}" href="${PC_POST}${e.id}" target="_blank" rel="noopener">Open on Prankcast ↗</a><button class="btn sm ghost" type="button" id="sp-share">Copy link to this show</button></div>
        ${!rec && real.length ? `<p class="sp-note">This show plays on Prankcast. Each call's <b>▶ Prankcast</b> button opens it there with the marker on that call. Just hit play.</p>` : ""}
      </div>
      ${real.length ? `<ol class="sp-calls">${L.map((c, n) => c.skip
        ? `<li class="sp-call skip"><time>${hms(c.t, true)}</time><div><b>${esc(c.by)}</b><em>skipped</em></div></li>`
        : `<li class="sp-call"><span class="sp-n">${L.slice(0, n + 1).filter(x => !x.skip).length}</span><time>${hms(c.t, true)}</time><div><b>${esc(c.by)}</b>${c.title ? `<em>${esc(c.title)}${c.community ? ` <i class="cm">community</i>` : ""}</em>` : `<em class="sp-untitled">No title yet</em>`}<small>${fmtLen(c.end - c.t)}</small></div><span class="sp-a">${C.api && (!c.title || c.community) ? `<button class="btn sm ghost" type="button" data-idea="${c.t}" title="Name this call">${c.title ? "💡" : "💡+"}</button>` : ""}${act(c)}</span>${open === c.t ? ideas(c) : ""}</li>`).join("")}</ol>`
        : `<p class="feed-empty">No call list for this one. ${e.d && e.d < "2025-04-12" ? "It's from before the queue bot started logging turns." : "The queue bot didn't log turns that night."}</p>`}
      ${real.some(c => !c.title) ? `<p class="ext">Know what one of these calls was? ${rec ? "Play it, then tap 💡+ to name it." : "Listen on Prankcast, then tap 💡+ to name it."}</p>` : ""}`;
  }
  function fromHash() { const m = location.hash.match(/^#show\/(\d+)/); if (!m) return; if (+m[1] !== id) open = null; id = +m[1]; render(); window.scrollTo(0, 0); }
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }
  function init() {
    $("sp-body").addEventListener("click", async ev => {
      const g = ev.target.closest("[data-go]"); if (g) { Replay.loadAt(id, +g.dataset.go, true); return; }
      const c = ev.target.closest("[data-clip]"); if (c) { Replay.clipRange(id, +c.dataset.clip, +c.dataset.end, c.dataset.name); return; }
      const ib = ev.target.closest("[data-idea]"); if (ib) { open = open === +ib.dataset.idea ? null : +ib.dataset.idea; render(); $("sp-idea-in")?.focus(); return; }
      const vt = ev.target.closest("[data-vote]"); if (vt) { ideaAct(+vt.closest(".ideas").dataset.t, "vote", { id: vt.dataset.vote }); return; }
      const rp = ev.target.closest("[data-rep]"); if (rp) { if (confirm("Report this title as spam or nasty?")) ideaAct(+rp.closest(".ideas").dataset.t, "report", { id: rp.dataset.rep }); return; }
      if (ev.target.closest("#sp-share")) { const ok = await copy(location.href.split("#")[0] + "#show/" + id); toast(ok ? "Link copied." : location.href); }
    });
    $("sp-body").addEventListener("submit", ev => { const f = ev.target.closest(".idea-f"); if (!f) return; ev.preventDefault(); const v = f.querySelector("input").value.trim(); if (v) ideaAct(+f.closest(".ideas").dataset.t, "add", { title: v }); });
    addEventListener("hashchange", fromHash);
    document.addEventListener("calls-changed", () => id && Router.page === "show" && render());
    document.addEventListener("episodes-changed", () => id && Router.page === "show" && render());
    fromHash();
  }
  return { init };
})();
