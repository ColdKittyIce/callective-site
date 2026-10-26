/* The bar at the bottom: whatever is playing (radio, live show, an episode, a song), wherever you are on the site. */
const Player = (() => {
  let cur = null; // { el, kind, title, page, seek, clip(), toggle(), stop(), time() }
  const KIND = { radio: "Callective Radio", live: "Live now", ep: "Replay", song: "Hold.fm", clip: "Clip board", drop: "Patch bay" };
  function set(info) {
    cur = info; const bar = $("pbar"); bar.hidden = false; bar.dataset.kind = info.kind;
    $("pb-kind").textContent = KIND[info.kind] || ""; $("pb-title").textContent = info.title || "";
    $("pb-go").href = "#" + (info.page || "listen");
    $("pb-seek").hidden = !info.seek; $("pb-clip").hidden = !info.clip;
    document.body.classList.add("has-pbar"); sync();
  }
  function update(patch) { if (!cur) return; Object.assign(cur, patch); if (patch.title != null) $("pb-title").textContent = patch.title; sync(); }
  function playing() { return cur && (cur.isPlaying ? cur.isPlaying() : cur.el && !cur.el.paused); }
  function sync() {
    if (!cur) return; const on = playing();
    $("pb-btn").classList.toggle("is-playing", !!on); $("pb-btn").setAttribute("aria-label", on ? "Pause" : "Play");
    const el = cur.el;
    if (cur.time) $("pb-time").textContent = cur.time();
    else if (el && isFinite(el.duration) && el.duration) $("pb-time").textContent = `${hms(el.currentTime)} / ${hms(el.duration)}`;
    if (cur.seek && el && el.duration) $("pb-seek").value = Math.round(el.currentTime / el.duration * 1000);
    // 💡: name the call that's on right now (only calls with no title, or a title the listeners picked)
    const c = onLine(), b = $("pb-idea");
    b.hidden = !(c && (!c.title || c.community));
    if (!b.hidden) { b.textContent = c.title ? "💡" : "💡+"; b.title = c.title ? `Vote on a title for ${c.by}'s call, or suggest a better one` : `Name ${c.by}'s call`; }
  }
  function onLine() { const x = C.api && cur?.call?.(); return x && x.ep ? callAt(x.ep, x.t, x.dur) : null; }
  // The title box for one call, opened from the player bar.
  function ideaBox(ep, t) {
    const c = callsFor(ep, C.episodes.find(e => e.id === ep)?.sec).find(x => x.t === t); if (!c) return;
    const ideas = c.ideas || [];
    openTakeover(`<div class="card idea-card" data-ep="${ep}" data-t="${t}"><b class="mod-h">💡 NAME THIS CALL</b>
      <p>On the line: <b>${esc(c.by)}</b> at ${hms(c.at, true)}${c.title ? `. Right now it's called “${esc(c.title)}”.` : `. No title yet.`}</p>
      ${ideas.length ? `<ol class="idea-list">${ideas.map(x => `<li><button type="button" class="idea-v" data-pvote="${esc(x.id)}" title="+1 this title">▲ ${x.v}</button><span>${esc(x.title)}</span><button type="button" class="idea-r" data-prep="${esc(x.id)}" title="Report this one">⚑</button></li>`).join("")}</ol>` : ""}
      <form class="idea-f" id="pb-idea-f"><label class="sr" for="pb-idea-in">Suggest a title</label><input id="pb-idea-in" maxlength="80" placeholder="What was this call? e.g. The Pumpkin Man" autocomplete="off"><button class="btn sm" type="submit">Suggest</button></form>
      <p class="ext">The title with the most votes shows up everywhere. Keep it funny, keep it clean of names and numbers.</p>
      <button class="btn sm ghost" type="button" data-close>Close</button></div>`);
    $("pb-idea-in").focus();
  }
  async function ideaGo(action, extra) {
    const box = document.querySelector(".idea-card"); if (!box) return; const ep = +box.dataset.ep, t = +box.dataset.t;
    try { await suggestAct(action, ep, t, extra); toast(action === "add" ? "Thanks! Your title is up." : action === "vote" ? "Voted." : "Reported. Thanks."); ideaBox(ep, t); sync(); }
    catch (e) { toast(e.message); }
  }
  function hide() { cur = null; $("pbar").hidden = true; document.body.classList.remove("has-pbar"); }
  function init() {
    $("pb-btn").addEventListener("click", () => { if (!cur) return; if (cur.toggle) cur.toggle(); else if (cur.el) cur.el.paused ? (Media.claim(cur.el), cur.el.play().catch(() => {})) : cur.el.pause(); sync(); });
    $("pb-x").addEventListener("click", () => { if (!cur) return; cur.stop ? cur.stop() : cur.el?.pause(); SFX.hangup(); hide(); document.dispatchEvent(new CustomEvent("player-stopped")); });
    $("pb-clip").addEventListener("click", () => cur?.clip && cur.clip());
    $("pb-idea").addEventListener("click", () => { const c = onLine(), x = cur?.call?.(); if (c && x) ideaBox(x.ep, c.t); });
    document.addEventListener("submit", e => { if (e.target.id !== "pb-idea-f") return; e.preventDefault(); const v = $("pb-idea-in").value.trim(); if (v) ideaGo("add", { title: v }); });
    document.addEventListener("click", e => {
      const v = e.target.closest("[data-pvote]"); if (v) { ideaGo("vote", { id: v.dataset.pvote }); return; }
      const r = e.target.closest("[data-prep]"); if (r && confirm("Report this title as spam or nasty?")) ideaGo("report", { id: r.dataset.prep });
    });
    $("pb-seek").addEventListener("input", e => { const el = cur?.el; if (cur?.seek && el?.duration) el.currentTime = e.target.value / 1000 * el.duration; });
    setInterval(sync, 500);
    // C clips whatever is playing, from any page.
    document.addEventListener("keydown", e => {
      if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && cur?.clip && playing()) { e.preventDefault(); cur.clip(); }
    });
  }
  // Clip a file that's playing in the browser (songs, clip board clips, patch bay clips): opens clip mode on it.
  function clipFrom(el, url, label, sec = 30) { Clipper.open(Clipper.fileSource(el, url, label), sec); }
  return { init, set, update, hide, sync, clipFrom, get current() { return cur; } };
})();
