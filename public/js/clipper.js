/* Clip it: a small clip editor that opens right above the player.
   - Overview bar: the whole stretch you can clip from, with chat activity so the funny spots stand out.
   - Close-up: zoom in/out, the real waveform once you're zoomed in, drag the markers or drag out a new selection.
   - Start here / End here mark wherever the show is playing, so you can clip a whole call while it plays.
   - Auto-trim snaps both ends to the nearest quiet spot. "First 3s / last 3s" let you check the edges by ear.
   - Then download it, post it, send it to the crew, or open it in the clip lab for effects.
   Clips from a show can be 20 minutes and are saved as "show X, from A to B" (no storage).
   Live, song and drop clips are recorded audio and top out at 2 minutes. */
const Clipper = (() => {
  const MIN = 1, EDIT_MAX = 120, LAB_MAX = 600, WAVE_MAX = 180, PPS = 40; // waveform loads when the close-up shows 3 minutes or less; 40 peaks a second
  let src = null, w0 = 0, w1 = 0, v0 = 0, v1 = 0, a = 0, b = 0, busy = false;
  let previewing = false, pvEnd = 0, resumeAt = null, raf = null, follow = false;
  let wave = null, waveTimer = null, waveToken = 0, heat = null;

  /* ---------- helpers ---------- */
  const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), x = s - m * 60; return `${m}:${x.toFixed(1).padStart(4, "0")}`; };
  const fname = t => "callective-" + String(t || "clip").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const msg = t => { $("ct-msg").innerHTML = t; };
  async function cutBuffer(ep, from, to) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(`${C.api}/cut/${ep.id}?from=${from.toFixed(2)}&to=${to.toFixed(2)}`, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status);
      return await ac().decodeAudioData(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  }
  function sliceBuf(buf, s0, s1) {
    const r = buf.sampleRate, i0 = Math.max(0, Math.floor(s0 * r)), i1 = Math.min(buf.length, Math.floor(s1 * r));
    const out = ac().createBuffer(buf.numberOfChannels, Math.max(1, i1 - i0), r);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(i0, i1), c);
    return out;
  }
  function peaksOf(buf, startT) {
    const d = buf.getChannelData(0), per = Math.max(1, Math.floor(buf.sampleRate / PPS)), n = Math.ceil(d.length / per), p = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * per, z = Math.min(d.length, j + per); j < z; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; } p[i] = m; }
    let mx = 0; for (const v of p) mx = Math.max(mx, v); if (mx) for (let i = 0; i < n; i++) p[i] /= mx;
    return { s: startT, e: startT + buf.duration, p };
  }
  function saveBlob(blob, file) {
    const u = URL.createObjectURL(blob), x = document.createElement("a"); x.href = u; x.download = file; document.body.appendChild(x); x.click(); x.remove();
    setTimeout(() => URL.revokeObjectURL(u), 8000);
  }

  /* ---------- sources ---------- */
  // A show on the radio or in the replay terminal. It keeps playing while you clip.
  function episodeSource(el, ep, { radio = false, label } = {}) {
    if (C.api) fetch(`${C.api}/cut/${ep.id}?from=${Math.max(0, Math.floor(el.currentTime) - 1)}&to=${Math.max(1, Math.floor(el.currentTime))}`).catch(() => {}); // warm up the cutter
    return {
      kind: "ep", max: 1200, ep, title: label || `${fmtDate(ep.d)} · ${ep.h || niceTitle(ep)}`, dur: ep.sec || el.duration || el.currentTime + 60, el,
      pos: () => el.currentTime, isPlaying: () => !el.paused,
      play(s) { el.currentTime = s; Media.claim(el); return el.play(); },
      resume(t) { if (radio) Listen.tuneIn(); else if (t != null) { el.currentTime = t; el.play().catch(() => {}); } },
      async get(s, e) { const pad = 1, from = Math.max(0, s - pad), buf = await cutBuffer(ep, from, e + pad), lead = s - from; return sliceBuf(buf, lead, Math.min(buf.duration, lead + (e - s))); },
      async peaks(s, e) { return peaksOf(await cutBuffer(ep, s, e), s); },
      async chat() {
        if (!C.api) return null;
        try { const info = await getJSON(`${C.api}/episode/${ep.id}`, 8000); if (!info.cid) return null; const r = await getJSON(`${C.api}/chat/${info.cid}?v=2`, 10000); return (r.messages || []).map(m => m[0]); } catch (e) { return null; }
      },
      meta: s => ({ ep: ep.id, at: Math.round(s) })
    };
  }
  // A file the browser can hold whole (songs, drops, board clips).
  function fileSource(el, url, label) {
    let cache = null; const load = async () => cache || (cache = await ac().decodeAudioData(await (await fetch(url)).arrayBuffer()));
    return {
      kind: "file", max: EDIT_MAX, title: label, dur: el.duration || 0, el, whole: true,
      pos: () => el.ended ? (el.duration || 0) : el.currentTime, isPlaying: () => !el.paused,
      play(s) { el.currentTime = s; Media.claim(el); return el.play(); },
      resume(t) { if (t != null) { el.currentTime = t; el.play().catch(() => {}); } },
      async get(s, e) { return sliceBuf(await load(), s, e); },
      async peaks() { return peaksOf(await load(), 0); },
      async chat() { return null; }, meta: () => null
    };
  }
  // The live show: what the browser heard in the last couple of minutes. Preview plays that recording, not the stream.
  function bufferSource(buf, label, liveEl) {
    let node = null, t0 = 0, s0 = 0;
    return {
      kind: "live", max: EDIT_MAX, title: label, dur: buf.duration, whole: true,
      pos: () => node ? s0 + (ac().currentTime - t0) : buf.duration, isPlaying: () => !!node,
      play(s) { this.stopNode(); const c = ac(); node = c.createBufferSource(); node.buffer = buf; node.connect(c.destination); node.start(0, s); t0 = c.currentTime; s0 = s; node.onended = () => { node = null; }; if (liveEl) liveEl.volume = 0; return Promise.resolve(); },
      stopNode() { if (node) { try { node.onended = null; node.stop(); } catch (e) {} node = null; } if (liveEl) liveEl.volume = 1; },
      resume() { this.stopNode(); },
      async get(s, e) { return sliceBuf(buf, s, e); },
      async peaks() { return peaksOf(buf, 0); },
      async chat() { return null; }, meta: () => ({ live: true })
    };
  }

  /* ---------- geometry ---------- */
  const XO = t => ((t - w0) / (w1 - w0) * 100).toFixed(3) + "%";
  const XZ = t => ((t - v0) / (v1 - v0) * 100).toFixed(3) + "%";
  function setView(n0, n1) {
    const span = clamp(n1 - n0, Math.min(5, w1 - w0), w1 - w0);
    if (n0 < w0) { n0 = w0; } if (n0 + span > w1) n0 = w1 - span;
    v0 = n0; v1 = n0 + span; paintAll(); queueWave();
  }
  function zoom(f, at) { at = at ?? (v0 + v1) / 2; const k = (at - v0) / (v1 - v0), span = (v1 - v0) * f; setView(at - k * span, at - k * span + span); }
  function fitClip() { const len = b - a, pad = Math.max(2, len * .25); setView(a - pad, b + pad); }
  function ensureVisible(t) { if (t < v0 || t > v1) { const span = v1 - v0; setView(t - span / 2, t + span / 2); } }

  /* ---------- painting ---------- */
  function heatAt(t0, t1) { if (!heat) return 0; let n = 0; for (const t of heat) if (t >= t0 && t < t1) n++; return n; }
  function drawBars(cv, s0, s1, mode) {
    const box = cv.parentElement, w = box.clientWidth, h = box.clientHeight, dpr = devicePixelRatio || 1, g = cv.getContext("2d");
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const span = s1 - s0;
    if (mode === "wave" && wave && wave.s <= s0 + .01 && wave.e >= s1 - .01) {
      g.fillStyle = "#18f0ffaa";
      for (let x = 0; x < w; x++) {
        const t0 = s0 + x / w * span, t1 = s0 + (x + 1) / w * span; let m = 0;
        for (let i = Math.floor((t0 - wave.s) * PPS), z = Math.ceil((t1 - wave.s) * PPS); i <= z && i < wave.p.length; i++) if (i >= 0 && wave.p[i] > m) m = wave.p[i];
        const bh = Math.max(1, m * h * .92); g.fillRect(x, (h - bh) / 2, 1, bh);
      }
      return true;
    }
    // chat activity (or a flat line when there's no chat)
    const cols = Math.max(20, Math.min(240, Math.floor(w / 4))), cw = w / cols, vals = [];
    for (let i = 0; i < cols; i++) vals.push(heatAt(s0 + i / cols * span, s0 + (i + 1) / cols * span));
    const mx = Math.max(1, ...vals);
    g.fillStyle = "#18f0ff18"; g.fillRect(0, h / 2 - .5, w, 1);
    if (heat) vals.forEach((v, i) => { if (!v) return; const r = v / mx, bh = Math.max(2, r * (h - 6)); g.fillStyle = r > .66 ? "#ff2bd6" : r > .33 ? "#e9ff3b99" : "#18f0ff66"; g.fillRect(i * cw + .5, h - bh, Math.max(1, cw - 1), bh); });
    return false;
  }
  function ticks() {
    const span = v1 - v0, px = ($("ct-track").clientWidth || 600) / span, out = [];
    const step = [.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].find(s => s * px >= 70) || 3600;
    for (let t = Math.ceil(v0 / step) * step; t <= v1 + 1e-6; t += step) out.push(`<span style="left:${XZ(t)}">${step < 1 ? hms(t) + "." + Math.round((t % 1) * 10) : hms(t)}</span>`);
    $("ct-ticks").innerHTML = out.join("");
  }
  function paintAll() {
    if (!src) return;
    drawBars($("ct-over-c"), w0, w1, "heat");
    const real = drawBars($("ct-wave"), v0, v1, "wave");
    $("ct-track").classList.toggle("real", real);
    // overview: selection + view box
    $("ct-over-sel").style.left = XO(a); $("ct-over-sel").style.width = ((b - a) / (w1 - w0) * 100).toFixed(3) + "%";
    $("ct-view").style.left = XO(v0); $("ct-view").style.width = ((v1 - v0) / (w1 - w0) * 100).toFixed(3) + "%";
    // close-up selection (it may run off either side)
    const L = clamp((a - v0) / (v1 - v0), -.01, 1.01), R = clamp((b - v0) / (v1 - v0), -.01, 1.01), sel = $("ct-sel");
    sel.style.left = (Math.max(0, L) * 100) + "%"; sel.style.width = (Math.max(0, Math.min(1, R) - Math.max(0, L)) * 100) + "%";
    sel.classList.toggle("off-a", L < 0); sel.classList.toggle("off-b", R > 1);
    ticks();
    const len = b - a, canEdit = len <= LAB_MAX + .05;
    $("ct-a").textContent = hms(a, true) + "." + Math.floor((a % 1) * 10); $("ct-b").textContent = hms(b, true) + "." + Math.floor((b % 1) * 10);
    $("ct-len").textContent = mmss(len); $("ct-max").textContent = `max ${src.max / 60} min`;
    $("ct-span").textContent = `Close-up: ${mmss(v1 - v0)}${v1 - v0 > WAVE_MAX && src.kind === "ep" ? " · zoom in to see the waveform" : ""}`;
    $("ct-dl").disabled = busy || (src.kind === "ep" && !C.api); $("ct-post").disabled = busy || !C.api; $("ct-crew").disabled = busy || !C.api;
    $("ct-edit").disabled = busy || !canEdit || (src.kind === "ep" && !C.api); $("ct-auto").disabled = busy || (src.kind === "ep" && !C.api);
    $("ct-edit").title = canEdit ? "Fine-tune it in the clip editor: trim, fades, effects, then post or download" : "The clip editor takes up to 10 minutes. Trim it down, or download or post the whole piece as it is.";
    $("ct-edit").textContent = canEdit ? "✂ Send to the clip editor" : "Clip editor: 10 min max";
  }

  /* ---------- the real waveform for the close-up ---------- */
  function queueWave() {
    clearTimeout(waveTimer);
    if (!src || (src.kind === "ep" && (!C.api || v1 - v0 > WAVE_MAX))) { $("ct-load").hidden = true; return; }
    if (wave && wave.s <= v0 + .01 && wave.e >= v1 - .01) return;
    waveTimer = setTimeout(async () => {
      const tok = ++waveToken; $("ct-load").hidden = false;
      try {
        let w;
        if (src.whole) w = await src.peaks();
        else { const pad = Math.min(60, (v1 - v0) * .5), s = Math.max(0, v0 - pad), e = Math.min(src.dur, v1 + pad); w = await src.peaks(s, e); }
        if (tok === waveToken && src) { wave = w; paintAll(); }
      } catch (e) {}
      if (tok === waveToken) $("ct-load").hidden = true;
    }, src.whole ? 0 : 280);
  }

  /* ---------- selecting ---------- */
  function setSel(na, nb, moving) {
    const max = src.max;
    if (moving === "both") { const len = nb - na; na = clamp(na, 0, src.dur - len); nb = na + len; }
    na = clamp(na, 0, src.dur); nb = clamp(nb, 0, src.dur);
    if (nb - na < MIN) { if (moving === "a") na = nb - MIN; else nb = na + MIN; }
    if (nb - na > max) { if (moving === "a") na = nb - max; else nb = na + max; }
    a = Math.max(0, na); b = Math.min(src.dur, nb);
    if (a < w0 || b > w1) { w0 = Math.max(0, Math.min(w0, a - 30)); w1 = Math.min(src.dur, Math.max(w1, b + 30)); }
    paintAll();
  }
  const tAtZ = x => { const r = $("ct-track").getBoundingClientRect(); return v0 + clamp((x - r.left) / r.width, 0, 1) * (v1 - v0); };
  const tAtO = x => { const r = $("ct-over").getBoundingClientRect(); return w0 + clamp((x - r.left) / r.width, 0, 1) * (w1 - w0); };
  function dragIn(kind, ev) {
    ev.preventDefault(); stopPreview();
    const t0 = tAtZ(ev.clientX), sa = a, sb = b; let moved = false;
    const mv = e => {
      const t = tAtZ(e.clientX), d = t - t0; if (Math.abs(e.clientX - ev.clientX) > 3) moved = true;
      if (kind === "a") setSel(sa + d, sb, "a"); else if (kind === "b") setSel(sa, sb + d, "b"); else if (kind === "box") setSel(sa + d, sb + d, "both");
      else if (moved) setSel(Math.min(t0, t), Math.max(t0, t), t < t0 ? "a" : "b"); // drag out a new selection
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  function dragOver(ev) {
    ev.preventDefault();
    const span = v1 - v0, onBox = ev.target.closest("#ct-view"), start = tAtO(ev.clientX), sv = v0;
    if (!onBox) setView(start - span / 2, start + span / 2);
    const base = onBox ? sv : v0, t0 = start;
    const mv = e => { const d = tAtO(e.clientX) - t0; setView(base + d, base + d + span); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  // two fingers on the close-up zoom it
  const touches = new Map(); let pinch = null;
  function pinchDown(e) { touches.set(e.pointerId, e.clientX); if (touches.size === 2) { const [x1, x2] = [...touches.values()]; pinch = { d: Math.abs(x1 - x2) || 1, span: v1 - v0, at: tAtZ((x1 + x2) / 2) }; } }
  function pinchMove(e) { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, e.clientX); if (pinch && touches.size === 2) { const [x1, x2] = [...touches.values()], f = pinch.d / (Math.abs(x1 - x2) || 1), span = pinch.span * f, k = .5; setView(pinch.at - k * span, pinch.at + (1 - k) * span); } }
  function pinchUp(e) { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; }

  /* ---------- preview + the moving playhead ---------- */
  function loop() {
    if (!src) return; const p = src.pos();
    $("ct-ph").style.left = XZ(clamp(p, v0, v1)); $("ct-ph").hidden = p < v0 || p > v1; $("ct-ph").classList.toggle("pv", previewing);
    $("ct-over-ph").style.left = XO(clamp(p, w0, w1));
    if (previewing) {
      if (follow && (p > v1 - (v1 - v0) * .05)) setView(p - (v1 - v0) * .1, p + (v1 - v0) * .9);
      if (p >= pvEnd - .03 || !src.isPlaying()) stopPreview();
    } else if (src.kind === "ep" && p > w1 - 10 && w1 < src.dur) { w1 = Math.min(src.dur, p + 300); paintAll(); }
    raf = requestAnimationFrame(loop);
  }
  async function previewRange(s, e, btn) {
    if (previewing) { const same = btn && $(btn).classList.contains("is-playing"); stopPreview(); if (same) return; }
    resumeAt = src.el && !src.el.paused ? src.el.currentTime : null;
    previewing = true; pvEnd = e; follow = e - s > (v1 - v0) * .8;
    document.querySelectorAll("#clipper .is-playing").forEach(x => x.classList.remove("is-playing")); if (btn) $(btn).classList.add("is-playing");
    try { await src.play(s); } catch (err) {}
  }
  function stopPreview() {
    if (!previewing) return; previewing = false;
    document.querySelectorAll("#clipper .is-playing").forEach(x => x.classList.remove("is-playing"));
    if (src.kind === "live") src.resume(); else if (resumeAt != null) src.resume(resumeAt); else src.el?.pause();
    resumeAt = null;
  }
  function here(which) {
    stopPreview(); const p = src.pos();
    if (which === "a") { const nb = b > p + MIN && b - p <= src.max ? b : Math.min(src.dur, p + 30); setSel(p, nb, "b"); }
    else { const na = a < p - MIN && p - a <= src.max ? a : Math.max(0, p - 30); setSel(na, p, "a"); }
    ensureVisible(which === "a" ? a : b); SFX.shutter();
  }

  /* ---------- auto-trim: snap both ends to the nearest quiet spot ---------- */
  function quietest(buf, t0, target, range) {
    const d = buf.getChannelData(0), r = buf.sampleRate, fr = Math.max(1, Math.floor(r * .02)), n = Math.floor(d.length / fr), rms = new Float32Array(n);
    for (let i = 0; i < n; i++) { let sum = 0; for (let j = i * fr; j < (i + 1) * fr; j += 2) sum += d[j] * d[j]; rms[i] = Math.sqrt(sum / (fr / 2)); }
    const win = 8, sm = new Float32Array(n); let mx = 0;
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - win / 2); k < Math.min(n, i + win / 2); k++) { s += rms[k]; c++; } sm[i] = s / c; mx = Math.max(mx, sm[i]); }
    let best = null, bestScore = Infinity;
    for (let i = 0; i < n; i++) { const t = t0 + (i + .5) * .02; if (Math.abs(t - target) > range) continue; const score = sm[i] / (mx || 1) + Math.abs(t - target) * .05; if (score < bestScore) { bestScore = score; best = t; } }
    return best ?? target;
  }
  async function autoTrim() {
    if (!src || busy) return; stopPreview(); busy = true; paintAll(); msg("> Listening for the quiet spots…");
    try {
      const R = 2, sa = Math.max(0, a - R), sb = Math.max(0, b - R);
      const [ba, bb] = await Promise.all([src.get(sa, Math.min(src.dur, a + R)), src.get(sb, Math.min(src.dur, b + R))]);
      const na = Math.max(0, quietest(ba, sa, a, R) - .05), nb = Math.min(src.dur, quietest(bb, sb, b, R) + .05);
      busy = false; setSel(na, nb > na + MIN ? nb : na + MIN, "b"); fitClip();
      msg("> Snapped the start and end to the nearest quiet spots. Check them with <b>▶ first 3s</b> and <b>▶ last 3s</b>.");
    } catch (e) { busy = false; paintAll(); msg("> Couldn't hear that part. Try again in a moment."); }
  }

  /* ---------- the actions ---------- */
  const who = () => { const by = $("ct-by").value.trim(); try { localStorage.setItem("cx-by", by); } catch (e) {} return by; };
  async function download() {
    if (!src || busy) return; stopPreview();
    const name = `${src.title} ${hms(a, true)}`;
    if (src.kind === "ep") {
      const u = `${C.api}/cut/${src.ep.id}?from=${a.toFixed(2)}&to=${b.toFixed(2)}&dl=1&name=${encodeURIComponent(name)}`;
      const x = document.createElement("a"); x.href = u; x.download = fname(name) + ".mp3"; document.body.appendChild(x); x.click(); x.remove();
      msg("> Downloading. Long clips take a moment to start."); return;
    }
    busy = true; paintAll(); msg("> Making the MP3…");
    try { saveBlob(await Lab.mp3Blob(await src.get(a, b)), fname(name) + ".mp3"); msg("> Saved."); }
    catch (e) { msg("> The MP3 didn't save. Try again."); }
    busy = false; paintAll();
  }
  async function send(dest) {
    if (!src || busy || !C.api) return; stopPreview();
    const title = $("ct-name").value.trim(); if (!title) { $("ct-name").focus(); msg("> Give the clip a name first."); return; }
    const by = who(), note = dest === "crew" ? (prompt("Note for the crew (optional):") || "").slice(0, 300) : "";
    busy = true; paintAll(); msg("> Sending…");
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
      if (dest === "crew") msg("> Sent straight to the crew. Only they can hear it.");
      else if (j.status === "posted") { msg(`> Posted! It's on the <a href="#clips">clip board</a>. <button class="cb-share" type="button" data-share="${esc(j.id)}">🔗 Copy the share link</button>`); Board.reload(); }
      else msg(j.flag === "recorded audio" ? "> Sent! Recorded clips get a quick listen from the crew before they go up." : "> Sent! The name tripped the filter, so the crew will take a quick look first.");
    } catch (e) { msg(`> Didn't send: ${esc(e.message)}`); }
    busy = false; paintAll();
  }
  async function edit() {
    if (!src || busy || b - a > LAB_MAX + .05) return; stopPreview(); busy = true; paintAll();
    msg("> Pulling this piece into the clip lab…");
    try {
      const buf = await src.get(a, b), m = src.meta(a), label = $("ct-name").value.trim() || `${src.title} @ ${hms(a, true)}`;
      close(); Lab.loadBuffer(buf, label, m); SFX.shutter(); go("lab");
    } catch (e) { busy = false; paintAll(); msg("> That piece didn't come through. Try again in a moment."); }
  }

  /* ---------- open / close ---------- */
  function open(source, len = 30, range) {
    if (!source) return; if (src) close();
    src = source; busy = false; previewing = false; wave = null; heat = null; waveToken++;
    const now = range ? range.from : src.pos();
    if (src.whole || src.dur <= 1200) { w0 = 0; w1 = Math.max(src.dur, MIN * 2); }
    else if (range) { w0 = Math.max(0, range.from - 60); w1 = Math.min(src.dur, Math.max(range.to + 60, w0 + 300)); }
    else { w1 = Math.min(src.dur, Math.max(now + 300, 1200)); w0 = Math.max(0, w1 - 1200); }
    if (range) { a = clamp(range.from, 0, src.dur - MIN); b = clamp(Math.min(range.to, a + src.max), a + MIN, src.dur); }
    else { const end = clamp(now, MIN, src.dur); a = Math.max(0, end - Math.min(len, src.max)); b = end; }
    $("ct-title").textContent = src.title;
    try { $("ct-by").value = localStorage.getItem("cx-by") || ""; } catch (e) {}
    if (range?.name) $("ct-name").value = range.name;
    $("ct-here").hidden = src.kind === "live"; $("ct-end-here").hidden = src.kind === "live";
    $("clipper").hidden = false; document.body.classList.add("clipping");
    if (typeof Listen !== "undefined") Listen.hold = true;
    msg(!C.api ? "Saving and sending work on the live site. You can still try the markers here."
      : src.kind === "ep" ? "Tip: hit <b>Start here</b> when a call begins and <b>End here</b> when it ends. Pink spikes up top = busy chat."
      : src.kind === "live" ? "This is the last couple of minutes you've heard. Drag the markers, preview, then save or send it."
      : "Drag the markers, preview, then save or send it.");
    requestAnimationFrame(() => { fitClip(); if (src.kind === "ep") src.chat().then(t => { if (src && t) { heat = t; paintAll(); } }); });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() {
    if (!src) return; stopPreview(); cancelAnimationFrame(raf); clearTimeout(waveTimer); waveToken++;
    if (typeof Listen !== "undefined") Listen.hold = false;
    src = null; wave = null; $("clipper").hidden = true; document.body.classList.remove("clipping");
  }
  function init() {
    const tr = $("ct-track");
    $("ct-a-h").addEventListener("pointerdown", e => { e.stopPropagation(); dragIn("a", e); });
    $("ct-b-h").addEventListener("pointerdown", e => { e.stopPropagation(); dragIn("b", e); });
    $("ct-sel").addEventListener("pointerdown", e => { if (e.pointerType === "touch") pinchDown(e); if (touches.size < 2) dragIn("box", e); });
    tr.addEventListener("pointerdown", e => { if (e.pointerType === "touch") pinchDown(e); if (touches.size >= 2 || e.target.closest("#ct-sel")) return; dragIn("new", e); });
    addEventListener("pointermove", pinchMove); addEventListener("pointerup", pinchUp); addEventListener("pointercancel", pinchUp);
    tr.addEventListener("wheel", e => { if (!src) return; e.preventDefault(); if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (e.deltaX || e.deltaY) / tr.clientWidth * (v1 - v0); setView(v0 + d, v1 + d); } else zoom(e.deltaY > 0 ? 1.25 : .8, tAtZ(e.clientX)); }, { passive: false });
    $("ct-over").addEventListener("pointerdown", dragOver);
    $("ct-zin").addEventListener("click", () => zoom(.5)); $("ct-zout").addEventListener("click", () => zoom(2));
    $("ct-zfit").addEventListener("click", fitClip); $("ct-zall").addEventListener("click", () => setView(w0, w1));
    $("ct-play").addEventListener("click", () => previewRange(a, b, "ct-play"));
    $("ct-ear-a").addEventListener("click", () => previewRange(a, Math.min(b, a + 3), "ct-ear-a"));
    $("ct-ear-b").addEventListener("click", () => previewRange(Math.max(a, b - 3), b, "ct-ear-b"));
    $("ct-x").addEventListener("click", close);
    $("ct-here").addEventListener("click", () => here("a")); $("ct-end-here").addEventListener("click", () => here("b"));
    $("ct-auto").addEventListener("click", autoTrim);
    $("ct-dl").addEventListener("click", download); $("ct-edit").addEventListener("click", edit);
    $("ct-post").addEventListener("click", () => send("board")); $("ct-crew").addEventListener("click", () => send("crew"));
    $("ct-quick").addEventListener("click", e => { const k = e.target.closest("[data-len]"); if (!k) return; stopPreview(); const n = Math.min(+k.dataset.len, src.max), end = clamp(src.pos(), MIN, src.dur); setSel(end - n, end, "a"); fitClip(); });
    document.querySelectorAll("#clipper [data-n]").forEach(btn => btn.addEventListener("click", () => { stopPreview(); const [w, d] = btn.dataset.n.split(":"); w === "a" ? setSel(a + +d, b, "a") : setSel(a, b + +d, "b"); ensureVisible(w === "a" ? a : b); }));
    document.addEventListener("keydown", e => {
      if (!src || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === "Escape") close();
      else if (e.key === "+" || e.key === "=") zoom(.5); else if (e.key === "-") zoom(2);
      else if (e.key === " " && document.activeElement?.closest("#clipper")) { e.preventDefault(); previewRange(a, b, "ct-play"); }
    });
    addEventListener("resize", () => { if (src) paintAll(); });
  }
  return { init, open, close, episodeSource, fileSource, bufferSource, get active() { return !!src; } };
})();
