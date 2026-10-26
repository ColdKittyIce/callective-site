/* The patch bay: 40 mystery jacks, each a real moment off the air. No names on the board: you find out what's
   behind a jack by patching it. Every patch goes onto the tape in order; play the tape back, put the whole
   tape on one line (conference), or send it to the clip lab as one clip. */
const SB = (() => {
  const COLORS = ["#18f0ff", "#ff2bd6", "#e9ff3b", "#8a5bff", "#3bffb4", "#ff7a00"];
  const EXCH = ["KLONDIKE", "BUTTERFIELD", "PENNSYLVANIA", "TRAFALGAR", "MURRAY HILL", "ELDORADO", "SUNSET", "LOCUST"];
  const TAPE_MAX = 12;
  let jacks = [], tape = [], playing = null, colorI = 0;

  // shuffle the clips onto exchanges every visit, so the board is a mystery every time
  function build() {
    const clips = [...C.clips].sort(() => Math.random() - .5), ex = [...EXCH].sort(() => Math.random() - .5).slice(0, 4), per = Math.ceil(clips.length / 4);
    jacks = clips.map((c, i) => { const e = ex[Math.floor(i / per)]; return { k: c.k, sec: c.sec, ex: e, code: `${e.slice(0, 2)}${(i % per) + 1}-${String(1000 + Math.floor(Math.random() * 9000))}` }; });
    $("strips").innerHTML = ex.map(e => `<div class="strip"><h3>${e}</h3><div class="jacks">${jacks.filter(j => j.ex === e).map(j =>
      `<button class="jack" type="button" data-k="${j.k}" aria-label="Mystery line ${j.code}"><span class="lmp"></span><span class="hole"></span><span class="jk">${j.code.split("-")[0]}</span></button>`).join("")}</div></div>`).join("");
    tape = []; paintTape(); drawCords();
  }
  const J = k => jacks.find(j => j.k === k);

  function jackPoint(k) {
    const j = document.querySelector(`.jack[data-k="${k}"] .hole`), p = $("panel");
    if (!j) return null; const a = j.getBoundingClientRect(), b = p.getBoundingClientRect();
    return [a.left + a.width / 2 - b.left, a.top + a.height / 2 - b.top];
  }
  function drawCords() {
    const p = $("panel"), w = p.clientWidth, h = p.clientHeight, svg = $("cords");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const seen = new Set();
    svg.innerHTML = tape.map((t, i) => {
      if (seen.has(t.k)) return ""; seen.add(t.k);
      const pt = jackPoint(t.k); if (!pt) return "";
      const ox = w * (.12 + .76 * (i / Math.max(1, TAPE_MAX - 1))), oy = h + 14, [x, y] = pt, sag = Math.min(160, h * .45);
      const d = `M${ox},${oy} C${ox},${oy - sag * .4} ${x},${y + sag} ${x},${y}`;
      return `<path class="shadow" d="${d}" transform="translate(2,3)"/><path d="${d}" stroke="${t.color}" style="filter:drop-shadow(0 0 5px ${t.color})"/><circle cx="${x}" cy="${y}" r="7" fill="${t.color}"/>`;
    }).join("");
  }
  function paintTape(cur = -1) {
    $("sb-tape").innerHTML = tape.length ? tape.map((t, i) => `<li class="${i === cur ? "now" : ""}"><button type="button" data-rm="${i}" style="--c:${t.color}" title="Take it off the tape"><b>${i + 1}</b><span>${J(t.k)?.code || "?"}</span></button></li>`).join("")
      : `<li class="empty">The tape is blank. Patch a jack to record it.</li>`;
    const n = tape.length, sec = tape.reduce((s, t) => s + (J(t.k)?.sec || 0), 0);
    $("sb-count").textContent = n ? `${n} of ${TAPE_MAX} · ${sec.toFixed(1)}s` : `0 of ${TAPE_MAX}`;
    ["sb-play", "sb-conf", "sb-lab"].forEach(id => $(id).disabled = !n && id !== "sb-conf");
  }
  const say = (who, line, sub) => { $("sb-who").textContent = who; $("sb-line").textContent = line; $("sb-sub").textContent = sub; };

  // play one jack, no names shown anywhere: it's a mystery line
  function sound(k, vol = 1) {
    const a = new Audio(`clips/${k}.mp3`); a.volume = vol; clipPlayers.add(a); a.addEventListener("ended", () => clipPlayers.delete(a)); a.play().catch(() => {});
    const jack = document.querySelector(`.jack[data-k="${k}"]`); jack?.classList.add("on", "played"); a.addEventListener("ended", () => jack?.classList.remove("on"));
    return a;
  }
  function patch(k) {
    const j = J(k); if (!j) return; ac(); click(0, .5);
    if (tape.length >= TAPE_MAX) { toast(`The tape's full (${TAPE_MAX}). Play it, or tap a spot on the tape to erase it.`); }
    else { tape.push({ k, color: COLORS[colorI++ % COLORS.length] }); }
    stopAll(); sound(k); paintTape(); drawCords();
    say(`Mystery line ${j.code}`, "Patched through.", tape.length >= TAPE_MAX ? "Tape's full." : `On the tape at #${tape.length}. Patch another, then hit ▶ Play the tape.`);
  }
  function stopAll() { if (playing) { playing.stop = true; playing = null; } stopClips(); document.querySelectorAll(".jack.on").forEach(j => j.classList.remove("on")); }
  function playTape() {
    if (!tape.length) return; stopAll(); const run = playing = { stop: false }; let i = 0;
    const next = () => {
      if (run.stop) return;
      if (i >= tape.length) { paintTape(); say("End of tape", "That's the whole call.", "Play it again, put it all on one line, or send it to the clip lab."); playing = null; return; }
      const t = tape[i]; paintTape(i); say(`Tape · ${i + 1} of ${tape.length}`, `Mystery line ${J(t.k)?.code || ""}`, "Playing back in the order you patched.");
      const a = sound(t.k); i++; a.addEventListener("ended", () => setTimeout(next, 140)); a.addEventListener("error", () => setTimeout(next, 50));
    };
    SFX.pickup(); setTimeout(next, 250);
  }
  function conference(n = 4) {
    stopAll(); let list = tape.map(t => t.k);
    if (!list.length) { list = [...jacks].sort(() => Math.random() - .5).slice(0, n).map(j => j.k); list.forEach(k => tape.push({ k, color: COLORS[colorI++ % COLORS.length] })); paintTape(); drawCords(); }
    list.forEach((k, i) => setTimeout(() => sound(k, .85), i * 380));
    say("Conference call", "Everybody's on the line at once.", `${list.length} mystery lines, all at once. God help the operator.`);
  }
  function clear() { stopAll(); tape = []; paintTape(); drawCords(); SFX.hangup(); say("Operator", "Number please?", "Tap a jack. Every jack is a mystery until you patch it."); }
  // stitch the tape into one buffer and open it in the clip lab
  async function toLab() {
    if (!tape.length) return; say("Splicing the tape", "One sec…", "Stitching your calls together.");
    try {
      const a = ac(), bufs = [];
      for (const t of tape) bufs.push(await a.decodeAudioData(await (await fetch(`clips/${t.k}.mp3`)).arrayBuffer()));
      const sr = 44100, gap = Math.round(sr * .15), len = bufs.reduce((s, b) => s + Math.ceil(b.duration * sr) + gap, 0);
      const off = new OfflineAudioContext(2, len, sr); let at = 0;
      for (const b of bufs) { const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start(at / sr); at += Math.ceil(b.duration * sr) + gap; }
      const out = await off.startRendering();
      Lab.loadBuffer(out, `Patch bay tape (${tape.length} lines)`); go("lab");
    } catch (e) { toast("Couldn't splice the tape. Try again."); }
  }
  function init() {
    build();
    $("strips").addEventListener("click", e => { const j = e.target.closest(".jack"); if (j) patch(j.dataset.k); });
    $("sb-tape").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (!b) return; tape.splice(+b.dataset.rm, 1); paintTape(); drawCords(); click(0, .3); });
    $("sb-random").addEventListener("click", () => patch(pick(jacks).k));
    $("sb-play").addEventListener("click", playTape);
    $("sb-conf").addEventListener("click", () => conference(4));
    $("sb-clear").addEventListener("click", clear);
    $("sb-shuffle").addEventListener("click", () => { stopAll(); build(); say("Operator", "The board's been rewired.", "Every jack moved. Good luck."); click(0, .4); });
    $("sb-lab").addEventListener("click", toLab);
    new ResizeObserver(() => drawCords()).observe($("panel"));
  }
  return { init, patch, conference };
})();
