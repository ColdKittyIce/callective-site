/* Callective bingo. Cards are dealt from a seed, so a card link gives a friend the same squares. Marks stay in this browser. */
const Bingo = (() => {
  const POOL = [
    "Someone asks “is this a prank call?”", "They hang up in under 10 seconds", "All Call!", "A pizza order call", "A hotel call",
    "Group singing call", "PLA bell storm in chat", "The Technical Issues song plays", "The host has to pee", "Somebody's mic is way too loud",
    "They threaten to call the cops", "They call back", "Fart noise on the line", "Sexy Fartman shows up", "101.1 The Butt gets a mention",
    "Tom Servo robot voice", "“Who is this?”", "They play along the whole time", "Caller cracks up and breaks character", "Straight to voicemail, so we leave a message",
    "Hold music on their end", "Chat begs Ira to read the rules again", "Three “hello?”s before anyone talks", "“Let me get my manager”", "A call goes over 10 minutes",
    "Dead air", "Somebody forgets to unmute", "Discord echo / feedback", "Host runs !next", "Somebody gets skipped in the queue",
    "Gif storm in chat", "Fake accent", "A soundboard drop", "A drive-thru call", "They curse everyone out",
    "A call to the same number twice", "Someone says “Callective” to the victim", "Chat says “LMAO” 5 times in a row", "Host's internet dies", "A birthday song",
    "Someone gets hired (or fired) on the call", "A kid answers, so we hang up", "Call to a business that's closed", "Someone orders something absurd", "Recipient asks for our name",
    "Someone does a Tom Man voice", "A dog barks on somebody's mic", "The farewell song plays"];
  const FREE = "FREE: Ira reads the rules";
  let seed = 0, marks = new Set(), blackout = false, won = false, squares = [];
  function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function deal(s) {
    const r = rng(s), a = POOL.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const card = a.slice(0, 24); card.splice(12, 0, FREE); return card;
  }
  const key = () => `cx-bingo-${seed}`;
  function save() { try { localStorage.setItem(key(), JSON.stringify([...marks])); localStorage.setItem("cx-bingo-seed", seed); localStorage.setItem("cx-bingo-mode", blackout ? "1" : ""); } catch (e) {} }
  function load(s) {
    seed = s; squares = deal(seed); marks = new Set([12]); won = false;
    try { JSON.parse(localStorage.getItem(key()) || "[]").forEach(i => marks.add(+i)); } catch (e) {}
    $("bg-no").textContent = "#" + String(seed).padStart(4, "0").slice(-4); render(); check(true);
  }
  const LINES = (() => { const L = []; for (let i = 0; i < 5; i++) { L.push([0, 1, 2, 3, 4].map(j => i * 5 + j)); L.push([0, 1, 2, 3, 4].map(j => j * 5 + i)); }
    L.push([0, 6, 12, 18, 24]); L.push([4, 8, 12, 16, 20]); return L; })();
  function render(win = []) {
    $("bingogrid").innerHTML = squares.map((t, i) => `<button type="button" class="sq${marks.has(i) ? " on" : ""}${i === 12 ? " free" : ""}${win.includes(i) ? " win" : ""}" data-i="${i}" role="gridcell" aria-pressed="${marks.has(i)}"><span>${esc(t.replace(/^FREE: /, ""))}</span>${i === 12 ? "<em>FREE</em>" : ""}</button>`).join("");
    const n = marks.size - 1; $("bg-count").textContent = `${n} of 24 marked`; $("bg-meter").style.width = (n / 24 * 100) + "%";
  }
  function check(quiet) {
    const win = blackout ? (marks.size === 25 ? [...Array(25).keys()] : null) : (LINES.find(l => l.every(i => marks.has(i))) || null);
    const best = Math.max(...LINES.map(l => l.filter(i => marks.has(i)).length));
    if (win) { render(win); $("bg-status").textContent = blackout ? "BLACKOUT. Absolute legend." : "BINGO!"; if (!won && !quiet) celebrate(); won = true; }
    else { won = false; $("bg-status").textContent = blackout ? `Blackout: ${25 - marks.size} to go.` : best >= 4 ? "One away. Somebody dial something." : marks.size > 1 ? `Best line: ${best} of 5.` : "Mark a square to start."; }
  }
  function celebrate() {
    SFX.ringback(1); setTimeout(() => { SFX.pickup(); const ks = ["dogs-woo", "tom-yeaugh", "icecat-hey-hey", "ira-woomp"].filter(k => C.clips.some(c => c.k === k)); if (ks.length) playClip(pick(ks)); }, 900);
    confetti();
    setTimeout(() => openTakeover(`<div class="card" style="padding:26px;display:flex;flex-direction:column;gap:14px;max-width:560px;text-align:center"><b class="bingo-win">BINGO!</b><p>${blackout ? "Every square. You stayed for the whole show." : "Five in a row. Type BINGO in the chat and make it everyone's problem."}</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn mustard" type="button" data-close id="bg-again">Keep playing</button><a class="btn" href="#listen" data-close>Back to the show</a></div></div>`), 700);
  }
  function confetti() {
    if (reduceMotion) return; const cv = $("confetti"), box = $("bingobox"), w = cv.width = box.clientWidth, h = cv.height = box.clientHeight, g = cv.getContext("2d");
    const cols = ["#18f0ff", "#ff2bd6", "#e9ff3b", "#8a5bff"], ps = Array.from({ length: 140 }, () => ({ x: w / 2, y: h / 2, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 3, c: pick(cols), s: 3 + Math.random() * 5, r: Math.random() * 6 }));
    let f = 0; const step = () => { g.clearRect(0, 0, w, h); for (const p of ps) { p.vy += .4; p.x += p.vx; p.y += p.vy; p.r += .2; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.shadowColor = p.c; g.shadowBlur = 8; g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.6); g.restore(); } if (++f < 120) requestAnimationFrame(step); else g.clearRect(0, 0, w, h); };
    requestAnimationFrame(step);
  }
  function fromHash() { const m = location.hash.match(/^#bingo\/(\d{1,9})$/); return m ? +m[1] : null; }
  function init() {
    let s = fromHash(); try { blackout = localStorage.getItem("cx-bingo-mode") === "1"; if (s == null) s = +localStorage.getItem("cx-bingo-seed") || 0; } catch (e) {}
    if (!s) s = 1 + Math.floor(Math.random() * 99999);
    $("bg-mode").setAttribute("aria-pressed", String(blackout)); load(s);
    $("bingogrid").addEventListener("click", e => {
      const b = e.target.closest(".sq"); if (!b) return; const i = +b.dataset.i; if (i === 12) return;
      marks.has(i) ? marks.delete(i) : (marks.add(i), click(0, .4)); save(); render(); check(false);
    });
    $("bg-new").addEventListener("click", () => { SFX.ringback(1); load(1 + Math.floor(Math.random() * 99999)); save(); toast("Fresh card dealt."); });
    $("bg-clear").addEventListener("click", () => { marks = new Set([12]); save(); render(); check(true); });
    $("bg-mode").addEventListener("click", e => { blackout = !blackout; e.currentTarget.setAttribute("aria-pressed", String(blackout)); save(); render(); check(true); });
    $("bg-share").addEventListener("click", async () => {
      const url = location.href.split("#")[0] + "#bingo/" + seed;
      try { await navigator.clipboard.writeText(url); toast("Card link copied. Send it to a friend."); } catch (e) { toast(url); }
    });
    addEventListener("hashchange", () => { const h = fromHash(); if (h && h !== seed) load(h); });
  }
  return { init };
})();
