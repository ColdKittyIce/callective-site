/* Getting around long pages (audit batch 2, Oct 31 2026):
   - the ☰ Menu button on phones (the whole page list, instead of a sideways strip)
   - sticky "on this page" jump bars on Lore and Games, lit up for the section you're in
   - tabs on Downloads (Music · Wallpapers · Stickers · Audio Bible)
   - Calls / Chat tabs in the replay terminal on phones */
const SubNav = (() => {
  const head = () => document.querySelector("header.top");
  function measure() { // sticky bars sit right under the header
    const h = head(); if (!h || h.classList.contains("menu-open")) return;
    document.documentElement.style.setProperty("--headH", h.offsetHeight + "px");
  }

  /* ---------- phone menu ---------- */
  function menu() {
    const h = head(), btn = $("menubtn"); if (!btn) return;
    const set = open => { h.classList.toggle("menu-open", open); btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "✕ Close" : "☰ Menu"; };
    btn.addEventListener("click", () => set(!h.classList.contains("menu-open")));
    $("nav").addEventListener("click", e => { if (e.target.closest("a")) set(false); });
    addEventListener("hashchange", () => set(false));
    document.addEventListener("pointerdown", e => { if (h.classList.contains("menu-open") && !h.contains(e.target)) set(false); });
    addEventListener("keydown", e => { if (e.key === "Escape" && h.classList.contains("menu-open")) { set(false); btn.focus(); } });
  }

  /* ---------- jump bars ---------- */
  function jumps() {
    for (const bar of document.querySelectorAll(".jump")) {
      const links = [...bar.querySelectorAll("a[href^='#']")];
      bar.addEventListener("click", e => {
        const a = e.target.closest("a[href^='#']"); if (!a) return;
        const el = document.getElementById(a.getAttribute("href").slice(1)); if (!el) return;
        e.preventDefault(); history.replaceState(null, "", a.getAttribute("href"));
        el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); light(a);
      });
      const light = a => { links.forEach(x => x.classList.toggle("on", x === a)); a.scrollIntoView({ block: "nearest", inline: "nearest" }); };
      if (!("IntersectionObserver" in window)) continue;
      const seen = new Map();
      const io = new IntersectionObserver(es => {
        es.forEach(e => seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
        let best = null, bestTop = Infinity;
        for (const a of links) { const el = document.getElementById(a.getAttribute("href").slice(1)); if (!el || !seen.get(el.id)) continue; const t = Math.abs(el.getBoundingClientRect().top); if (t < bestTop) { bestTop = t; best = a; } }
        if (best) links.forEach(x => x.classList.toggle("on", x === best));
      }, { rootMargin: "-30% 0px -50% 0px", threshold: [0, .01] });
      links.forEach(a => { const el = document.getElementById(a.getAttribute("href").slice(1)); if (el) io.observe(el); });
    }
  }

  /* ---------- Downloads tabs ---------- */
  function dlTabs() {
    const bar = $("dl-tabs"); if (!bar) return;
    const show = (tab, scroll) => {
      document.querySelectorAll("[data-dltab]").forEach(el => { el.hidden = el.dataset.dltab !== tab; });
      bar.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
      if (scroll) { const top = bar.getBoundingClientRect().top + scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--headH")) || 0) - 8; if (scrollY > top) scrollTo({ top, behavior: "auto" }); }
      try { sessionStorage.setItem("cx-dltab", tab); } catch (e) {}
    };
    bar.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab, true); });
    const fromHash = () => { const h = location.hash.slice(1).split("/")[0]; if (h === "audiobible" || h.startsWith("ab-")) show("bible"); else if (h === "downloads") { let t = "music"; try { t = sessionStorage.getItem("cx-dltab") || t; } catch (e) {} show(t); } };
    addEventListener("hashchange", fromHash); fromHash();
    if (!document.querySelector("[data-dltab]:not([hidden])")) show("music");
  }

  /* ---------- replay: Calls / Chat on phones ---------- */
  function replayTabs() {
    const booth = document.querySelector("#replay .booth"), bar = $("rp-tabs"); if (!booth || !bar) return;
    booth.dataset.tab = "calls";
    bar.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; booth.dataset.tab = b.dataset.tab; bar.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", String(x === b))); });
  }

  function init() {
    menu(); jumps(); dlTabs(); replayTabs();
    measure(); addEventListener("resize", measure); document.addEventListener("page", () => requestAnimationFrame(measure));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  }
  return { init };
})();
