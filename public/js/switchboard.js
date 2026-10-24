/* The switchboard: one jack per real clip, grouped by caller. Patching draws a cord and plays it. */
const SB = (() => {
  const COLORS = ["#18f0ff", "#ff2bd6", "#e9ff3b", "#8a5bff"];
  let cords = [], last = null, colorI = 0;

  function render() {
    const groups = new Map();
    for (const c of C.clips) { if (!groups.has(c.who)) groups.set(c.who, []); groups.get(c.who).push(c); }
    $("strips").innerHTML = [...groups].map(([who, list]) => `<div class="strip"><h3>${esc(who)}</h3><div class="jacks">${list.map(c =>
      `<button class="jack" type="button" data-k="${c.k}" title="${esc(c.line)}" aria-label="${esc(who)}: ${esc(c.line)}"><span class="lmp"></span><span class="hole"></span></button>`).join("")}</div></div>`).join("");
  }

  function jackPoint(k) {
    const j = document.querySelector(`.jack[data-k="${k}"] .hole`), p = $("panel");
    if (!j) return null; const a = j.getBoundingClientRect(), b = p.getBoundingClientRect();
    return [a.left + a.width / 2 - b.left, a.top + a.height / 2 - b.top];
  }
  function drawCords() {
    const p = $("panel"), w = p.clientWidth, h = p.clientHeight, svg = $("cords");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = cords.map((c, i) => {
      const pt = jackPoint(c.k); if (!pt) return "";
      const ox = w * (.35 + .1 * (i % 4)), oy = h + 14, [x, y] = pt, sag = Math.min(160, h * .45);
      const d = `M${ox},${oy} C${ox},${oy - sag * .4} ${x},${y + sag} ${x},${y}`;
      return `<path class="shadow" d="${d}" transform="translate(2,3)"/><path d="${d}" stroke="${c.color}" style="filter:drop-shadow(0 0 5px ${c.color})"/><circle cx="${x}" cy="${y}" r="7" fill="${c.color}"/>`;
    }).join("");
  }

  function patch(k, opts = {}) {
    const c = C.clips.find(x => x.k === k); if (!c) return;
    cords = cords.filter(x => x.k !== k); cords.push({ k, color: COLORS[colorI++ % COLORS.length] }); if (cords.length > 4) cords.shift();
    drawCords(); click(0, .5);
    const jack = document.querySelector(`.jack[data-k="${k}"]`);
    jack?.classList.add("on", "played");
    const a = playClip(k, opts.vol ?? 1);
    a.addEventListener("ended", () => jack?.classList.remove("on"));
    last = c; $("sb-who").textContent = c.who; $("sb-line").textContent = `“${c.line}”`;
    $("sb-sub").textContent = `${c.sec.toFixed(1)} seconds · patched through`;
    $("sb-lab").disabled = false;
  }
  function conference(n = 4) {
    const pool = [...C.clips].sort(() => Math.random() - .5).slice(0, n);
    pool.forEach((c, i) => setTimeout(() => patch(c.k, { vol: .85 }), i * 380));
    $("sb-who").textContent = "Conference call";
  }
  function clear() {
    cords = []; drawCords(); stopClips(); SFX.hangup();
    document.querySelectorAll(".jack.on").forEach(j => j.classList.remove("on"));
    $("sb-who").textContent = "Operator"; $("sb-line").textContent = "Number please?"; $("sb-sub").textContent = "Tap a jack to patch it through.";
  }

  function init() {
    render();
    $("strips").addEventListener("click", e => { const j = e.target.closest(".jack"); if (j) { ac(); patch(j.dataset.k); } });
    $("sb-random").addEventListener("click", () => patch(pick(C.clips).k));
    $("sb-conf").addEventListener("click", () => conference(4));
    $("sb-clear").addEventListener("click", clear);
    $("sb-lab").addEventListener("click", () => { if (last) { Lab.loadClip(last.k); go("lab"); } });
    new ResizeObserver(() => drawCords()).observe($("panel"));
  }
  return { init, patch, conference };
})();
