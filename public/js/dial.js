/* The rotary dial. Drag a finger hole to the stop (or tap it) and let go. Letters map like an old phone. */
const Dial = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const CX = 200, CY = 200, HOLE_R = 140, STOP = 135;
  const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  const LETTERS = { 2: "ABC", 3: "DEF", 4: "GHI", 5: "JKL", 6: "MNO", 7: "PQRS", 8: "TUV", 9: "WXYZ", 0: "OPER" };
  const L2D = {}; for (const [d, ls] of Object.entries(LETTERS)) if (d !== "0") for (const l of ls) L2D[l] = d;
  const holeAngle = k => STOP - 30 * (k + 1) - 6;
  const need = k => 30 * (k + 1) + 6;
  const pos = (a, r) => [CX + r * Math.sin(a * Math.PI / 180), CY - r * Math.cos(a * Math.PI / 180)];
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };

  let svg, wheel, busy = false, rot = 0, buffer = "", commitT = null, queue = [];

  function build(box) {
    svg = el("svg", { viewBox: "0 0 400 400", role: "img", "aria-label": "Rotary phone dial. Tap or drag a finger hole to dial." }, box);
    const defs = el("defs", {}, svg);
    const mask = el("mask", { id: "holes" }, defs);
    el("rect", { x: 0, y: 0, width: 400, height: 400, fill: "#fff" }, mask);
    DIGITS.forEach((d, k) => { const [x, y] = pos(holeAngle(k), HOLE_R); el("circle", { cx: x, cy: y, r: 25, fill: "#000" }, mask); });
    const grad = el("radialGradient", { id: "wheelg", cx: "40%", cy: "35%", r: "75%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#18f0ff", "stop-opacity": ".22" }, grad); el("stop", { offset: "100%", "stop-color": "#3b1a6b", "stop-opacity": ".55" }, grad);
    const glow = el("filter", { id: "neon", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs); el("feGaussianBlur", { stdDeviation: 3.2, result: "b" }, glow); const mg = el("feMerge", {}, glow); el("feMergeNode", { in: "b" }, mg); el("feMergeNode", { in: "SourceGraphic" }, mg);
    const tint = el("filter", { id: "tint" }, defs); el("feColorMatrix", { type: "matrix", values: "0 0 0 0 0.09  0 0 0 0 0.94  0 0 0 0 1  0 0 0 1 0" }, tint);

    el("circle", { cx: CX, cy: CY, r: 198, fill: "#05040c", stroke: "#ff2bd6", "stroke-width": 2, filter: "url(#neon)" }, svg);
    el("circle", { cx: CX, cy: CY, r: 188, fill: "#0a0919", stroke: "#18f0ff55", "stroke-width": 1 }, svg);
    for (let i = 0; i < 60; i++) { const [x1, y1] = pos(i * 6, 191), [x2, y2] = pos(i * 6, i % 5 ? 194 : 197); el("line", { x1, y1, x2, y2, stroke: i % 5 ? "#18f0ff55" : "#ff2bd6", "stroke-width": 1.2 }, svg); }
    // number plate under the wheel
    DIGITS.forEach((d, k) => {
      const [x, y] = pos(holeAngle(k), HOLE_R);
      el("circle", { cx: x, cy: y, r: 25, fill: "#05040c", stroke: "#18f0ff33" }, svg);
      const t = el("text", { x, y: y + 3, "text-anchor": "middle", "font-family": "VT323, monospace", "font-size": 30, fill: "#18f0ff", filter: "url(#neon)" }, svg); t.textContent = d;
      const l = el("text", { x, y: y + 15, "text-anchor": "middle", "font-family": "Share Tech Mono, monospace", "font-size": 8.5, "letter-spacing": 1, fill: "#ff2bd6" }, svg); l.textContent = LETTERS[d] || "";
    });
    // the wheel
    wheel = el("g", { id: "wheel" }, svg);
    el("circle", { cx: CX, cy: CY, r: 180, fill: "url(#wheelg)", mask: "url(#holes)", stroke: "#18f0ff", "stroke-width": 2.5, filter: "url(#neon)" }, wheel);
    el("circle", { cx: CX, cy: CY, r: 166, fill: "none", stroke: "#ff2bd655", "stroke-width": 1, "stroke-dasharray": "3 6", mask: "url(#holes)" }, wheel);
    el("circle", { cx: CX, cy: CY, r: 104, fill: "none", stroke: "#18f0ff44", "stroke-width": 1, mask: "url(#holes)" }, wheel);
    DIGITS.forEach((d, k) => {
      const [x, y] = pos(holeAngle(k), HOLE_R);
      el("circle", { cx: x, cy: y, r: 25, fill: "none", stroke: "#ff2bd6", "stroke-width": 2, filter: "url(#neon)" }, wheel);
      const hit = el("circle", { cx: x, cy: y, r: 27, fill: "transparent", class: "hole", "data-k": k, tabindex: -1 }, wheel);
      hit.addEventListener("pointerdown", ev => down(ev, k));
    });
    // center card (stays still)
    el("circle", { cx: CX, cy: CY, r: 74, fill: "#05040c", stroke: "#18f0ff", "stroke-width": 1.5, filter: "url(#neon)" }, svg);
    el("image", { href: "img/mark.webp", x: CX - 58, y: CY - 58, width: 116, height: 116, filter: "url(#tint)" }, svg);
    // finger stop
    const [sx, sy] = pos(STOP + 2, 178);
    const stop = el("g", { transform: `rotate(${STOP + 2} ${sx} ${sy})` }, svg);
    el("rect", { x: sx - 6, y: sy - 30, width: 12, height: 40, rx: 4, fill: "#e9ff3b", stroke: "#05040c", "stroke-width": 2, filter: "url(#neon)" }, stop);
    box.tabIndex = 0;
    box.addEventListener("keydown", ev => { const d = toDigit(ev.key); if (d != null) { ev.preventDefault(); enqueue([d]); } });
  }

  function setRot(r) { rot = r; wheel.setAttribute("transform", `rotate(${r} ${CX} ${CY})`); }
  function angleAt(ev) { const b = svg.getBoundingClientRect(); const x = ev.clientX - (b.left + b.width / 2), y = ev.clientY - (b.top + b.height / 2); return Math.atan2(x, -y) * 180 / Math.PI; }

  function down(ev, k) {
    if (busy) return; ev.preventDefault(); ac();
    busy = true; svg.parentElement.classList.add("dragging");
    let last = angleAt(ev), moved = 0; const max = need(k);
    svg.setPointerCapture(ev.pointerId);
    const move = e => { const a = angleAt(e); let d = a - last; if (d > 180) d -= 360; if (d < -180) d += 360; last = a; moved += Math.abs(d); setRot(clamp(rot + d, 0, max)); };
    const up = () => {
      svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up); svg.removeEventListener("pointercancel", up);
      svg.parentElement.classList.remove("dragging");
      if (moved < 8) { setRot(0); busy = false; enqueue([DIGITS[k]]); return; }
      if (rot >= max - 12) { setRot(max); release(DIGITS[k]); }
      else release(null);
    };
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
  }

  function release(digit, fast) {
    const from = rot, pulses = digit == null ? 0 : (digit || 10);
    // a real rotary recording for hand-dialed digits; quick synth clicks when dialing a typed word
    const real = digit != null && !fast && !reduceMotion ? SFX.rotary(digit) : 0;
    const dur = real ? Math.max(.4, real * .85) : reduceMotion ? 0.15 : Math.max(.25, from / 380);
    if (!real) for (let i = 0; i < pulses; i++) click(dur * (.15 + .8 * i / Math.max(1, pulses)));
    const t0 = performance.now();
    const step = now => { const p = Math.min(1, (now - t0) / (dur * 1000)); setRot(from * (1 - p)); if (p < 1) requestAnimationFrame(step); else { setRot(0); busy = false; if (digit != null) addDigit(digit); next(); } };
    requestAnimationFrame(step);
  }

  function autoDial(digit, fast) {
    busy = true; const k = DIGITS.indexOf(digit), max = need(k), dur = reduceMotion ? .1 : (fast ? max / 900 : max / 520), t0 = performance.now();
    const step = now => { const p = Math.min(1, (now - t0) / (dur * 1000)); setRot(max * p); if (p < 1) requestAnimationFrame(step); else release(digit, fast); };
    requestAnimationFrame(step);
  }
  function enqueue(ds, fast) { queue.push(...ds.map(d => ({ d, fast }))); if (!busy) next(); }
  function next() { const n = queue.shift(); if (n) autoDial(n.d, n.fast); }

  function toDigit(ch) { ch = String(ch).toUpperCase(); if (/^[0-9]$/.test(ch)) return +ch; if (L2D[ch]) return +L2D[ch]; return null; }

  function addDigit(d) {
    buffer += d; show(buffer + (Dir.match(buffer) ? "  " + Dir.match(buffer).word : ""));
    clearTimeout(commitT); commitT = setTimeout(commit, 1500);
  }
  function show(txt, cls) { const o = $("readout"); o.textContent = txt; o.className = cls || ""; }
  async function commit() {
    const num = buffer; buffer = ""; if (!num) return;
    const hit = Dir.find(num);
    if (!hit) { show("NOT IN SERVICE", "err"); const t = SFX.sit(); setTimeout(() => show("The number you dialed is not in service. Check the directory and dial again.", "err"), t * 1000); return; }
    show(`Calling ${hit.word}…`, "ok"); const wait = num === "0" ? .3 : SFX.ringback(1);
    setTimeout(() => { SFX.pickup(); show(`${hit.word}: ${hit.label}`, "ok"); hit.act(); }, wait * 800);
  }
  function hangup() { buffer = ""; queue = []; clearTimeout(commitT); SFX.hangup(); show("DIAL A NUMBER"); closeTakeover(); stopClips(); }

  function dialString(s) {
    const ds = [...String(s).toUpperCase()].map(toDigit).filter(d => d != null);
    if (!ds.length) { toast("Type numbers or letters, like RULES or 78537."); return; }
    buffer = ""; enqueue(ds, true);
    if (Router.page !== "home") Router.go("dial"); else document.getElementById("dial").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  function init() {
    build($("dialbox"));
    $("hangup").addEventListener("click", hangup);
    $("dialform").addEventListener("submit", e => { e.preventDefault(); const v = $("dialtype").value.trim(); if (v) { dialString(v); $("dialtype").value = ""; } });
    document.addEventListener("click", e => { const b = e.target.closest("[data-dial]"); if (b) dialString(b.dataset.dial); });
    Dir.render();
  }
  return { init, dialString, toDigit };
})();

