/* Clip mode: one strip, right above the player, that does the whole job.
   Mark the start and end (drag, nudge, or "Start here / End here" while the show plays), preview it, then
   download it, post it, send it to the crew, or open it in the editor for effects.
   Clips from a show can run up to 10 minutes (a whole call). They're saved as "show X, from A to B",
   so they take no storage. Live, song and drop clips are recorded audio and top out at 2 minutes. */
const Clipper = (() => {
  const MIN = 1, EDIT_MAX = 120;
  let src = null, w0 = 0, w1 = 0, a = 0, b = 0, previewing = false, raf = null, busy = false, resumeAt = null;

  /* ---------- helpers ---------- */
  const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), x = s - m * 60; return `${m}:${x.toFixed(1).padStart(4, "0")}`; };
  const fname = t => "callective-" + String(t || "clip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  async function episodePiece(ep, from, to) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(`${C.api}/cut/${ep.id}?from=${from.toFixed(2)}&to=${to.toFixed(2)}`, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status);
      return await ac().decodeAudioData(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  // The first cut from a show is the slow one (the worker has to look the show up), so start it while you pick the markers.
  function warm(ep, t) { if (C.api) fetch(`${C.api}/cut/${ep.id}?from=${Math.max(0, Math.floor(t) - 1)}&to=${Math.max(1, Math.floor(t))}`).catch(() => {}); }
  function sliceBuf(buf, s0, s1) {
    const r = buf.sampleRate, i0 = Math.max(0, Math.floor(s0 * r)), i1 = Math.min(buf.length, Math.floor(s1 * r));
    const out = ac().createBuffer(buf.numberOfChannels, Math.max(1, i1 - i0), r);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(i0, i1), c);
    return out;
  }
  function saveBlob(blob, file) {
    const u = URL.createObjectURL(blob), x = document.createElement("a"); x.href = u; x.download = file; document.body.appendChild(x); x.click(); x.remove();
    setTimeout(() => URL.revokeObjectURL(u), 8000);
  }

  /* ---------- sources ---------- */
  // A show on the radio or in the replay terminal. It keeps playing while you clip.
  function episodeSource(el, ep, { radio = false, label } = {}) {
    warm(ep, el.currentTime);
    return {
      kind: "ep", max: 600, ep, title: label || `${fmtDate(ep.d)} · ${ep.h || niceTitle(ep)}`, dur: ep.sec || el.duration || el.currentTime + 60, el,
      pos: () => el.currentTime,
      play(s) { el.currentTime = s; Media.claim(el); return el.play(); },
      resume(t) { if (radio) Listen.tuneIn(); else if (t != null) { el.currentTime = t; el.play().catch(() => {}); } },
      async get(s, e) { const pad = 1.5, from = Math.max(0, s - pad), buf = await episodePiece(ep, from, e + pad), lead = s - from; return sliceBuf(buf, lead, Math.min(buf.duration, lead + (e - s))); },
      meta: s => ({ ep: ep.id, at: Math.round(s) })
    };
  }
  // A file the browser can hold whole (songs, drops, board clips).
  function fileSource(el, url, label) {
    let cache = null;
    return {
      kind: "file", max: EDIT_MAX, title: label, dur: el.duration || 0, el,
      pos: () => el.ended ? (el.duration || 0) : el.currentTime,
      play(s) { el.currentTime = s; Media.claim(el); return el.play(); },
      resume(t) { if (t != null) { el.currentTime = t; el.play().catch(() => {}); } },
      async get(s, e) { if (!cache) { const r = await fetch(url); cache = await ac().decodeAudioData(await r.arrayBuffer()); } return sliceBuf(cache, s, e); },
      meta: () => null
    };
  }
  // The live show: what the browser has heard in the last couple of minutes. Preview plays that recording, not the stream.
  function bufferSource(buf, label, liveEl) {
    let node = null, t0 = 0, s0 = 0;
    return {
      kind: "live", max: EDIT_MAX, title: label, dur: buf.duration, buf, fixed: true,
      pos: () => node ? s0 + (ac().currentTime - t0) : buf.duration,
      play(s) { this.stopNode(); const c = ac(); node = c.createBufferSource(); node.buffer = buf; node.connect(c.destination); node.start(0, s); t0 = c.currentTime; s0 = s; if (liveEl) liveEl.volume = 0; return Promise.resolve(); },
      stopNode() { if (node) { try { node.stop(); } catch (e) {} node = null; } if (liveEl) liveEl.volume = 1; },
      resume() { this.stopNode(); },
      async get(s, e) { return sliceBuf(buf, s, e); },
      meta: () => ({ live: true })
    };
  }

  /* ---------- the strip ---------- */
  const X = t => ((t - w0) / (w1 - w0) * 100).toFixed(3) + "%";
  function paint() {
    if (!src) return; const len = b - a, canEdit = len <= EDIT_MAX + .05;
    $("ct-sel").style.left = X(a); $("ct-sel").style.width = (len / (w1 - w0) * 100).toFixed(3) + "%";
    $("ct-a").textContent = hms(a, true); $("ct-b").textContent = hms(b, true); $("ct-len").textContent = mmss(len);
    $("ct-max").textContent = `max ${src.max / 60} min`;
    const off = busy || !C.api;
    $("ct-dl").disabled = busy || (src.kind === "ep" && !C.api); $("ct-post").disabled = off; $("ct-crew").disabled = off;
    $("ct-edit").disabled = busy || !canEdit || (src.kind === "ep" && !C.api);
    $("ct-edit").title = canEdit ? "Open it in the clip lab for effects" : "Effects work on clips up to 2 minutes. Download or post longer ones as they are.";
  }
  function ticks() {
    const span = w1 - w0, px = ($("ct-track").clientWidth || 600) / span, out = [];
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find(s => s * px >= 70) || 3600;
    for (let t = Math.ceil(w0 / step) * step; t <= w1; t += step) out.push(`<span style="left:${X(t)}">${hms(t)}</span>`);
    $("ct-ticks").innerHTML = out.join("");
  }
  function wave() {
    const cv = $("ct-wave"), box = $("ct-track"), w = box.clientWidth, h = box.clientHeight, g = cv.getContext("2d"), dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const d = src.buf?.getChannelData(0);
    if (d) { g.fillStyle = "#18f0ff66"; const step = d.length / w; for (let x = 0; x < w; x++) { let p = 0; for (let i = Math.floor(x * step); i < Math.min(d.length, (x + 1) * step); i += 16) p = Math.max(p, Math.abs(d[i])); const bh = Math.max(1, p * h * .9); g.fillRect(x, (h - bh) / 2, 1, bh); } }
    else { g.fillStyle = "#18f0ff22"; for (let x = 0; x < w; x += 3) { const bh = h * (.12 + .28 * Math.abs(Math.sin(x * .07) * Math.sin(x * .013 + 1))); g.fillRect(x, (h - bh) / 2, 2, bh); } }
  }
  function frame(around) {
    // Episodes get a 20-minute window, the rest show everything.
    if (src.fixed || src.dur <= 1200) { w0 = 0; w1 = Math.max(src.dur, MIN * 2); return; }
    const span = 1200; w1 = Math.min(src.dur, Math.max(around + 300, span)); w0 = Math.max(0, w1 - span);
  }
  function setSel(na, nb, keep) {
    const max = src.max;
    if (keep === "len") { const len = nb - na; na = clamp(na, w0, w1 - len); nb = na + len; }
    na = clamp(na, 0, src.dur); nb = clamp(nb, 0, src.dur);
    if (nb - na < MIN) { if (keep === "a") na = nb - MIN; else nb = na + MIN; }
    if (nb - na > max) { if (keep === "a") na = nb - max; else nb = na + max; }
    a = Math.max(0, na); b = Math.min(src.dur, nb);
    if (a < w0 || b > w1) { w0 = Math.max(0, Math.min(w0, a - 30)); w1 = Math.min(src.dur, Math.max(w1, b + 30)); ticks(); }
    paint();
  }
  function drag(kind, ev) {
    ev.preventDefault(); stopPreview();
    const tr = $("ct-track").getBoundingClientRect(), t = x => w0 + clamp((x - tr.left) / tr.width, 0, 1) * (w1 - w0);
    const startT = t(ev.clientX), sa = a, sb = b;
    const mv = e => { const d = t(e.clientX) - startT; if (kind === "a") setSel(sa + d, sb, "a"); else if (kind === "b") setSel(sa, sb + d, "b"); else setSel(sa + d, sb + d, "len"); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /* ---------- the moving playhead + preview ---------- */
  function loop() {
    if (!src) return; const p = src.pos();
    if (!src.fixed && !previewing && p > w1 - 15 && w1 < src.dur) { w1 = Math.min(src.dur, p + 300); w0 = Math.max(0, Math.min(a - 30, w1 - 1200)); ticks(); paint(); }
    $("ct-ph").style.left = X(clamp(p, w0, w1));
    $("ct-ph").classList.toggle("pv", previewing);
    if (previewing && p >= b - .03) stopPreview();
    raf = requestAnimationFrame(loop);
  }
  async function preview() {
    if (previewing) { stopPreview(); return; }
    resumeAt = src.el && !src.el.paused ? src.el.currentTime : null;
    previewing = true; $("ct-play").classList.add("is-playing"); $("ct-play").lastChild.textContent = "Stop";
    try { await src.play(a); } catch (e) {}
  }
  function stopPreview() {
    if (!previewing) return; previewing = false;
    $("ct-play").classList.remove("is-playing"); $("ct-play").lastChild.textContent = "Preview";
    if (src.kind === "live") src.resume(); else if (resumeAt != null) src.resume(resumeAt); else src.el?.pause();
    resumeAt = null;
  }
  function here(which) {
    stopPreview(); const p = src.pos();
    if (which === "a") { const nb = b > p + MIN && b - p <= src.max ? b : Math.min(src.dur, p + 30); setSel(p, nb, "b"); }
    else { const na = a < p - MIN && p - a <= src.max ? a : Math.max(0, p - 30); setSel(na, p, "a"); }
    SFX.shutter();
  }

  /* ---------- the actions ---------- */
  const msg = t => { $("ct-msg").innerHTML = t; };
  const who = () => { const by = $("ct-by").value.trim(); try { localStorage.setItem("cx-by", by); } catch (e) {} return by; };
  async function download() {
    if (!src || busy) return; stopPreview();
    const name = `${src.title} ${hms(a, true)}`;
    if (src.kind === "ep") {
      const u = `${C.api}/cut/${src.ep.id}?from=${a.toFixed(2)}&to=${b.toFixed(2)}&dl=1&name=${encodeURIComponent(name)}`;
      const x = document.createElement("a"); x.href = u; x.download = fname(name) + ".mp3"; document.body.appendChild(x); x.click(); x.remove();
      msg("> Downloading. Long clips take a moment to start."); return;
    }
    busy = true; paint(); msg("> Making the MP3…");
    try { saveBlob(await Lab.mp3Blob(await src.get(a, b)), fname(name) + ".mp3"); msg("> Saved."); }
    catch (e) { msg("> The MP3 didn't save. Try again."); }
    busy = false; paint();
  }
  async function send(dest) {
    if (!src || busy || !C.api) return; stopPreview();
    const title = $("ct-name").value.trim(); if (!title) { $("ct-name").focus(); msg("> Give the clip a name first."); return; }
    const by = who(), note = dest === "crew" ? (prompt("Note for the crew (optional):") || "").slice(0, 300) : "";
    busy = true; paint(); msg("> Sending…");
    try {
      let r;
      if (src.kind === "ep") {
        r = await fetch(`${C.api}/clips`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ep: src.ep.id, from: +a.toFixed(2), to: +b.toFixed(2), title, by, note, dest }) });
      } else {
        if (b - a > EDIT_MAX + .5) throw new Error("Recorded clips can be 2 minutes at most");
        const buf = await src.get(a, b), fd = new FormData();
        fd.append("file", await Lab.mp3Blob(buf), "clip.mp3");
        fd.append("meta", JSON.stringify({ title, by, note, dest, ...(src.meta(a) || {}), sec: +buf.duration.toFixed(1), peaks: Lab.peaks(buf) }));
        r = await fetch(`${C.api}/clips`, { method: "POST", body: fd });
      }
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status);
      SFX.pickup(); $("ct-name").value = "";
      msg(dest === "crew" ? "> Sent straight to the crew. Only they can hear it." : "> Posted! The crew gives it a listen, then it shows up on the clip board.");
    } catch (e) { msg(`> Didn't send: ${esc(e.message)}`); }
    busy = false; paint();
  }
  async function edit() {
    if (!src || busy || b - a > EDIT_MAX + .05) return; stopPreview(); busy = true; paint();
    msg("> Pulling this piece into the editor…");
    try {
      const buf = await src.get(a, b), m = src.meta(a), label = `${src.title} @ ${hms(a, true)}`;
      close(); Lab.loadBuffer(buf, label, m); SFX.shutter(); go("lab");
    } catch (e) { busy = false; paint(); msg("> That piece didn't come through. Try again in a moment."); }
  }

  /* ---------- open / close ---------- */
  function open(source, len = 30) {
    if (!source) return; if (src) close();
    src = source; busy = false; previewing = false;
    const now = src.pos(); frame(now);
    const end = clamp(now, MIN, src.dur); setSel(Math.max(0, end - Math.min(len, src.max)), end);
    $("ct-title").textContent = src.title;
    msg(src.kind === "ep" ? "Drag the markers, or use <b>Start here</b> / <b>End here</b> while it plays. Up to 10 minutes, enough for a whole call."
      : src.kind === "live" ? "This is the last couple of minutes you've heard. Drag the markers, preview, then save or send it."
      : "Drag the markers, preview, then save or send it.");
    if (!C.api) msg("Saving and sending work on the live site. You can still try the markers here.");
    $("ct-here").hidden = !!src.fixed;
    try { $("ct-by").value = localStorage.getItem("cx-by") || ""; } catch (e) {}
    $("clipper").hidden = false; document.body.classList.add("clipping");
    if (typeof Listen !== "undefined") Listen.hold = true;
    requestAnimationFrame(() => { ticks(); wave(); paint(); });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() {
    if (!src) return; stopPreview(); cancelAnimationFrame(raf);
    if (typeof Listen !== "undefined") Listen.hold = false;
    src = null; $("clipper").hidden = true; document.body.classList.remove("clipping");
  }
  function init() {
    $("ct-a-h").addEventListener("pointerdown", e => { e.stopPropagation(); drag("a", e); });
    $("ct-b-h").addEventListener("pointerdown", e => { e.stopPropagation(); drag("b", e); });
    $("ct-sel").addEventListener("pointerdown", e => drag("box", e));
    $("ct-track").addEventListener("pointerdown", e => { if (e.target.closest("#ct-sel")) return; const tr = $("ct-track").getBoundingClientRect(), t = w0 + (e.clientX - tr.left) / tr.width * (w1 - w0), len = b - a; setSel(t - len / 2, t + len / 2, "len"); });
    $("ct-play").addEventListener("click", preview);
    $("ct-x").addEventListener("click", close);
    $("ct-start").addEventListener("click", () => here("a")); $("ct-end").addEventListener("click", () => here("b"));
    $("ct-dl").addEventListener("click", download); $("ct-edit").addEventListener("click", edit);
    $("ct-post").addEventListener("click", () => send("board")); $("ct-crew").addEventListener("click", () => send("crew"));
    $("ct-quick").addEventListener("click", e => { const k = e.target.closest("[data-len]"); if (!k) return; stopPreview(); const n = Math.min(+k.dataset.len, src.max), end = clamp(src.pos(), MIN, src.dur); setSel(end - n, end, "a"); });
    $("ct-nudge").addEventListener("click", e => { const k = e.target.closest("[data-n]"); if (!k) return; stopPreview(); const [which, d] = k.dataset.n.split(":"); which === "a" ? setSel(a + +d, b, "a") : setSel(a, b + +d, "b"); });
    document.addEventListener("keydown", e => { if (src && e.key === "Escape" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) close(); });
    addEventListener("resize", () => { if (src) { ticks(); wave(); paint(); } });
  }
  return { init, open, close, episodeSource, fileSource, bufferSource, get active() { return !!src; } };
})();
