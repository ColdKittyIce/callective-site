/* Listen: Callective Radio (the archive on a shared 24/7 loop), and the live show when it's on. */
const Listen = (() => {
  const RADIO_EPOCH = Date.UTC(2026, 0, 1);
  const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js";
  let hold = false, mode = "radio", want = false, sched = null, info = null, switching = false;
  let hls = null, proxied = false, liveRetry = null;
  const ra = () => $("radioaud"), lv = () => $("livevid");

  /* ---------- schedule (same math as the worker, used when there's no API) ---------- */
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function order(list, cycle) { const a = list.slice().sort((x, y) => x.id - y.id), r = rng(cycle * 7919 + a.length); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function at(list, t) { const total = list.reduce((s, e) => s + e.sec, 0), el = (t - RADIO_EPOCH) / 1000, cycle = Math.floor(el / total); let p = el - cycle * total;
    for (const e of order(list, cycle)) { if (p < e.sec) return { ep: e, offset: p }; p -= e.sec; } return null; }
  function local() {
    const list = C.episodes.filter(e => e.sec > 600), now = Date.now(), cur = at(list, now), next = []; let t = now + (cur.ep.sec - cur.offset) * 1000 + 500;
    for (let i = 0; i < 4; i++) { const n = at(list, t); next.push({ ...n.ep, at: t - 500 }); t += n.ep.sec * 1000; }
    return { now, ep: cur.ep, offset: cur.offset, endsAt: now + (cur.ep.sec - cur.offset) * 1000, next };
  }
  async function fetchSched() {
    let s = null;
    if (C.api) { try { s = await getJSON(C.api + "/radio", 7000); } catch (e) {} }
    if (!s) s = local();
    s.fetchedAt = Date.now(); return s;
  }
  const pos = () => sched ? clamp(sched.offset + (Date.now() - sched.fetchedAt) / 1000, 0, sched.ep.sec) : 0;

  /* ---------- radio ---------- */
  async function loadEpisode() {
    const ep = sched.ep; info = null;
    if (C.api) { try { info = await getJSON(`${C.api}/episode/${ep.id}`, 8000); } catch (e) {} }
    if (mode === "radio") paintNow();
  }
  async function refresh() { sched = await fetchSched(); await loadEpisode(); paintNext(); }
  async function startRadio() {
    if (!sched) await refresh();
    if (!C.api || !info?.mp3) { paintNow(); $("ls-note").textContent = C.api ? "This show's audio didn't load. The next show starts on time." : "Radio audio plays on the live Cloudflare site. Here you can see what's on and what's next."; return; }
    const a = ra();
    if (a.dataset.ep !== String(sched.ep.id)) { a.src = info.mp3; a.dataset.ep = sched.ep.id; }
    Media.claim(a);
    const go = () => { try { a.currentTime = pos(); } catch (e) {} a.play().catch(() => { want = false; paintNow(); }); };
    if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
    a.preload = "auto";
    Player.set({ kind: "radio", el: a, title: radioTitle(sched.ep), page: "listen", clip: () => clip(30), toggle, isPlaying: () => !a.paused, time: () => hms(pos(), true) });
    $("ls-note").textContent = "Everyone listening hears this same moment. Pause and you rejoin wherever the radio is when you come back.";
  }
  function stopRadio() { switching = true; ra().pause(); switching = false; }
  const radioTitle = e => `${fmtDate(e.d)} · ${e.h ? "hosted by " + e.h : niceTitle(e)}`;

  async function nextShow() {
    stopRadio(); sched = await fetchSched(); await loadEpisode(); paintNext();
    if (want && mode === "radio") { const a = new Audio("audio/sting.mp3"); a.volume = .8; a.play().catch(() => {}); setTimeout(startRadio, 1600); }
  }

  /* ---------- live ---------- */
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement("script"); s.src = HLS_JS; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  async function attachLive(useProxy) {
    const v = lv(), url = useProxy ? `${C.api}/hls` : C.live?.hls; if (!url) return;
    proxied = !!useProxy; v.crossOrigin = "anonymous";
    if (hls) { hls.destroy(); hls = null; }
    if (!window.MediaSource && v.canPlayType("application/vnd.apple.mpegurl")) { v.src = url; return; }
    try { await loadHlsJs(); } catch (e) { $("ls-note").textContent = "The live player didn't load. Open the show on Prankcast instead."; return; }
    if (!Hls.isSupported()) { v.src = url; return; }
    hls = new Hls({ liveSyncDurationCount: 3, lowLatencyMode: false, xhrSetup: x => { x.withCredentials = false; } });
    let fails = 0;
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return; fails++;
      if (!proxied && C.api) { attachLive(true).then(() => want && playLive()); return; }
      if (fails < 4 && d.type === Hls.ErrorTypes.NETWORK_ERROR) { setTimeout(() => hls && hls.startLoad(), 3000); return; }
      $("ls-note").textContent = "The live stream dropped. Retrying… you can also listen on Prankcast.";
      clearTimeout(liveRetry); liveRetry = setTimeout(() => mode === "live" && attachLive(proxied).then(() => want && playLive()), 15000);
    });
    hls.loadSource(url); hls.attachMedia(v);
  }
  async function playLive() {
    const v = lv(); Media.claim(v); v.hidden = false;
    try { await v.play(); $("ls-tap").hidden = true; } catch (e) { $("ls-tap").hidden = false; }
    Cap.attach(v);
    Player.set({ kind: "live", el: v, title: "The Callective, live on Prankcast", page: "listen", clip: () => clip(30), toggle, isPlaying: () => !v.paused, time: () => "LIVE" });
  }
  async function goLive() {
    if (mode === "live") return; mode = "live"; document.body.classList.add("is-live");
    const wasRadio = want && !ra().paused; stopRadio();
    $("livebar").hidden = Router.page === "listen"; paintNow();
    if (C.live?.hls) await attachLive(false);
    if (wasRadio || want) { want = true; playLive(); toast("The Callective just went live. Switching over."); }
    else if (Media.els && [...Media.els].some(x => !x.paused)) toast("The Callective is live. Tap the red bar to tune in.");
  }
  function endLive() {
    if (mode !== "live") return; mode = "radio"; document.body.classList.remove("is-live");
    clearTimeout(liveRetry);
    const v = lv(), wasOn = want && !v.paused; switching = true; v.pause(); switching = false;
    if (hls) { hls.destroy(); hls = null; } v.removeAttribute("src"); v.load(); v.hidden = true; $("ls-tap").hidden = true; $("livebar").hidden = true;
    paintNow();
    if (wasOn) { toast("That's the show. Back to Callective Radio."); refresh().then(() => { if (want) startRadio(); }); }
  }

  /* Live clipping: the last minute of the live audio is kept in memory, in the browser, while you watch. */
  const Cap = (() => {
    const RING = `class R extends AudioWorkletProcessor{constructor(o){super();this.n=o.processorOptions.n;this.b=new Float32Array(this.n);this.i=0;this.f=false;
      this.port.onmessage=e=>{const n=this.f?this.n:this.i,o=new Float32Array(n);if(this.f){o.set(this.b.subarray(this.i));o.set(this.b.subarray(0,this.i),this.n-this.i)}else o.set(this.b.subarray(0,this.i));this.port.postMessage(o,[o.buffer])}}
      process(inp){const c=inp[0];if(c&&c.length){const L=c[0],R=c[1]||L;for(let k=0;k<L.length;k++){this.b[this.i++]=(L[k]+R[k])*.5;if(this.i>=this.n){this.i=0;this.f=true}}}return true}}registerProcessor("cx-ring",R);`;
    let node = null, busy = false;
    async function attach(el) {
      if (node || busy) return !!node; const a = ac(); if (!a || !a.audioWorklet || a.state !== "running") return false;
      busy = true;
      try {
        await a.audioWorklet.addModule(URL.createObjectURL(new Blob([RING], { type: "text/javascript" })));
        const src = a.createMediaElementSource(el); node = new AudioWorkletNode(a, "cx-ring", { processorOptions: { n: Math.round(a.sampleRate * 62) }, numberOfOutputs: 1, outputChannelCount: [1] });
        const mute = a.createGain(); mute.gain.value = 0; src.connect(a.destination); src.connect(node); node.connect(mute).connect(a.destination);
      } catch (e) { node = null; }
      busy = false; return !!node;
    }
    function dump() { return new Promise(res => { node.port.onmessage = e => res(e.data); node.port.postMessage("dump"); }); }
    return { attach, dump, get ready() { return !!node; } };
  })();

  async function clip(sec = 30) {
    if (mode === "live") {
      if (lv().paused) { toast("Start the live show first, then clip."); return; }
      if (!Cap.ready) { await Cap.attach(lv()); toast(Cap.ready ? "Clip recorder is on. Give it a few seconds of show, then clip again." : "This browser can't record the live show. Try Chrome or Firefox."); return; }
      const data = await Cap.dump(), c = ac();
      if (data.length < c.sampleRate * 2) { toast("Give it a few more seconds of show first."); return; }
      const buf = c.createBuffer(1, data.length, c.sampleRate); buf.copyToChannel(data, 0);
      Clipper.open(Clipper.bufferSource(buf, `Live show, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, lv()), sec); return;
    }
    if (!C.api || !info?.mp3) { toast("Clipping the radio works on the live site."); return; }
    if (ra().paused) { toast("Tune in first, then clip what you hear."); return; }
    Clipper.open(Clipper.episodeSource(ra(), sched.ep, { radio: true, label: radioTitle(sched.ep) }), sec);
  }

  /* ---------- painting ---------- */
  function paintNow() {
    const live = mode === "live", e = sched?.ep;
    $("ls-badge").classList.toggle("live", live); $("ls-badge").querySelector("span").textContent = live ? "Live" : "Radio";
    $("ls-kicker").textContent = live ? "On the air right now" : "Callective Radio · 24/7";
    $("ls-label").textContent = live ? "Live from the WOPC Discord" : "Now playing";
    $("ls-title").textContent = live ? "The Callective is live" : e ? niceTitle(e) : "Tuning…";
    $("ls-meta").innerHTML = live ? `Broadcasting on <a href="https://prankcast.com/thecallective" target="_blank" rel="noopener">Prankcast ↗</a>`
      : e ? [`${esc(fmtDate(e.d))}`, e.h ? `Host <b>${esc(e.h)}</b>` : "", fmtLen(e.sec)].filter(Boolean).join(" · ") : "";
    $("ls-replay").hidden = live; $("ls-replay").href = e ? `#replay` : "#archive"; $("ls-replay").dataset.replay = e ? e.id : "";
    $("ls-full").hidden = !live; $("ls-art").hidden = live && lv().videoWidth > 0;
    const playing = live ? !lv().paused : !ra().paused;
    $("ls-play").classList.toggle("is-playing", playing); $("ls-play").setAttribute("aria-label", playing ? "Pause" : live ? "Watch live" : "Tune in");
    $("ls-clip").disabled = !playing && !!C.api;
    $("nav").querySelector(".nav-listen").classList.toggle("live", live);
    // home page card
    $("nowcard").classList.toggle("live", live);
    $("nc-badge").classList.toggle("live", live); $("nc-badge").querySelector("span").textContent = live ? "Live" : "Radio";
    $("nc-label").textContent = live ? "On the air right now" : playing ? "You're tuned in" : "Callective Radio is playing";
    $("nc-title").textContent = live ? "The Callective is live. Watch it here." : e ? radioTitle(e) : "The archive, around the clock";
    if (Player.current?.kind === "radio" && e) Player.update({ title: radioTitle(e) });
  }
  function paintNext() {
    if (!sched) return;
    const fmt = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("ls-next").innerHTML = sched.next.map(n => `<li><time>${fmt(n.at)}</time><span><b>${esc(fmtDate(n.d))}</b>${n.h ? ` · ${esc(n.h)}` : ""}</span><em>${fmtLen(n.sec)}</em></li>`).join("");
  }
  function paintClock() {
    $("ls-clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    $("ls-countdown").textContent = mode === "live" ? "On right now" : ($("next-time")?.textContent || "–");
    if (mode === "live") { $("ls-pos").textContent = "LIVE"; $("ls-left").textContent = ""; $("ls-prog").style.width = "100%"; return; }
    if (!sched) return; const p = pos();
    $("ls-pos").textContent = hms(p, true); $("ls-left").textContent = `-${hms(sched.ep.sec - p, true)}`;
    $("ls-prog").style.width = (p / sched.ep.sec * 100).toFixed(2) + "%";
  }
  let oscT = 0;
  function osc() {
    const cv = $("ls-osc"), box = cv.parentElement, w = box.clientWidth, h = box.clientHeight;
    if (cv.width !== w) { cv.width = w; cv.height = h; }
    const g = cv.getContext("2d"), on = mode === "radio" ? !ra().paused : !lv().paused; g.clearRect(0, 0, w, h);
    oscT += on ? .09 : .015; const amp = on ? h * .16 : h * .03;
    [["#18f0ff", 0], ["#ff2bd6", 2.1]].forEach(([c, ph]) => {
      g.strokeStyle = c; g.lineWidth = 2; g.shadowColor = c; g.shadowBlur = 10; g.beginPath();
      for (let x = 0; x <= w; x += 4) { const y = h * .72 + Math.sin(x * .018 + oscT * 3 + ph) * amp * Math.sin(x * .004 + oscT) + (on ? (Math.random() - .5) * amp * .35 : 0); x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    });
    if (!reduceMotion) requestAnimationFrame(osc);
  }

  /* ---------- controls ---------- */
  function tuneIn() { ac(); want = true; if (mode === "live") playLive(); else startRadio(); paintNow(); }
  function pause() { want = false; if (mode === "live") lv().pause(); else stopRadio(); paintNow(); }
  function toggle() { const playing = mode === "live" ? !lv().paused : !ra().paused; playing ? pause() : tuneIn(); }

  async function onStatus() {
    if (C.live?.live) goLive(); else endLive();
  }
  async function tick() {
    paintClock();
    if (mode !== "radio" || !sched) return;
    if (Date.now() >= sched.fetchedAt + (sched.ep.sec - sched.offset) * 1000) { await nextShow(); return; }
    const a = ra(); if (want && !hold && !a.paused && a.readyState > 2 && Math.abs(a.currentTime - pos()) > 8) a.currentTime = pos();
  }

  async function init() {
    $("ls-play").addEventListener("click", toggle);
    $("ls-tap").addEventListener("click", () => { ac(); want = true; playLive(); });
    $("ls-clip").addEventListener("click", () => clip(30));
    $("ls-full").addEventListener("click", () => { const v = lv(); (v.requestFullscreen || v.webkitEnterFullscreen)?.call(v); });
    $("ls-replay").addEventListener("click", e => { const id = +e.currentTarget.dataset.replay; if (id) { e.preventDefault(); want = false; stopRadio(); Replay.loadAt(id, Math.max(0, pos() - 5)); } });
    $("livebar").addEventListener("click", () => { if (mode === "live") { ac(); want = true; playLive(); } });
    document.addEventListener("page", e => { if (e.detail === "listen") $("livebar").hidden = true; else if (mode === "live" && lv().paused) $("livebar").hidden = false; });
    document.addEventListener("status", onStatus);
    document.addEventListener("episodes-changed", () => { if (!C.api) refresh(); });
    [ra(), lv()].forEach(el => {
      ["play", "pause", "playing"].forEach(ev => el.addEventListener(ev, () => { if (ev === "pause" && !switching && el === (mode === "live" ? lv() : ra())) want = false; paintNow(); }));
    });
    ra().addEventListener("ended", () => nextShow());
    ra().addEventListener("error", () => { if (ra().getAttribute("src")) $("ls-note").textContent = "This show's audio didn't load. The next one starts on schedule."; });
    lv().addEventListener("loadedmetadata", () => { $("ls-art").hidden = lv().videoWidth > 0; $("screen").classList.toggle("has-video", lv().videoWidth > 0); });
    await refresh(); paintNow(); paintClock(); setInterval(tick, 1000); osc();
    if (C.live?.live) goLive();
  }
  return { init, tuneIn, get mode() { return mode; }, get hold() { return hold; }, set hold(v) { hold = !!v; } };
})();
