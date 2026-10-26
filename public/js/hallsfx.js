/* The Hall's soundboard. Two places a sound can go:
   🔊 Room: everyone in the room hears it (the room tells every browser to play it). Rule 7 applies, so during a call only the caller and mods can.
   📞 My line: plays out of an audio device you pick, like a Voicemeeter or VB-Cable input that feeds your phone line (see the Audio Bible).
   Both can be on at once. With both off, it just previews in your own ears. */
const HallSB = (() => {
  let send = () => false, getMe = () => null, st = null, sounds = [];
  const o = { room: true, line: false, hear: true, dev: "", vol: 0.9 };
  try { Object.assign(o, JSON.parse(localStorage.getItem("cx-hall-sb") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("cx-hall-sb", JSON.stringify(o)); } catch (e) {} };
  const SFX = [["s:ring", "Phone ring"], ["s:pickup", "Pick up"], ["s:hangup", "Hang up"], ["s:slam", "Phone slam"], ["s:coin", "Coin drop"], ["s:page", "Page"], ["s:drop", "Drop"], ["s:setdown", "Set it down"]];
  const url = k => k.startsWith("s:") ? `sfx/${k.slice(2)}.mp3` : `clips/${k.slice(2)}.mp3`;
  const nameOf = k => (sounds.find(x => x.k === k) || {}).t || k.slice(2);

  function playTo(k, sink, v) {
    const a = new Audio(url(k)); a.volume = Math.max(0, Math.min(1, v));
    const go = () => a.play().catch(() => {});
    if (sink && a.setSinkId) a.setSinkId(sink).then(go, () => { toast("Couldn't reach your phone line device. Pick it again in the soundboard."); });
    else go();
    return a;
  }
  function hit(k) {
    const roomOk = o.room && allowed();
    if (o.line) { if (o.dev) playTo(k, o.dev, o.vol); else toast("Pick your phone line output first (📞 My line ▾)."); }
    if (o.room) { if (roomOk) send({ type: "sfx", k }); else { toast(why()); if (!o.line) playTo(k, "", o.vol); } }
    if (!o.room && !o.line) playTo(k, "", o.vol); // preview
  }
  function allowed() {
    if (!st || !st.you) return false; const y = st.you, caller = st.cur && st.cur.id === y.id;
    if (st.sfx === "off") return !!y.host; if (y.mod || caller) return true; if (st.sfx === "mods") return false; return !st.cur;
  }
  function why() { return st && st.sfx === "off" ? "The room soundboard is off." : st && st.sfx === "mods" ? "Room sounds are mods-only right now." : "Rule 7: no sounds during someone's call unless you're invited."; }
  function onSfx(d) { // someone played a sound to the room
    if (o.hear) playTo(d.k, "", o.vol);
    const pad = document.querySelector(`#hl-pads [data-sfx="${CSS.escape(d.k)}"]`); if (pad) { pad.classList.remove("hit"); void pad.offsetWidth; pad.classList.add("hit"); }
    const log = $("hl-log"); if (!log) return;
    const div = document.createElement("div"); div.className = "hl-msg sfxline";
    div.innerHTML = `<span class="hl-t"></span><span class="hl-who">🔊</span><span class="hl-txt">${esc(d.by)} played <b>${esc(nameOf(d.k))}</b></span>`;
    if (d.uid) { div.dataset.uid = d.uid; div.hidden = !!(st && st.you && (st.you.blocks || []).includes(d.uid)); }
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.appendChild(div); if (stick) log.scrollTop = log.scrollHeight;
  }
  function paint() {
    $("hl-sbroom").setAttribute("aria-pressed", String(o.room)); $("hl-sbline").setAttribute("aria-pressed", String(o.line)); $("hl-sbhear").setAttribute("aria-pressed", String(o.hear));
    $("hl-sbhear").textContent = o.hear ? "👂 Hearing room sounds" : "🙉 Room sounds off";
    $("hl-sbvol").value = o.vol;
    const m = st ? st.sfx : "open";
    $("hl-sbmode").textContent = !st ? "" : m === "off" ? "Room soundboard: off" : m === "mods" ? "Room: mods + caller only" : st.cur ? "Room: caller + mods only (call in progress)" : "Room: open";
    const mod = st && st.you && st.you.host;
    $("hl-sbhost").hidden = !mod; if (mod) $("hl-sbhost").value = m;
  }
  async function devices(ask) {
    if (!navigator.mediaDevices) return;
    let ds = await navigator.mediaDevices.enumerateDevices();
    if (ask && !ds.some(d => d.kind === "audiooutput" && d.label)) { // labels need a mic permission in Chrome
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); ds = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
    }
    const outs = ds.filter(d => d.kind === "audiooutput" && d.deviceId !== "default");
    const sel = $("hl-sbdev");
    if (!("setSinkId" in HTMLMediaElement.prototype)) { sel.innerHTML = `<option>This browser can't pick an output (try Chrome or Edge)</option>`; sel.disabled = true; return; }
    sel.innerHTML = `<option value="">Choose your phone line output…</option>` + outs.map(d => `<option value="${esc(d.deviceId)}"${d.deviceId === o.dev ? " selected" : ""}>${esc(d.label || "Output device")}</option>`).join("");
  }
  function onState(s) { st = s; paint(); }
  async function init(opts) {
    send = opts.send; getMe = opts.me;
    try { const clips = await getJSON("data/clips.json"); sounds = clips.map(c => ({ k: "c:" + c.k, t: c.line, who: c.who })); } catch (e) { sounds = []; }
    sounds.push(...SFX.map(([k, t]) => ({ k, t, who: "Phone" })));
    sounds.sort((a, b) => (a.who === "Phone" ? -1 : 0) - (b.who === "Phone" ? -1 : 0));
    $("hl-pads").innerHTML = sounds.map(x => `<button type="button" class="hl-pad" data-sfx="${esc(x.k)}" data-q="${esc((x.t + " " + x.who).toLowerCase())}" title="${esc(x.who)}: ${esc(x.t)}"><b>${esc(x.t.length > 40 ? x.t.slice(0, 38) + "…" : x.t)}</b><small>${esc(x.who)}</small></button>`).join("");
    $("hl-sbq").addEventListener("input", e => { const q = e.target.value.trim().toLowerCase(); for (const b of $("hl-pads").children) b.hidden = !!q && !b.dataset.q.includes(q); });
    $("hl-pads").addEventListener("click", e => { const b = e.target.closest("[data-sfx]"); if (b) hit(b.dataset.sfx); });
    $("hl-sbroom").addEventListener("click", () => { o.room = !o.room; save(); paint(); });
    $("hl-sbline").addEventListener("click", () => { o.line = !o.line; save(); paint(); $("hl-sbdevrow").hidden = !o.line; if (o.line) devices(true); });
    $("hl-sbhear").addEventListener("click", () => { o.hear = !o.hear; save(); paint(); });
    $("hl-sbvol").addEventListener("input", e => { o.vol = +e.target.value; save(); });
    $("hl-sbdev").addEventListener("change", e => { o.dev = e.target.value; save(); if (o.dev) playTo("s:ring", o.dev, o.vol * 0.6); });
    $("hl-sbtest").addEventListener("click", () => o.dev ? playTo("s:ring", o.dev, o.vol) : devices(true));
    $("hl-sbhost").addEventListener("change", e => send({ type: "cmd", text: "!soundboard " + e.target.value }));
    $("hl-sbdevrow").hidden = !o.line; if (o.line) devices(false);
    paint();
  }
  return { init, onState, onSfx };
})();
