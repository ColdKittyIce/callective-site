/* Name That Caller: hear 12 seconds from the middle of a real call (from the 10 newest shows), pick who made it.
   Uses the call lists and the site's own show copies. Nothing is stored; best score stays in this browser. */
const Guess = (() => {
  const ROUNDS = 10, SNIP = 12, NOT_A_PERSON = /^(all call|the host is|unknown caller|deleted user)/i;
  let pool = [], round = 0, score = 0, streak = 0, cur = null, locked = false;
  const aud = () => $("gx-aud"), pick2 = a => a[Math.floor(Math.random() * a.length)];
  function buildPool() {
    const out = [], recent = recentIds();
    for (const e of C.episodes) { if (!recent.has(e.id) || !C.calls[e.id]) continue;
      const L = callsFor(e.id, e.sec).filter(c => !c.skip);
      L.forEach((c, i) => { if (i === 0 || i === L.length - 1 || NOT_A_PERSON.test(c.by) || c.end - c.t < 150) return; out.push({ ...c, e }); }); }
    return out;
  }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function choices(c) {
    const same = [...new Set(callsFor(c.e.id, c.e.sec).map(x => x.by))].filter(n => n !== c.by && !NOT_A_PERSON.test(n));
    const all = [...new Set(pool.map(x => x.by))].filter(n => n !== c.by && !same.includes(n));
    return shuffle([c.by, ...shuffle(same).slice(0, 3), ...shuffle(all)].slice(0, 4));
  }
  function best() { try { return +localStorage.getItem("cx-guess-best") || 0; } catch (e) { return 0; } }
  function paintScore() { $("gx-score").textContent = `Round ${Math.min(round, ROUNDS)} of ${ROUNDS} · Score ${score} · Streak ${streak} · Best ${best()}`; }
  function next() {
    if (round >= ROUNDS) return finish();
    round++; locked = false; const c = pool[Math.floor(Math.random() * pool.length)];
    // somewhere in the middle of the turn, past the dialing
    const from = Math.round(c.t + 60 + Math.random() * Math.max(0, c.end - c.t - 90 - SNIP));
    cur = { c, from, opts: choices(c) };
    $("gx-q").innerHTML = `<p class="gx-hint">${esc(fmtDate(c.e.d))}${c.e.h ? ` · hosted by ${esc(c.e.h)}` : ""}. Who's on the phone?</p>
      <div class="gx-opts">${cur.opts.map(n => `<button class="btn" type="button" data-pick="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <div class="gx-after" id="gx-after"></div>`;
    paintScore(); play();
  }
  function play() {
    if (!cur) return; const a = aud(); a.src = `${C.api}/cut/${cur.c.e.id}?from=${cur.from}&to=${cur.from + SNIP}`;
    Media.claim(a); a.play().catch(() => toast("Tap ▶ Replay snippet to hear it."));
  }
  function pick(name, btn) {
    if (locked) return; locked = true; const ok = name === cur.c.by, c = cur.c;
    if (ok) { score += 10 + Math.min(streak, 5) * 2; streak++; SFX.coin(); } else { streak = 0; SFX.hangup(); }
    $("gx-q").querySelectorAll("[data-pick]").forEach(b => { b.disabled = true; if (b.dataset.pick === c.by) b.classList.add("right"); else if (b === btn) b.classList.add("wrong"); });
    $("gx-after").innerHTML = `<p><b>${ok ? pick2(["Got it.", "Correct. Nerd.", "Nailed it.", "That's the one."]) : pick2(["Nope.", "Buttslammed.", "Wrong line.", "Not even close."])}</b> That was ${esc(c.by)}${c.title ? `: “${esc(c.title)}”` : ""}, ${hms(c.t, true)} into the show.</p>
      <div class="gx-btns"><button class="btn red solid" type="button" id="gx-next">${round >= ROUNDS ? "See your score" : "Next caller →"}</button><button class="btn sm ghost" type="button" data-whole="${c.e.id}" data-t="${c.t}">▶ Hear the whole call</button>${!c.title ? `<button class="btn sm ghost" type="button" data-whole="${c.e.id}" data-t="${c.t}">💡 It needs a title</button>` : ""}</div>`;
    paintScore(); $("gx-next").focus();
  }
  function finish() {
    aud().pause(); const b = best(); if (score > b) try { localStorage.setItem("cx-guess-best", score); } catch (e) {}
    const max = ROUNDS * 20, rank = score >= max * .7 ? "Certified regular. Patrick knows your name. Go touch grass." : score >= max * .4 ? "You know the voices. Mostly. Tiff would be proud-ish." : score > 0 ? "Fresh fleshbag on the line. Keep listening." : "Zero. Were you even listening, or just vibing to the hold music?";
    $("gx-q").innerHTML = `<div class="gx-end"><b>${score}</b><p>${rank}${score > b ? " New personal best." : ""}</p><button class="btn red solid" type="button" id="gx-again">Play again</button></div>`;
    cur = null; paintScore();
  }
  function start() {
    if (!C.api) { $("gx-q").innerHTML = `<p class="feed-empty">The game plays real call audio, so it works on the live site.</p>`; return; }
    pool = buildPool(); if (pool.length < 8) { $("gx-q").innerHTML = `<p class="feed-empty">Not enough calls loaded yet. Try again in a moment.</p>`; return; }
    round = 0; score = 0; streak = 0; next();
  }
  function init() {
    $("gx-start").addEventListener("click", start);
    $("gx-replay").addEventListener("click", play);
    $("gx-q").addEventListener("click", e => {
      const p = e.target.closest("[data-pick]"); if (p) { pick(p.dataset.pick, p); return; }
      if (e.target.closest("#gx-next")) { next(); return; }
      if (e.target.closest("#gx-again")) { start(); return; }
      const w = e.target.closest("[data-whole]"); if (w) { aud().pause(); Replay.loadAt(+w.dataset.whole, +w.dataset.t, true); }
    });
    paintScore();
  }
  return { init };
})();