/* ---------- the directory and what each number does ---------- */
function openTakeover(html) { const t = $("takeover"); t.innerHTML = html; t.classList.add("show"); t.querySelector("button")?.focus(); }
function closeTakeover() { const t = $("takeover"); t.classList.remove("show"); t.innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTakeover(); });
document.addEventListener("click", e => { if (e.target.id === "takeover" || e.target.closest("[data-close]")) closeTakeover(); });

function setMode(m) {
  document.body.dataset.mode = m || "";
  $("brandname").textContent = { dog: "THE DOGLECTIVE", hell: "THE HELLECTIVE", ding: "THE DINGLECTIVE" }[m] || "THE CALLECTIVE";
  try { m ? localStorage.setItem("cx-mode", m) : localStorage.removeItem("cx-mode"); } catch (e) {}
}
const go = id => Router.go(id);
const pick = a => a[Math.floor(Math.random() * a.length)];

const Dir = (() => {
  const W2N = w => [...w].map(ch => Dial.toDigit(ch)).join("");
  const E = [
    { word: "OPERATOR", num: "0", label: "Operator (resets everything)", listed: true, act() { setMode(""); toast("Operator here. Everything's back to normal."); } },
    { word: "RULES", label: "Ira reads the rules", listed: true, act() { Hold.play("ira-rules"); go("rules"); } },
    { word: "THEME", label: "The theme song", listed: true, act() { Hold.play("theme"); } },
    { word: "QUEUE", label: "Get in line", listed: true, act() { go("line"); } },
    { word: "RADIO", label: "Callective Radio, 24/7", listed: true, act() { go("listen"); Listen.tuneIn(); } },
    { word: "REPLAY", label: "Replay a show", listed: true, act() { go("replay"); } },
    { word: "BINGO", label: "Callective bingo", listed: true, act() { go("bingo"); } },
    { word: "CLIPS", label: "The clip board", listed: true, act() { go("clips"); } },
    { word: "HOLD", label: "Hold music", listed: true, act() { go("downloads"); Hold.play(pick(["jingle", "theme-2026", "badly-sung", "church", "lullaby"])); } },
    { word: "WOPC", label: "The Discord", listed: true, act() { openTakeover(`<div class="card" style="padding:22px;display:flex;flex-direction:column;gap:14px;max-width:520px"><b style="font-family:var(--f-display);font-size:40px;font-weight:400">World of Prank Calls</b><p>The Callective happens in the WOPC Discord voice channel every Saturday at 7pm Eastern.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn blue" href="https://discord.gg/NCHd2Mp5km" target="_blank" rel="noopener">Join the Discord</a><button class="btn" type="button" data-close>Hang up</button></div></div>`); } },
    { word: "DOG", label: "The Doglective", act() { setMode("dog"); Hold.play("doglective"); toast("You've reached the Doglective. Dial 0 to get back."); } },
    { word: "HELL", label: "The Hellective", act() { setMode("hell"); Hold.play("hellective"); toast("Welcome to the Hellective. Dial 0 to escape."); } },
    { word: "DING", label: "Dingtember", act() { setMode("ding"); Hold.play("dinglective"); toast("It's always Dingtember on this line. Dial 0 to leave."); } },
    { word: "TOMMAN", label: "Pranks without mercy", act() { playClip("tom-yeaugh"); openTakeover(`<div class="card"><img src="img/tomman.webp" alt="Tom Man on a payphone"><div class="halftone"></div><div class="burst">HAHAHAHA!</div><div class="cap"><b>TOM MAN: PRANKS WITHOUT MERCY</b><button class="btn red" type="button" data-close>Hang up</button></div></div>`); } },
    { word: "PEE", label: "Host has to pee", act() { Hold.play("host-has-to-pee"); openTakeover(`<div class="card"><img src="img/bathroom-bathroom.webp" alt="The robot holds the bathroom door shut while Ira waits, desperate"><div class="cap"><b>BRB. THE HOST HAS TO PEE.</b><button class="btn" type="button" data-close>Wait it out</button></div></div>`); } },
    { word: "BREAK", label: "Taking a break", act() { Hold.play("jingle"); openTakeover(`<div class="card"><img src="img/break-2.webp" alt="The cast on a break backstage in the alley"><div class="cap"><b>WE'RE ON A BREAK. DON'T TOUCH THE PHONES.</b><button class="btn" type="button" data-close>Back to the show</button></div></div>`); } },
    { word: "TECH", label: "Technical difficulties", act() { Hold.play("technical-issues"); openTakeover(`<div class="card"><img src="img/tech-issues-2.webp" alt="The cast tangled in wires while the robot runs diagnostics"><div class="cap"><b>WE ARE EXPERIENCING TECHNICAL ISSUES</b><button class="btn" type="button" data-close>Jiggle the cable</button></div></div>`); } },
    { word: "GOODBYE", label: "Sign off", act() { Hold.play("farewell"); openTakeover(`<div class="card"><img src="img/goodbye.webp" alt="The cast waving goodbye"><div class="cap"><b>THANKS EVERYONE. WE ❤ U ALL.</b><button class="btn" type="button" data-close>Hang up</button></div></div>`); } },
    { word: "IRA", label: "The Governor", act() { playClip(pick(["ira-my-name", "ira-icecat", "ira-woomp", "ira-governor", "ira-edison"])); } },
    { word: "ICECAT", label: "IceCat", act() { playClip(pick(["icecat-what-call", "icecat-hey-hey"])); } },
    { word: "DOGS", label: "DespicableDogs", act() { playClip(pick(["dogs-woo", "dogs-download", "dogs-im-a-man", "dogs-gutter"])); } },
    { word: "ALLCALL", label: "Everybody on the line", act() { go("switchboard"); SB.conference(5); } },
    { word: "MOD", label: "Crew login", act() { Mod.open(); } },
    { word: "CLIP", label: "The clip board", act() { go("clips"); } },
    { word: "GEOCITIES", label: "Our old homepage", act() { location.href = "1998.html"; } },
    { word: "DNC", label: "Do Not Call Me registry", act() { go("dnc"); } },
    { word: "LIVE", label: "The live show", act() { go("listen"); Listen.tuneIn(); } },
    { word: "MERCH", label: "Downloads", act() { go("downloads"); } },
    { word: "BUTT", label: "101.1 The Butt", act() { SFX.thump(); go("glossary"); toast("You're listening to 101.1 The Butt. You just got buttslammed."); } },
    { word: "CAW", label: "The crow", act() { go("glossary"); toast("CAW."); } },
    { word: "QUACK", label: "Quackers", act() { location.hash = "search/" + encodeURIComponent("by:greenimp"); toast("Quackers has entered the chat."); } },
    { word: "LUNK", label: "The lunk alarm", act() { SFX.ringback(2); toast("🚨 LUNK ALARM 🚨 Put the weights down and step away from the mic."); } },
    { word: "BATHROOM", label: "Bathroom bathroom", act() { toast("BATHROOM! BATHROOM!"); setTimeout(() => toast("…bathroom."), 1600); } },
    { word: "PATRICK", label: "Patrick Fucking Howard", act() { go("line"); toast("Patrick here. I got a badge and I'm usin' it. Get in line."); } },
    { word: "FLESHBAG", label: "You, probably", act() { toast("Hello, fleshbag. Welcome to the Callective."); } },
    { word: "PUMPKIN", label: "The Pumpkin Man", act() { location.hash = "search/pumpkin"; toast("He just wants someone to cover his shift."); } },
    { word: "WRAPPED", label: "Callective Wrapped", act() { go("wrapped"); } },
    { word: "GAMES", label: "Games", act() { go("guess"); } },
    { word: "PREMISE", label: "Dial-a-premise", act() { go("premise"); } },
    { word: "SEARCH", label: "Search", act() { go("search"); } },
    { word: "LORE", label: "The glossary", act() { go("glossary"); } },
    { word: "COURT", label: "Callective Court", act() { go("court"); } }
  ];
  E.forEach(e => { if (!e.num) e.num = W2N(e.word); });
  return {
    find: n => E.find(e => e.num === n),
    match: n => E.find(e => e.num === n && e.listed),
    render() {
      $("dirlist").innerHTML = E.filter(e => e.listed).map(e => `<li><button type="button" data-dial="${e.num}" aria-label="Dial ${e.word}, ${e.label}"><span>${esc(e.label)}</span><b>${e.word === "OPERATOR" ? "0" : e.word}</b></button></li>`).join("");
    }
  };
})();
