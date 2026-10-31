/* Downloads: wallpapers (songs are the hold.fm list in pages.js). */
const Downloads = (() => {
  let list = [], filter = "all";
  const fig = w => `<figure class="wp ${w.kind} hud">
      <a class="wp-img" href="wallpapers/${w.file}" target="_blank" rel="noopener"><img src="wallpapers/thumbs/${w.k}.webp" alt="${esc(w.t)} wallpaper" loading="lazy" width="${w.kind === "phone" ? 296 : 640}" height="${w.kind === "phone" ? 640 : 360}"></a>
      <figcaption><b>${esc(w.t)}</b><span>${w.kind === "phone" ? "Phone" : "Desktop"} · ${w.w}×${w.h} · ${w.by === "new" ? "Neon set" : "by IceCat"}</span>
      <a class="btn sm" href="wallpapers/${w.file}" download="callective-${w.k}.jpg">Download</a></figcaption></figure>`;
  function render() { // desktop and phone wallpapers in their own grids, so tall and wide thumbnails don't leave holes (audit L9)
    const L = list.filter(w => filter === "all" || w.kind === filter || (filter === "new" && w.by === "new"));
    const D = L.filter(w => w.kind !== "phone"), P = L.filter(w => w.kind === "phone");
    $("wp-grid").innerHTML = (D.length ? `${P.length ? `<h4 class="wp-sub">Desktop · ${D.length}</h4>` : ""}<div class="wp-set desk">${D.map(fig).join("")}</div>` : "")
      + (P.length ? `${D.length ? `<h4 class="wp-sub">Phone · ${P.length}</h4>` : ""}<div class="wp-set phone">${P.map(fig).join("")}</div>` : "");
  }
  async function init() {
    try { list = await getJSON("data/wallpapers.json"); } catch (e) { list = []; }
    render();
    $("wp-chips").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; filter = b.dataset.k; $("wp-chips").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render(); });
  }
  return { init };
})();
