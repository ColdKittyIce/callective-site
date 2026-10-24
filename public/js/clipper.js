/* Clip mode: a YouTube-style clip strip that opens right above the player.
   Drag the start and end markers, preview the piece, then send just that piece to the clip lab.
   Works for every source: the radio, the live show, archive episodes, songs, drops and board clips. */
const Clipper = (() => {
  const MIN = 1, MAX = 60;
  let src = null, w0 = 0, w1 = 0, a = 0, b = 0, previewing = false, raf = null, pvNode = null, pvStart = 0, busy = false;

  /* ---------- fetching just the piece of an episode ----------
     The site's worker cuts only the bytes for that piece out of the show's MP3 (Prankcast's storage doesn't let browsers do it directly). */
  async function episodePiece(ep, from, to) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 40000);
    try {
      const r = await fetch(`${C.api}/cut/${ep.id}?from=${from.toFixed(2)}&to=${to.toFixed(2)}`, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status);
      return await ac().decodeAudioData(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  // The first cut from a show is the slow one (the worker has to find the show's audio), so start that while you pick the markers.
  function warm(ep, t) { if (C.api) fetch(`${C.api}/cut/${ep.id}?from=${Math.max(0, Math.floor(t) - 1)}&to=${Math.max(1, Math.floor(t))}`).catch(() => {}); }
  function sliceBuf(buf, s0, s1) {
    const r = buf.sampleRate, i0 = Math.max(0, Math.floor(s0 * r)), i1 = Math.min(buf.length, Math.floor(s1 * r));
    const out = ac().createBuffer(buf.numberOfChannels, Math.max(1, i1 - i0), r);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(i0, i1), c);
    return out;
  }

  /* ---------- sources ---------- */
  // Episode on the radio or in the replay terminal: preview by moving the real player, put it back after.
  function episodeSource(el, ep, { radio = false, label } = {}) {
    const back = el.currentTime, wasPlaying = !el.paused;
    warm(ep, back);
    return {
      title: label || `${fmtDate(ep.d)} · ${ep.h || niceTitle(ep)}`, now: el.currentTime, dur: ep.sec || el.duration || el.currentTime + 30, el,
      play(s) { el.currentTime = s; Media.claim(el); return el.play(); }, stop() { el.pause(); }, pos: () => el.currentTime,
      async get(s, e) { const pad = 1.5, from = Math.max(0, s - pad), buf = await episodePiece(ep, from, e + pad); const lead = s - from; return sliceBuf(buf, lead, Math.min(buf.duration, lead + (e - s))); },
      meta: (s) => ({ ep: ep.id, at: Math.round(s) }),
      restore() { if (radio) { if (wasPlaying) Listen.tuneIn(); } else { el.currentTime = back; if (wasPlaying) el.play().catch(() => {}); else el.pause(); } }
    };
  }
  // A file the browser can read whole (songs, drops, board clips).
  function fileSource(el, url, label) {
    const back = el.ended ? 0 : el.currentTime, wasPlaying = !el.paused && !el.ended; let cache = null;
    return {
      title: label, now: el.ended || !el.currentTime ? (el.duration || 0) : el.currentTime, dur: el.duration || 0, el,
      play(s) { el.currentTime = s; Media.claim(el); return el.play(); }, stop() { el.pause(); }, pos: () => el.currentTime,
      async get(s, e) { if (!cache) { const r = await fetch(url); cache = await ac().decodeAudioData(await r.arrayBuffer()); } return sliceBuf(cache, s, e); },
      meta: () => null,
      restore() { el.currentTime = back; if (wasPlaying) el.play().catch(() => {}); }
    };
  }
  // The live show: a snapshot of the last minute the browser heard. Preview plays the snapshot, not the stream.
  function bufferSource(buf, label, liveEl) {
    let node = null, t0 = 0, s0 = 0;
    return {
      title: label, now: buf.duration, dur: buf.duration, buf,
      play(s) { this.stop(); const c = ac(); node = c.createBufferSource(); node.buffer = buf; node.connect(c.destination); node.start(0, s); t0 = c.currentTime; s0 = s; if (liveEl) liveEl.volume = 0; return Promise.resolve(); },
      stop() { if (node) { try { node.stop(); } catch (e) {} node = null; } if (liveEl) liveEl.volume = 1; },
      pos: () => node ? s0 + (ac().currentTime - t0) : s0,
      async get(s, e) { return sliceBuf(buf, s, e); },
      meta: () => ({ live: true }),
      restore() { this.stop(); }
    };
  }

  /* ---------- the strip ---------- */
  const X = t => ((t - w0) / (w1 - w0) * 100).toFixed(3) + "%";
  function paint() {
    $("ct-sel").style.left = X(a); $("ct-sel").style.width = ((b - a) / (w1 - w0) * 100).toFixed(3) + "%";
    $("ct-now").style.left = X(clamp(src.now, w0, w1));
    $("ct-a").textContent = hms(a, true); $("ct-b").textContent = hms(b, true); $("ct-len").textContent = (b - a).toFixed(1) + "s";
    $("ct-make").disabled = busy;
  }
  function ticks() {
    const span = w1 - w0, step = span > 300 ? 60 : span > 120 ? 30 : span > 40 ? 10 : 5, out = [];
    for (let t = Math.ceil(w0 / step) * step; t <= w1; t += step) out.push(`<span style="left:${X(t)}">${hms(t)}</span>`);
    $("ct-ticks").innerHTML = out.join("");
  }
  function wave() {
    const cv = $("ct-wave"), box = $("ct-track"), w = box.clientWidth, h = box.clientHeight, g = cv.getContext("2d");
    cv.width = w * (devicePixelRatio || 1); cv.height = h * (devicePixelRatio || 1); g.scale(devicePixelRatio || 1, devicePixelRatio || 1); g.clearRect(0, 0, w, h);
    const d = src.buf?.getChannelData(0);
    g.fillStyle = "#18f0ff66";
    if (d) { const step = d.length / w; for (let x = 0; x < w; x++) { let p = 0; for (let i = Math.floor(x * step); i < Math.min(d.length, (x + 1) * step); i += 16) p = Math.max(p, Math.abs(d[i])); const bh = Math.max(1, p * h * .9); g.fillRect(x, (h - bh) / 2, 1, bh); } }
    else { g.fillStyle = "#18f0ff22"; for (let x = 0; x < w; x += 3) { const bh = h * (.12 + .28 * Math.abs(Math.sin(x * .07) * Math.sin(x * .013 + 1))); g.fillRect(x, (h - bh) / 2, 2, bh); } }
  }
  function setSel(na, nb, keep) {
    if (keep === "len") { const len = nb - na; na = clamp(na, w0, w1 - len); nb = na + len; }
    na = clamp(na, w0, w1); nb = clamp(nb, w0, w1);
    if (nb - na < MIN) { if (keep === "a") na = nb - MIN; else nb = na + MIN; }
    if (nb - na > MAX) { if (keep === "a") na = nb - MAX; else nb = na + MAX; }
    a = Math.max(w0, na); b = Math.min(w1, nb); paint();
  }
  function drag(kind, ev) {
    ev.preventDefault(); stopPreview();
    const tr = $("ct-track").getBoundingClientRect(), t = x => w0 + clamp((x - tr.left) / tr.width, 0, 1) * (w1 - w0);
    const startT = t(ev.clientX), sa = a, sb = b;
    const mv = e => { const d = t(e.clientX) - startT; if (kind === "a") setSel(sa + d, sb, "a"); else if (kind === "b") setSel(sa, sb + d, "b"); else setSel(sa + d, sb + d, "len"); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  /* ---------- preview ---------- */
  function loop() {
    if (!previewing) return; const p = src.pos();
    $("ct-ph").style.left = X(clamp(p, w0, w1)); $("ct-ph").hidden = false;
    if (p >= b - .03) { stopPreview(); return; }
    raf = requestAnimationFrame(loop);
  }
  async function preview() {
    if (previewing) { stopPreview(); return; }
    previewing = true; $("ct-play").classList.add("is-playing"); $("ct-play").lastChild.textContent = "Stop";
    try { await src.play(a); } catch (e) {}
    raf = requestAnimationFrame(loop);
  }
  function stopPreview() {
    if (!previewing) return; previewing = false; cancelAnimationFrame(raf);
    src.stop(); $("ct-ph").hidden = true; $("ct-play").classList.remove("is-playing"); $("ct-play").lastChild.textContent = "Preview";
  }

  /* ---------- open / make / close ---------- */
  function open(source, len = 30) {
    if (!source) return; if (src) close(false);
    src = source; busy = false;
    const span = src.dur <= 180 ? src.dur : 150;
    w1 = src.dur <= 180 ? src.dur : Math.min(src.dur, Math.max(src.now + 20, span));
    w0 = Math.max(0, w1 - span);
    const end = clamp(src.now, w0 + MIN, w1); setSel(end - Math.min(len, end - w0), end);
    $("ct-title").textContent = src.title; $("ct-msg").textContent = "Drag the markers or the whole box. Preview it, then send it to the editor.";
    $("clipper").hidden = false; document.body.classList.add("clipping");
    if (typeof Listen !== "undefined") Listen.hold = true;
    requestAnimationFrame(() => { ticks(); wave(); paint(); });
    $("ct-play").focus({ preventScroll: true });
  }
  async function make() {
    if (!src || busy) return; stopPreview(); busy = true; paint();
    $("ct-msg").textContent = "> Pulling just this piece…";
    try {
      const buf = await src.get(a, b), m = src.meta(a), label = `${src.title} @ ${hms(a, true)}`;
      close(true);
      Lab.loadBuffer(buf, label, m); SFX.shutter(); go("lab");
    } catch (e) {
      busy = false; paint();
      $("ct-msg").textContent = "> That piece didn't come through. Try again in a moment, or pick a slightly different spot.";
    }
  }
  function close(restore = true) {
    if (!src) return; stopPreview();
    if (restore) src.restore();
    if (typeof Listen !== "undefined") Listen.hold = false;
    src = null; $("clipper").hidden = true; document.body.classList.remove("clipping");
  }
  function init() {
    $("ct-a-h").addEventListener("pointerdown", e => { e.stopPropagation(); drag("a", e); });
    $("ct-b-h").addEventListener("pointerdown", e => { e.stopPropagation(); drag("b", e); });
    $("ct-sel").addEventListener("pointerdown", e => drag("box", e));
    $("ct-track").addEventListener("pointerdown", e => { if (e.target.closest("#ct-sel")) return; const tr = $("ct-track").getBoundingClientRect(), t = w0 + (e.clientX - tr.left) / tr.width * (w1 - w0), len = b - a; setSel(t - len / 2, t + len / 2, "len"); });
    $("ct-play").addEventListener("click", preview);
    $("ct-make").addEventListener("click", make);
    $("ct-x").addEventListener("click", () => close(true));
    $("ct-quick").addEventListener("click", e => { const k = e.target.closest("[data-len]"); if (!k) return; stopPreview(); const n = +k.dataset.len, end = clamp(src.now, w0 + MIN, w1); setSel(end - n, end, "a"); });
    $("ct-nudge").addEventListener("click", e => { const k = e.target.closest("[data-n]"); if (!k) return; stopPreview(); const [which, d] = k.dataset.n.split(":"); which === "a" ? setSel(a + +d, b, "a") : setSel(a, b + +d, "b"); });
    document.addEventListener("keydown", e => { if (!src) return; if (e.key === "Escape") { close(true); } else if (e.key === "Enter" && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) { e.preventDefault(); make(); } });
    addEventListener("resize", () => { if (src) { ticks(); wave(); paint(); } });
  }
  return { init, open, close, episodeSource, fileSource, bufferSource, get active() { return !!src; } };
})();
