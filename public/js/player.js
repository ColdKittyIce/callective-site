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
  }
  function hide() { cur = null; $("pbar").hidden = true; document.body.classList.remove("has-pbar"); }
  function init() {
    $("pb-btn").addEventListener("click", () => { if (!cur) return; if (cur.toggle) cur.toggle(); else if (cur.el) cur.el.paused ? (Media.claim(cur.el), cur.el.play().catch(() => {})) : cur.el.pause(); sync(); });
    $("pb-x").addEventListener("click", () => { if (!cur) return; cur.stop ? cur.stop() : cur.el?.pause(); SFX.hangup(); hide(); document.dispatchEvent(new CustomEvent("player-stopped")); });
    $("pb-clip").addEventListener("click", () => cur?.clip && cur.clip());
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
