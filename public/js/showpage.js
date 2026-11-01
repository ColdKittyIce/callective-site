/* One page per show (#show/<id>): title, date, host, blurb, the call order with timestamps and titles.
   Newest 10 shows play right here. Older ones open on Prankcast at the call: post links take ?t=<seconds>. */
const ShowPage = (() => {
  let id = null, open = null, fixOpen = null;
  const isCrew = () => { try { return !!sessionStorage.getItem("cx-mod"); } catch (e) { return false; } };
  // Community fixes (audit I2): suggest who really made a call or when it really starts; votes decide.
  function fixes(c, rec) {
    const L = c.fixes || [], crew = isCrew();
    const row = x => { const mv = myFixVote(x.id), flag = x.st === "flag";
      return `<li class="fx-row${flag ? " flag" : ""}" data-fid="${esc(x.id)}"><span>${x.k === "by" ? `Caller was <b>${esc(x.val)}</b>` : `Starts at <b>${hms(+x.val, true)}</b>`} ${flag ? `<i class="fx-flag">with the crew</i>` : `<small>${x.up} of ${FIX_UP} votes</small>`}</span>
        ${flag ? "" : `<button type="button" class="idea-v${mv === "up" ? " on" : ""}" data-fx="up"${mv === "own" ? ` disabled title="You suggested this one"` : ` title="This is right"`}>▲ ${x.up}</button><button type="button" class="fx-dn${mv === "down" ? " on" : ""}" data-fx="down" title="${mv === "own" ? "Take back your suggestion" : "This is wrong"}">${mv === "own" ? "✕" : "▼ " + x.dn}</button>`}
        ${crew ? `<button type="button" class="btn sm solid" data-fx="approve">Approve</button><button type="button" class="btn sm red" data-fx="reject">Reject</button>` : ""}</li>`; };
    return `<div class="ideas sp-ideas fx-box" data-key="${c.key}">
      <p><b>Fix this call.</b> Wrong name or wrong start time? Suggest the right one. When ${FIX_UP} other people vote it up, it sticks for everyone. ${FIX_DOWN} votes down send it to the crew.</p>
      ${L.length ? `<ol>${L.map(row).join("")}</ol>` : ""}
      <form class="fx-f"><label>Who called<input name="by" maxlength="40" placeholder="${esc(c.by)}" autocomplete="off"></label><label>Starts at<input name="at" placeholder="${hms(c.t, true)}" autocomplete="off"></label>${rec ? `<button type="button" class="btn sm ghost" data-fxnow title="Fill in where the player is now">⏱ Player time</button>` : ""}<button class="btn sm" type="submit">Suggest</button></form>
      <small>Fill in one or both. Times are h:mm:ss into the recording${rec ? "" : ", the same time Prankcast shows"}. A call starts when the host says who's next.</small></div>`;
  }
  async function fixDo(key, action, extra) {
    try { const j = await fixAct(action, id, key, extra);
      toast(j.applied ? "That fix is in. Everyone sees it now." : action === "add" ? "Thanks! Others can vote on it now." : action === "up" ? "Voted." : action === "down" ? "Noted." : action === "reject" ? "Rejected." : "Done.");
    } catch (e) { toast(e.message); }
  }
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
      ? `<button class="btn sm" type="button" data-go="${c.t}" title="Play from ${hms(c.t, true)}">▶ Play</button><button class="btn sm ghost" type="button" data-clip="${c.t}" data-end="${c.end}" data-name="${esc(callLabel(c))}" title="Clip this whole call">✂ Clip</button><button class="btn sm ghost" type="button" data-moment="${c.t}" title="Copy a link straight to this call">🔗</button>`
      : `<a class="btn sm" href="${PC_POST}${e.id}?t=${Math.round(c.t)}" target="_blank" rel="noopener" title="Opens on Prankcast at ${hms(c.t, true)}">▶ Prankcast ↗</a><button class="btn sm ghost" type="button" data-moment="${c.t}" title="Copy a link straight to this call">🔗</button>`;
    box.innerHTML = `
      <nav class="sp-nav"><a href="#directory">← All shows</a><span>${prev ? `<a href="#show/${prev.id}">‹ ${esc(fmtDate(prev.d))}</a>` : ""}${next ? `<a href="#show/${next.id}">${esc(fmtDate(next.d))} ›</a>` : ""}</span></nav>
      <div class="sp-head hud">
        <p class="kicker">${esc(fmtDate(e.d))}${e.h ? ` · hosted by ${esc(e.h)}${e.hq ? ` (${esc(e.hq)})` : ""}` : ""}</p>
        <h2>${esc(niceTitle(e))}</h2>
        ${desc ? `<p class="sp-desc">${esc(desc)}</p>` : ""}
        <p class="sp-meta"><span>${fmtLen(e.sec || 0)}</span>${real.length ? `<span>${real.length} calls</span>` : ""}${real.length ? `<span>${[...new Set(real.map(c => c.by))].length} callers</span>` : ""}</p>
        <div class="sp-acts">${rec ? `<button class="btn red solid" type="button" data-go="0">▶ Play this show here</button>` : ""}<a class="btn sm${rec ? " ghost" : ""}" href="${PC_POST}${e.id}" target="_blank" rel="noopener">Open on Prankcast ↗</a><button class="btn sm ghost" type="button" id="sp-share">Copy link to this show</button></div>
        ${atT != null && atId === e.id && !rec ? `<p class="sp-moment">Someone shared a moment from this show: <a class="btn red solid" href="${PC_POST}${e.id}?t=${Math.round(atT)}" target="_blank" rel="noopener">▶ Open it on Prankcast at ${hms(atT, true)} ↗</a></p>` : ""}
        ${!rec && real.length ? `<p class="sp-note">This show plays on Prankcast. Each call's <b>▶ Prankcast</b> button opens it there with the marker on that call. Just hit play.</p>` : ""}
      </div>
      ${real.length ? `<ol class="sp-calls">${L.map((c, n) => c.skip
        ? `<li class="sp-call skip"><time>${hms(c.t, true)}</time><div><b>${esc(c.by)}</b><em>skipped</em></div></li>`
        : `<li class="sp-call"><span class="sp-n">${L.slice(0, n + 1).filter(x => !x.skip).length}</span><time>${hms(c.t, true)}</time><div><b>${Callers.link(c.by)}</b>${c.title ? `<em>${esc(c.title)}${c.community ? ` <i class="cm">community</i>` : ""}</em>` : `<em class="sp-untitled">No title yet</em>`}<small>${fmtLen(c.end - c.t)}</small></div><span class="sp-a">${C.api && (!c.title || c.community) ? `<button class="btn sm ghost" type="button" data-idea="${c.t}" title="Name this call">${c.title ? "💡 Vote" : "💡+ Name it"}</button>` : ""}${C.api ? `<button class="btn sm ghost" type="button" data-fix="${c.key}" title="Wrong name or time? Suggest a fix">✎ Fix${c.fixes?.length ? ` (${c.fixes.length})` : ""}</button>` : ""}${act(c)}</span>${open === c.t ? ideas(c) : ""}${fixOpen === c.key ? fixes(c, rec) : ""}</li>`).join("")}</ol>`
        : `<p class="feed-empty">No call list for this one. ${e.d && e.d < "2025-04-12" ? "It's from before the queue bot started logging turns." : "The queue bot didn't log turns that night."}</p>`}
      ${real.some(c => !c.title) ? `<p class="ext">Know what one of these calls was? ${rec ? "Play it, then tap 💡+ to name it." : "Listen on Prankcast, then tap 💡+ to name it."}</p>` : ""}
      ${real.length && C.api ? `<p class="ext">Wrong name or start time on a call? Tap <b>✎ Fix</b> and suggest the right one. 3 votes and it's fixed for everyone.</p>` : ""}`;
  }
  // #at/<id>/<seconds>: a shared moment. Newest 10 load in the replay terminal at that spot (press play: browsers won't autostart);
  // older shows land on their show page with a button that opens Prankcast at that time.
  let atT = null, atId = null;
  function fromAt() {
    const m = location.hash.match(/^#at\/(\d+)\/(\d+)/); if (!m) return false;
    const sid = +m[1], t = +m[2], e = C.episodes.find(x => x.id === sid); if (!e) return false;
    if (isRecent(sid)) { Replay.loadAt(sid, t, false); toast(`Shared moment: ${hms(t, true)}. Hit play.`); }
    else { atT = t; atId = sid; location.replace("#show/" + sid); if (Router.page === "show" && id === sid) render(); }
    return true;
  }
  function fromHash() { if (fromAt()) return; const m = location.hash.match(/^#show\/(\d+)/); if (!m) return; if (+m[1] !== id) open = fixOpen = null; id = +m[1]; render(); window.scrollTo(0, 0); }
  async function copy(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }
  function init() {
    $("sp-body").addEventListener("click", async ev => {
      const g = ev.target.closest("[data-go]"); if (g) { Replay.loadAt(id, +g.dataset.go, true); return; }
      const c = ev.target.closest("[data-clip]"); if (c) { Replay.clipRange(id, +c.dataset.clip, +c.dataset.end, c.dataset.name); return; }
      const ib = ev.target.closest("[data-idea]"); if (ib) { open = open === +ib.dataset.idea ? null : +ib.dataset.idea; fixOpen = null; render(); $("sp-idea-in")?.focus(); return; }
      const fb = ev.target.closest("[data-fix]"); if (fb) { fixOpen = fixOpen === +fb.dataset.fix ? null : +fb.dataset.fix; open = null; render(); return; }
      const fx = ev.target.closest("[data-fx]"); if (fx) { const key = +fx.closest(".fx-box").dataset.key, a = fx.dataset.fx, fid = fx.closest("[data-fid]").dataset.fid;
        if (a === "reject" && !confirm("Reject this fix?")) return; fixDo(key, a, { id: fid }); return; }
      if (ev.target.closest("[data-fxnow]")) { const au = [...document.querySelectorAll("audio")].find(a => a.src.includes(`/show/${id}.mp3`));
        if (!au || !au.currentTime) { toast("Play the show first, then stop at the start of the call."); return; } ev.target.closest(".fx-box").querySelector("[name=at]").value = hms(au.currentTime, true); return; }
      const vt = ev.target.closest("[data-vote]"); if (vt) { ideaAct(+vt.closest(".ideas").dataset.t, "vote", { id: vt.dataset.vote }); return; }
      const rp = ev.target.closest("[data-rep]"); if (rp) { if (confirm("Report this title as spam or nasty?")) ideaAct(+rp.closest(".ideas").dataset.t, "report", { id: rp.dataset.rep }); return; }
      const mo = ev.target.closest("[data-moment]"); if (mo) { const u = momentUrl(id, +mo.dataset.moment), ok = await copyText(u); toast(ok ? `Link copied: opens at ${hms(+mo.dataset.moment, true)}` : u); return; }
      if (ev.target.closest("#sp-share")) { const ok = await copy(location.href.split("#")[0] + "#show/" + id); toast(ok ? "Link copied." : location.href); }
    });
    $("sp-body").addEventListener("submit", async ev => { const ff = ev.target.closest(".fx-f"); if (!ff) return; ev.preventDefault();
      const key = +ff.closest(".fx-box").dataset.key, c = (C.calls[id]?.calls || []).find(x => x.key === key); if (!c) return;
      const by = ff.by.value.trim(), atS = ff.at.value.trim(), at = atS ? parseHms(atS) : null;
      if (!by && !atS) { toast("Type the right name, the right start time, or both."); return; }
      if (atS && !(at >= 0)) { toast("Type the time like 1:02:03 or 62:03."); return; }
      if (by && by.toLowerCase() === String(c.by).toLowerCase() && at == null) { toast("That's the name it already has."); return; }
      if (by && by.toLowerCase() !== String(c.by).toLowerCase()) await fixDo(key, "add", { k: "by", val: by });
      if (at != null && Math.round(at) !== Math.round(c.t)) await fixDo(key, "add", { k: "at", val: Math.round(at) });
    });
    $("sp-body").addEventListener("submit", ev => { const f = ev.target.closest(".idea-f"); if (!f) return; ev.preventDefault(); const v = f.querySelector("input").value.trim(); if (v) ideaAct(+f.closest(".ideas").dataset.t, "add", { title: v }); });
    addEventListener("hashchange", fromHash); fromAt();
    document.addEventListener("calls-changed", () => id && Router.page === "show" && render());
    document.addEventListener("episodes-changed", () => id && Router.page === "show" && render());
    fromHash();
  }
  return { init };
})();
