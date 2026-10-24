/* Downloads: wallpapers (songs are the hold.fm list in pages.js). */
const Downloads = (() => {
  let list = [], filter = "all";
  function render() {
    const L = list.filter(w => filter === "all" || w.kind === filter || (filter === "new" && w.by === "new"));
    $("wp-grid").innerHTML = L.map(w => `<figure class="wp ${w.kind} hud">
      <a class="wp-img" href="wallpapers/${w.file}" target="_blank" rel="noopener"><img src="wallpapers/thumbs/${w.k}.webp" alt="${esc(w.t)} wallpaper" loading="lazy" width="${w.kind === "phone" ? 296 : 640}" height="${w.kind === "phone" ? 640 : 360}"></a>
      <figcaption><b>${esc(w.t)}</b><span>${w.kind === "phone" ? "Phone" : "Desktop"} · ${w.w}×${w.h} · ${w.by === "new" ? "Neon set" : "by IceCat"}</span>
      <a class="btn sm" href="wallpapers/${w.file}" download="callective-${w.k}.jpg">Download</a></figcaption></figure>`).join("");
  }
  async function init() {
    try { list = await getJSON("data/wallpapers.json"); } catch (e) { list = []; }
    render();
    $("wp-chips").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; filter = b.dataset.k; $("wp-chips").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render(); });
  }
  return { init };
})();
