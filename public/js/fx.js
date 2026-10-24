/* Atmosphere: boot screen, keypad rain, cursor trail, glitches, ticker, hold.fm visualizer. Purely visual. */
const FX = (() => {
  const touch = matchMedia("(pointer: coarse)").matches;

  function boot() {
    let seen = false; try { seen = sessionStorage.getItem("cx-booted") === "1"; } catch (e) {}
    if (seen || reduceMotion) return;
    try { sessionStorage.setItem("cx-booted", "1"); } catch (e) {}
    const el = $("boot"); el.hidden = false;
    const lines = [
      "&gt; CALLECTIVE OS v4.20 // COLD BOOT",
      "&gt; LINKING WORLD OF PRANK CALLS ............ <b>OK</b>",
      "&gt; LOADING EPISODE ARCHIVE ................. <b>OK</b>",
      "&gt; PATCHING 40 JACKS ....................... <b>OK</b>",
      "&gt; IRA.EXE: READING THE RULES .............. <i>STANDBY</i>",
      "&gt; DIAL TONE ACQUIRED <span class=\"caret\"></span>"];
    el.innerHTML = `<div class="skip">tap to skip</div>`;
    let i = 0, done = false;
    const finish = () => { if (done) return; done = true; el.classList.add("out"); setTimeout(() => { el.hidden = true; el.classList.remove("out"); }, 520); };
    const step = () => { if (done) return; if (i < lines.length) { const d = document.createElement("div"); d.className = "ln"; d.innerHTML = lines[i++]; el.insertBefore(d, el.lastChild); setTimeout(step, 210); } else setTimeout(finish, 650); };
    el.addEventListener("click", finish); document.addEventListener("keydown", finish, { once: true });
    step(); setTimeout(finish, 3200);
  }

  function rain() {
    const cv = $("rain"); if (!cv || reduceMotion) return; const g = cv.getContext("2d");
    const chars = "0123456789*#ABCD☎".split(""); let cols = [], w = 0, h = 0, fs = 16;
    const size = () => { w = cv.width = innerWidth; h = cv.height = innerHeight; cols = Array.from({ length: Math.ceil(w / fs / 2) }, () => Math.random() * -h / fs); };
    size(); addEventListener("resize", size);
    let last = 0;
    const draw = t => {
      if (t - last > 70 && !document.hidden) {
        last = t; g.fillStyle = "rgba(5,4,12,.16)"; g.fillRect(0, 0, w, h); g.font = `${fs}px "VT323", monospace`;
        cols.forEach((y, i) => { const x = i * fs * 2; g.fillStyle = Math.random() < .04 ? "#ff2bd6" : "#18f0ff"; g.fillText(chars[(Math.random() * chars.length) | 0], x, y * fs);
          cols[i] = y * fs > h && Math.random() > .97 ? 0 : y + 1; });
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  function trail() {
    const cv = $("trail"); if (!cv || touch || reduceMotion) { if (cv) cv.remove(); return; }
    const g = cv.getContext("2d"); let pts = [];
    const size = () => { cv.width = innerWidth; cv.height = innerHeight; }; size(); addEventListener("resize", size);
    addEventListener("pointermove", e => { if (e.pointerType !== "mouse") return; pts.push({ x: e.clientX, y: e.clientY, life: 1, c: Math.random() < .5 ? "24,240,255" : "255,43,214" }); if (pts.length > 60) pts.shift(); });
    const draw = () => {
      g.clearRect(0, 0, cv.width, cv.height);
      for (const p of pts) { p.life -= .045; if (p.life <= 0) continue; g.fillStyle = `rgba(${p.c},${p.life * .8})`; g.shadowColor = `rgb(${p.c})`; g.shadowBlur = 10; g.fillRect(p.x - 2, p.y - 2, 4 * p.life + 1, 4 * p.life + 1); }
      pts = pts.filter(p => p.life > 0); requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  function glitches() {
    if (reduceMotion) return;
    setInterval(() => {
      if (document.hidden) return;
      const vis = [...document.querySelectorAll(".glitch")].filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
      const el = vis[(Math.random() * vis.length) | 0]; if (!el) return;
      el.classList.add("glitching"); setTimeout(() => el.classList.remove("glitching"), 380);
    }, 3800);
  }

  function ticker() {
    const msgs = ["Live Saturdays 7PM ET", "Drop a PLA bell to get in line", "Dial 0 for the operator", "Clip it. Send it. Get on the board.",
      "Follow the rules of WOPC", "We dial to make you smile", "Some numbers aren't listed", "Tom Man: pranks without mercy"];
    const one = msgs.map(m => `${m}<span>///</span>`).join("");
    $("tickertxt").innerHTML = one + one;
  }

  /* hold.fm spectrum */
  let an = null, data = null;
  function hookViz() {
    if (an || reduceMotion) return; const a = ac(); if (!a) return;
    try { const src = a.createMediaElementSource($("holdaud")); an = a.createAnalyser(); an.fftSize = 128; data = new Uint8Array(an.frequencyBinCount); src.connect(an); an.connect(a.destination); } catch (e) { an = null; return; }
    const cv = $("viz"), g = cv.getContext("2d");
    const draw = () => {
      const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); an.getByteFrequencyData(data);
      const n = 40, bw = w / n;
      for (let i = 0; i < n; i++) { const v = data[i] / 255, bh = Math.max(2, v * (h - 6)); const grd = g.createLinearGradient(0, h, 0, h - bh); grd.addColorStop(0, "#18f0ff"); grd.addColorStop(1, "#ff2bd6");
        g.fillStyle = grd; g.shadowColor = "#ff2bd6"; g.shadowBlur = 8; g.fillRect(i * bw + 1, h - bh, bw - 3, bh); }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }
  function idleViz() {
    const cv = $("viz"); if (!cv) return; const g = cv.getContext("2d"), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; g.scale(dpr, dpr); g.strokeStyle = "#18f0ff"; g.shadowColor = "#18f0ff"; g.shadowBlur = 8; g.lineWidth = 2;
    g.beginPath(); for (let x = 0; x <= w; x += 4) g.lineTo(x, h / 2 + Math.sin(x / 18) * 6); g.stroke();
  }

  function init() {
    boot(); rain(); trail(); glitches(); ticker(); idleViz();
    $("holdaud").addEventListener("play", hookViz);
  }
  return { init };
})();
