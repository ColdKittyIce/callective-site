/* Clip lab: a small audio editor. Everything happens in the browser with Web Audio. */
const Lab = (() => {
  let meta = null, buf = null, name = "", undo = [], sel = null, cursor = 0, loop = false, src = null, startedAt = 0, playFrom = 0, playLen = 0, raf = null, dl = null;
  const fx = { phone: false, robot: false, echo: false, stall: false };
  let speed = 1, vol = 1, impulse = null;
  const MAX_SEC = 600;

  /* ---------- loading ---------- */
  async function decode(arr) { const a = ac(); if (!a) throw new Error("no audio"); return await a.decodeAudioData(arr); }
  async function loadUrl(url, label, at = null, sec = 30, m = null) {
    msg(`> Loading ${label}…`);
    try {
      const r = await fetch(url); if (!r.ok) throw 0; const b = await decode(await r.arrayBuffer());
      setBuffer(b, label, m);
      if (at != null && buf) { const z = clamp(at, .5, buf.duration); sel = { a: Math.max(0, z - sec), b: z }; draw(); info(); msg("> Clipped. The highlighted part is what you heard; nudge it, cut it, or add effects."); }
    }
    catch (e) { msg(`Couldn't load ${label}. Try another clip.`); }
  }
  function loadBuffer(b, label, m) {
    setBuffer(b, label, m); sel = null; draw(); info();
    $("s-title").value = ""; msg("> Clip loaded. Fine-trim it, add effects, then download it or send it.");
  }
  async function loadFile(file) {
    if (!file) return; if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)) { msg("That doesn't look like an audio file."); return; }
    msg(`Loading ${file.name}…`);
    try { setBuffer(await decode(await file.arrayBuffer()), file.name.replace(/\.[^.]+$/, "")); }
    catch (e) { msg("Your browser couldn't read that file. MP3 or WAV works best."); }
  }
  function setBuffer(b, label, m) {
    if (b.duration > MAX_SEC) b = slice(b, 0, MAX_SEC);
    stopPlay(); buf = b; name = label; meta = m || null; undo = []; sel = null; cursor = 0;
    $("wempty").hidden = true; $("lab-save").disabled = false; $("lab-mp3").disabled = false; $("s-go").disabled = $("s-crew").disabled = !C.api;
    $("li-src").textContent = meta?.live ? "From the live show" : meta?.ep ? `From the show at ${hms(meta.at, true)}` : "";
    $("s-msg").textContent = C.api ? "Edited clips up to 2 minutes. Board posts go up after the crew gives them a listen. Crew-only clips stay private." : "Sending works on the live site. You can still download it here.";
    draw(); info();
    msg(`> ${label} loaded. Drag across the waveform to pick a piece.`);
  }
  async function loadEpisodeCut(ep, a, b) {
    const pad = 1.5, from = Math.max(0, a - pad), to = b + pad;
    msg(`> Pulling ${hms(a, true)} to ${hms(b, true)} from the show…`); $("wempty").hidden = false; $("wempty").textContent = "> PULLING TAPE…";
    try {
      const r = await fetch(`${C.api}/cut/${ep.id}?from=${from.toFixed(2)}&to=${to.toFixed(2)}`); if (!r.ok) throw new Error(r.status);
      const b2 = await decode(await r.arrayBuffer());
      setBuffer(b2, `${niceTitle(ep)} @ ${hms(a, true)}`, { ep: ep.id, at: Math.round(a) });
      const lead = Math.min(pad, b2.duration / 4); sel = { a: lead, b: Math.max(lead + .5, b2.duration - pad) }; draw(); info();
      $("s-title").value = ""; $("s-title").focus({ preventScroll: true });
      msg("> Clip pulled. The selection is your clip; nudge it, cut it, or add effects.");
    } catch (e) { $("wempty").textContent = "> COULDN'T PULL THAT PIECE. Try again, or pick a different spot."; msg("> The cut didn't come through. Try again in a second."); }
  }
  const msg = t => { $("lab-msg").textContent = t; };

  /* ---------- buffer surgery ---------- */
  function make(len, like) { return ac().createBuffer(like.numberOfChannels, Math.max(1, len), like.sampleRate); }
  function slice(b, s0, s1) {
    const r = b.sampleRate, a = Math.floor(s0 * r), z = Math.min(b.length, Math.floor(s1 * r)), out = make(z - a, b);
    for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, z), c); return out;
  }
  function concat(parts, like) {
    const len = parts.reduce((n, p) => n + p.length, 0), out = make(len, like);
    for (let c = 0; c < like.numberOfChannels; c++) { let o = 0; const d = out.getChannelData(c); for (const p of parts) { d.set(p.getChannelData(Math.min(c, p.numberOfChannels - 1)), o); o += p.length; } }
    return out;
  }
  function range() { return sel && sel.b - sel.a > .02 ? [sel.a, sel.b] : [0, buf.duration]; }
  function edit(fn, label) {
    if (!buf) { msg("Load a clip first."); return; }
    stopPlay(); undo.push(buf); if (undo.length > 25) undo.shift();
    buf = fn(buf); draw(); info(); msg(label);
  }
  const OPS = {
    keep() { if (!sel) { msg("Select a piece first by dragging across the waveform."); return; } const [a, b] = range(); edit(x => slice(x, a, b), "Kept just the selection."); sel = null; draw(); },
    del() { if (!sel) { msg("Select a piece first by dragging across the waveform."); return; } const [a, b] = range(); edit(x => concat([slice(x, 0, a), slice(x, b, x.duration)], x), "Cut it out."); sel = null; draw(); },
    rev() { const [a, b] = range(); edit(x => { const mid = slice(x, a, b); for (let c = 0; c < mid.numberOfChannels; c++) mid.getChannelData(c).reverse(); return concat([slice(x, 0, a), mid, slice(x, b, x.duration)], x); }, sel ? "Reversed the selection." : "Reversed the whole clip."); },
    stut() { const [a, b] = range(); const grain = Math.min(.14, (b - a) / 2), start = sel ? a : cursor;
      edit(x => { const g = slice(x, start, start + grain); return concat([slice(x, 0, start), g, g, g, g, g, slice(x, start, x.duration)], x); }, "B-b-b-bad connection."); },
    norm() { edit(x => { let pk = 0; for (let c = 0; c < x.numberOfChannels; c++) for (const v of x.getChannelData(c)) pk = Math.max(pk, Math.abs(v)); const g = pk ? .98 / pk : 1;
      const out = make(x.length, x); for (let c = 0; c < x.numberOfChannels; c++) { const s = x.getChannelData(c), d = out.getChannelData(c); for (let i = 0; i < s.length; i++) d[i] = s[i] * g; } return out; }, "Turned it all the way up."); },
    undo() { if (!undo.length) { msg("Nothing to undo."); return; } stopPlay(); buf = undo.pop(); sel = null; draw(); info(); msg("Undone."); }
  };

  /* ---------- effects chain (same graph for live play and for saving) ---------- */
  function getImpulse(ctx) {
    const len = Math.floor(ctx.sampleRate * .9), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 400 && i % 97 < 3 ? 3 : 1); }
    return b;
  }
  function chain(ctx, out) {
    const input = ctx.createGain(); input.gain.value = vol; let node = input;
    if (fx.phone) {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 320;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
      const sh = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(2.4 * x); } sh.curve = curve;
      const g = ctx.createGain(); g.gain.value = 1.15; node.connect(hp); hp.connect(lp); lp.connect(sh); sh.connect(g); node = g;
    }
    if (fx.robot) {
      const rm = ctx.createGain(); rm.gain.value = 0; const osc = ctx.createOscillator(); osc.frequency.value = 58; osc.connect(rm.gain); osc.start();
      const g = ctx.createGain(); g.gain.value = 1.6; node.connect(rm); rm.connect(g); node = g;
    }
    if (fx.echo) {
      const mix = ctx.createGain(), d = ctx.createDelay(2), fb = ctx.createGain(), wet = ctx.createGain();
      d.delayTime.value = .34; fb.gain.value = .42; wet.gain.value = .55;
      node.connect(mix); node.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(mix); node = mix;
    }
    if (fx.stall) {
      const mix = ctx.createGain(), cv = ctx.createConvolver(), wet = ctx.createGain(); cv.buffer = ctx === AC ? (impulse ||= getImpulse(ctx)) : getImpulse(ctx); wet.gain.value = .7;
      node.connect(mix); node.connect(cv); cv.connect(wet); wet.connect(mix); node = mix;
    }
    node.connect(out); return input;
  }

  /* ---------- playback ---------- */
  function play() {
    if (!buf) { msg("Load a clip first."); return; }
    if (src) { stopPlay(); return; }
    const a = ac(); Media.els.forEach(x => !x.paused && x.pause());
    const [s0, s1] = sel && sel.b - sel.a > .02 ? [sel.a, sel.b] : [cursor < buf.duration - .05 ? cursor : 0, buf.duration];
    src = a.createBufferSource(); src.buffer = buf; src.playbackRate.value = speed;
    src.connect(chain(a, a.destination));
    if (loop) { src.loop = true; src.loopStart = s0; src.loopEnd = s1; src.start(0, s0); } else src.start(0, s0, s1 - s0);
    playFrom = s0; playLen = s1 - s0; startedAt = a.currentTime;
    src.onended = () => { if (!loop) stopPlay(); };
    $("lab-play").classList.add("is-playing"); $("lab-play").lastChild.textContent = "Stop";
    raf = requestAnimationFrame(movePh);
  }
  function stopPlay() {
    if (src) { try { src.onended = null; src.stop(); } catch (e) {} src = null; }
    cancelAnimationFrame(raf); $("lab-play").classList.remove("is-playing"); $("lab-play").lastChild.textContent = "Play";
    $("wph").style.left = (buf ? cursor / buf.duration * 100 : 0) + "%";
  }
  function movePh() {
    if (!src || !buf) return;
    let t = (AC.currentTime - startedAt) * speed; t = loop ? t % playLen : Math.min(t, playLen);
    $("wph").style.left = ((playFrom + t) / buf.duration * 100) + "%"; raf = requestAnimationFrame(movePh);
  }

  /* ---------- waveform ---------- */
  function draw() {
    const cv = $("wavec"), box = $("wave"), dpr = devicePixelRatio || 1, w = box.clientWidth, h = box.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    g.fillStyle = "#ff2bd655"; g.fillRect(0, h / 2, w, 1);
    const s = $("wsel");
    if (!buf) { s.hidden = true; return; }
    const d = buf.getChannelData(0), step = d.length / w;
    g.fillStyle = "#18f0ff"; g.shadowColor = "#18f0ff"; g.shadowBlur = 6;
    for (let x = 0; x < w; x++) {
      let mn = 1, mx = -1; const a = Math.floor(x * step), z = Math.min(d.length, Math.floor((x + 1) * step) + 1);
      for (let i = a; i < z; i += Math.max(1, Math.floor((z - a) / 64))) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      g.fillRect(x, (1 - mx) * h / 2, 1, Math.max(1, (mx - mn) * h / 2));
    }
    if (sel && sel.b - sel.a > .005) { s.hidden = false; s.style.left = sel.a / buf.duration * 100 + "%"; s.style.width = (sel.b - sel.a) / buf.duration * 100 + "%"; } else s.hidden = true;
    $("wph").style.left = cursor / buf.duration * 100 + "%";
  }
  function info() {
    $("li-len").textContent = buf ? buf.duration.toFixed(2) + "s" : "0.00s";
    $("li-sel").textContent = sel && sel.b - sel.a > .005 ? `${sel.a.toFixed(2)}s to ${sel.b.toFixed(2)}s` : "none";
  }

  /* ---------- saving ---------- */
  function wav(b) {
    const ch = b.numberOfChannels, sr = b.sampleRate, n = b.length, data = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); data.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
    data.setUint16(22, ch, true); data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, "data"); data.setUint32(40, n * ch * 2, true);
    const chans = [...Array(ch)].map((_, c) => b.getChannelData(c)); let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = clamp(chans[c][i], -1, 1); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([data], { type: "audio/wav" });
  }
  async function render() {
    stopPlay();
    const [s0, s1] = range(), part = slice(buf, s0, s1), tail = (fx.echo ? 2.2 : 0) + (fx.stall ? 1 : 0);
    const len = Math.ceil((part.duration / speed + tail) * part.sampleRate);
    const off = new OfflineAudioContext(part.numberOfChannels, len, part.sampleRate);
    const s = off.createBufferSource(); s.buffer = part; s.playbackRate.value = speed; s.connect(chain(off, off.destination)); s.start(0);
    return await off.startRendering();
  }
  const fname = ext => `callective-${(name || "clip").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.${ext}`;
  function download(blob, file) {
    if (dl) URL.revokeObjectURL(dl); dl = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = dl; a.download = file; document.body.appendChild(a); a.click(); a.remove();
    msg(`> Saved ${file}. If nothing downloaded, this preview blocks downloads; it works on the live site.`);
  }
  async function save() { if (!buf) return; msg("> Rendering…"); download(wav(await render()), fname("wav")); }
  let lameP = null;
  function lame() {
    if (window.lamejs) return Promise.resolve(); if (lameP) return lameP;
    lameP = new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js"; sc.onload = ok; sc.onerror = () => { lameP = null; no(new Error("encoder")); }; document.head.appendChild(sc); });
    return lameP;
  }
  async function mp3Blob(b) {
    await lame();
    const ch = Math.min(2, b.numberOfChannels), enc = new lamejs.Mp3Encoder(ch, b.sampleRate, 128), out = [];
    const to16 = d => { const o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const v = clamp(d[i], -1, 1); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
    const L = to16(b.getChannelData(0)), R = ch > 1 ? to16(b.getChannelData(1)) : null;
    for (let i = 0; i < L.length; i += 1152) { const m = ch > 1 ? enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152)) : enc.encodeBuffer(L.subarray(i, i + 1152)); if (m.length) out.push(m); }
    const end = enc.flush(); if (end.length) out.push(end);
    return new Blob(out, { type: "audio/mpeg" });
  }
  async function saveMp3() {
    if (!buf) return; msg("> Rendering MP3…");
    try { download(await mp3Blob(await render()), fname("mp3")); } catch (e) { msg("> The MP3 encoder didn't load. Save WAV works offline."); }
  }
  function peaks(b, n = 48) {
    const d = b.getChannelData(0), step = Math.floor(d.length / n) || 1; let out = "", mx = 0; const v = [];
    for (let i = 0; i < n; i++) { let p = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 8) p = Math.max(p, Math.abs(d[j])); v.push(p); mx = Math.max(mx, p); }
    for (const p of v) out += Math.min(9, Math.round(p / (mx || 1) * 9)); return out;
  }
  async function send(e) {
    e.preventDefault(); if (!buf || !C.api) return;
    const dest = e.submitter?.dataset.dest || "board";
    const title = $("s-title").value.trim(), by = $("s-by").value.trim(), note = $("s-note").value.trim();
    if (!title) { $("s-title").focus(); $("s-msg").textContent = "Give it a name first."; return; }
    $("s-go").disabled = $("s-crew").disabled = true; $("s-msg").textContent = "Rendering and sending…";
    try {
      const out = await render(); if (out.duration > 122) { $("s-msg").textContent = `That's ${Math.round(out.duration)} seconds. Edited clips can be 2 minutes at most.`; $("s-go").disabled = $("s-crew").disabled = false; return; }
      const fd = new FormData(); fd.append("file", await mp3Blob(out), "clip.mp3");
      fd.append("meta", JSON.stringify({ title, by, note, dest, live: !!meta?.live, ep: meta?.ep || null, at: meta?.at ?? null, sec: +out.duration.toFixed(1), peaks: peaks(out) }));
      const r = await fetch(`${C.api}/clips`, { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      try { localStorage.setItem("cx-by", by); } catch (err) {}
      $("s-msg").textContent = dest === "crew" ? "Sent straight to the crew. Only they can hear it." : "Sent! The crew will give it a listen before it hits the clip board."; SFX.pickup(); $("s-title").value = ""; $("s-note").value = "";
    } catch (err) { $("s-msg").textContent = `Didn't send: ${err.message}. Try again in a minute.`; }
    $("s-go").disabled = $("s-crew").disabled = false;
  }

  /* ---------- wiring ---------- */
  function setFx(k, on) { fx[k] = on; document.querySelector(`.fx[data-fx="${k}"]`).setAttribute("aria-pressed", String(on)); if (src) { stopPlay(); play(); } }
  function setSpeed(v) { speed = +v; $("k-speed").value = v; $("o-speed").textContent = (+v).toFixed(2) + "×"; if (src) src.playbackRate.value = speed; }
  function setVol(v) { vol = +v; $("k-vol").value = v; $("o-vol").textContent = Math.round(v * 100) + "%"; }
  const PRESETS = {
    chipmunk: () => { setSpeed(1.65); }, slowira: () => { setSpeed(.62); },
    australia: () => { setFx("phone", true); setFx("echo", true); }, servo: () => { setFx("robot", true); setFx("phone", true); setSpeed(.9); },
    clean: () => { for (const k in fx) setFx(k, false); setSpeed(1); setVol(1); }
  };

  function init() {
    const songs = (window.Hold?.TRACKS || []);
    $("lab-pick").innerHTML = `<option value="">Load a clip…</option><optgroup label="Switchboard clips">${C.clips.map(c => `<option value="clip:${c.k}">${esc(c.who)}: ${esc(c.line)}</option>`).join("")}</optgroup>` +
      (songs.length ? `<optgroup label="Hold line">${songs.map(t => `<option value="song:${t.k}">${esc(t.t)}</option>`).join("")}</optgroup>` : "");
    $("lab-pick").addEventListener("change", e => { const [kind, k] = e.target.value.split(":"); if (!k) return; kind === "clip" ? loadClip(k) : loadUrl(`audio/${k}.mp3`, songs.find(t => t.k === k)?.t || k); });
    $("lab-file").addEventListener("change", e => loadFile(e.target.files[0]));
    const wave = $("wave");
    ["dragenter", "dragover"].forEach(t => wave.addEventListener(t, e => { e.preventDefault(); wave.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach(t => wave.addEventListener(t, e => { e.preventDefault(); wave.classList.remove("dragover"); }));
    wave.addEventListener("drop", e => loadFile(e.dataTransfer.files[0]));
    const tAt = ev => { const b = wave.getBoundingClientRect(); return clamp((ev.clientX - b.left) / b.width, 0, 1) * (buf?.duration || 0); };
    wave.addEventListener("pointerdown", ev => {
      if (!buf) return; wave.setPointerCapture(ev.pointerId); const t0 = tAt(ev); sel = { a: t0, b: t0 };
      const mv = e => { const t = tAt(e); sel = { a: Math.min(t0, t), b: Math.max(t0, t) }; draw(); info(); };
      wave.addEventListener("pointermove", mv);
      wave.addEventListener("pointerup", () => { wave.removeEventListener("pointermove", mv); if (sel.b - sel.a < .02) { cursor = t0; sel = null; } if (src) { stopPlay(); } draw(); info(); }, { once: true });
    });
    wave.addEventListener("keydown", e => {
      if (e.code === "Space") { e.preventDefault(); play(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); OPS.del(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); OPS.undo(); }
    });
    $("lab-play").addEventListener("click", play);
    $("lab-loop").addEventListener("click", e => { loop = !loop; e.currentTarget.setAttribute("aria-pressed", String(loop)); if (src) { stopPlay(); play(); } });
    $("lab-selall").addEventListener("click", () => { if (buf) { sel = { a: 0, b: buf.duration }; draw(); info(); } });
    $("op-keep").addEventListener("click", OPS.keep); $("op-del").addEventListener("click", OPS.del); $("op-rev").addEventListener("click", OPS.rev);
    $("op-stut").addEventListener("click", OPS.stut); $("op-norm").addEventListener("click", OPS.norm); $("op-undo").addEventListener("click", OPS.undo);
    $("fxrow").addEventListener("click", e => { const b = e.target.closest("[data-fx]"); if (b) setFx(b.dataset.fx, !fx[b.dataset.fx]); });
    $("k-speed").addEventListener("input", e => setSpeed(e.target.value));
    $("k-vol").addEventListener("input", e => setVol(e.target.value));
    $("presets").addEventListener("click", e => { const b = e.target.closest("[data-preset]"); if (b) { PRESETS.clean(); if (b.dataset.preset !== "clean") PRESETS[b.dataset.preset](); msg(`Preset: ${b.textContent}.`); } });
    $("lab-save").addEventListener("click", save); $("lab-mp3").addEventListener("click", saveMp3); $("send").addEventListener("submit", send);
    try { $("s-by").value = localStorage.getItem("cx-by") || ""; } catch (e) {}
    new ResizeObserver(() => draw()).observe(wave);
    draw();
  }
  function loadClip(k) { const c = C.clips.find(x => x.k === k); $("lab-pick").value = `clip:${k}`; loadUrl(`clips/${k}.mp3`, c ? `${c.who}, “${c.line}”` : k); }
  return { init, loadClip, loadEpisodeCut, loadBuffer, loadUrl, mp3Blob, peaks };
})();
