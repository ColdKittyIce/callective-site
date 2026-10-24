/* Pages. Every page lives in this one document, so audio keeps playing while you move around.
   #listen, #bingo… open a page; #replay, #line… open the page holding that section and scroll to it. */
const Router = (() => {
  const pages = () => [...document.querySelectorAll(".page")];
  let current = null;
  function pageOf(id) {
    const p = document.getElementById("page-" + id); if (p) return { page: p, target: null };
    const el = document.getElementById(id); if (!el) return null;
    return { page: el.closest(".page"), target: el };
  }
  function show(id, { scroll = true } = {}) {
    const hit = pageOf(id || "home") || pageOf("home"); if (!hit || !hit.page) return;
    const key = hit.page.dataset.page, changed = current !== key;
    pages().forEach(p => { p.hidden = p !== hit.page; });
    current = key;
    document.querySelectorAll("#nav a").forEach(a => a.setAttribute("aria-current", a.getAttribute("href") === "#" + key ? "page" : "false"));
    document.body.dataset.page = key;
    if (changed) document.dispatchEvent(new CustomEvent("page", { detail: key }));
    if (!scroll) return;
    if (hit.target && hit.target.id !== hit.page.querySelector("section")?.id) {
      requestAnimationFrame(() => hit.target.scrollIntoView({ behavior: changed || reduceMotion ? "auto" : "smooth" }));
    } else if (changed) window.scrollTo(0, 0);
  }
  function go(id) {
    if (location.hash === "#" + id) show(id);
    else location.hash = id; // hashchange does the rest
  }
  function init() {
    addEventListener("hashchange", () => show(decodeURIComponent(location.hash.slice(1).split("/")[0])));
    show(decodeURIComponent(location.hash.slice(1).split("/")[0]) || "home", { scroll: !!location.hash });
  }
  return { init, go, show, get page() { return current; } };
})();
