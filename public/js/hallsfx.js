/* The Hall's soundboard. Boards across the top: the crew drops, any preset boards (data/hall-boards.json), and "My board",
   where you drag your own sound files in for this room.
   Where a sound goes:
   🔊 Room: built-in sounds → every browser in the room plays it. Your own files → mixed into your voice (you need to be in voice).
            Rule 7 applies either way: during a call only the caller and mods.
   📞 My line: out of an audio device you pick, like a Voicemeeter or VB-Cable input that feeds your phone line (see the Audio Bible).
   With both off it just previews in your own ears. Keys 1–9 and 0 hit the first ten pads of the board you're on. */
const HallSB = (() => {
  let send = () => false, getMe = () => null, st = null, room = null;
  const o = { room: true, line: false, hear: true, dev: "", vol: 0.9, board: "drops" };
  try { Object.assign(o, JSON.parse(localStorage.getItem("cx-hall-sb") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("cx-hall-sb", JSON.stringify(o)); } catch (e) {} };
  const SFX = [["s:ring", "Phone ring"], ["s:pickup", "Pick up"], ["s:hangup", "Hang up"], ["s:slam", "Phone slam"], ["s:coin", "Coin drop"], ["s:page", "Page"], ["s:drop", "Drop"], ["s:setdown", "Set it down"]];
  const SLOTS = 16, MAX_MB = 15, MAX_SEC = 180;
  let boards = [];                       // [{id, name, pads:[{k,t,who,src}]}]
  const mine = new Array(SLOTS).fill(null); // {name, blob, url, buf}
  const all = new Map();                 // k → {t, src} for anything that can be played to the room
  const url = k => (all.get(k) || {}).src || (k.startsWith("s:") ? `sfx/${k.slice(2)}.mp3` : `clips/${k.slice(2)}.mp3`);
  const nameOf = k => (all.get(k) || {}).t || k.slice(2);
  const lum = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16), c = [n >> 16, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); if (x === null || y === null) return 0; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const ink = (bg, fg) => ratio(bg, fg) >= 3.5 ? fg : (ratio(bg, "#000000") > ratio(bg, "#ffffff") ? "#000000" : "#ffffff"); // keep IceCat's text color unless it can't be read
  const isLoop = k => !!(all.get(k) || {}).loop;
  const loops = new Map();   // k → my own running loop: {room, a:[Audio]}
  const roomLoops = new Map(); // uid|k → Audio (loops other people started in the room)

  /* ---------- playback ---------- */
  function playTo(src, sink, v, loop) {
    const a = new Audio(src); a.volume = Math.max(0, Math.min(1, v)); a.loop = !!loop;
    const go = () => a.play().catch(() => {});
    if (sink && a.setSinkId) a.setSinkId(sink).then(go, () => toast("Couldn't reach your phone line device. Pick it again in the soundboard.")); else go();
    return a;
  }
  function allowed() {
    if (!st || !st.you) return false; const y = st.you, caller = st.cur && st.cur.id === y.id;
    if (st.sfx === "off") return !!y.host; if (y.mod || caller) return true; if (st.sfx === "mods") return false; return !st.cur;
  }
  function why() { return st && st.sfx === "off" ? "The room soundboard is off." : st && st.sfx === "mods" ? "Room sounds are mods-only right now." : "Rule 7: no sounds during someone's call unless you're invited."; }
  function line(src) { if (!o.line) return false; if (o.dev) playTo(src, o.dev, o.vol); else toast("Pick your phone line output first (📞 My line)."); return true; }
  function hit(k) { // a built-in sound
    if (isLoop(k)) return toggleLoop(k);
    const toLine = line(url(k));
    if (o.room) { if (allowed()) send({ type: "sfx", k }); else { toast(why()); if (!toLine) playTo(url(k), "", o.vol); } }
    if (!o.room && !toLine) playTo(url(k), "", o.vol);
  }
  function toggleLoop(k) {
    const cur = loops.get(k);
    if (cur) { cur.a.forEach(a => a.pause()); if (cur.room) send({ type: "sfx", k, stop: true }); loops.delete(k); paintPads(); return; }
    const L = { room: false, a: [] };
    if (o.line) { if (o.dev) L.a.push(playTo(url(k), o.dev, o.vol, true)); else toast("Pick your phone line output first (📞 My line)."); }
    if (o.room) { if (allowed()) { send({ type: "sfx", k, loop: true }); L.room = true; } else { toast(why()); if (!o.line) L.a.push(playTo(url(k), "", o.vol, true)); } }
    if (!o.room && !o.line) L.a.push(playTo(url(k), "", o.vol, true));
    loops.set(k, L); paintPads();
    setTimeout(() => { if (loops.get(k) === L) toggleLoop(k); }, 120000); // loops stop themselves after 2 minutes
  }
  function stopAll() {
    for (const k of [...loops.keys()]) toggleLoop(k);
    for (const a of roomLoops.values()) a.pause(); roomLoops.clear();
    playing.forEach(a => a.pause()); playing.clear();
  }
  const playing = new Set();
  async function hitMine(i) { // one of your own files
    const m = mine[i]; if (!m) return;
    const toLine = line(m.url);
    if (o.room) {
      if (!allowed()) { toast(why()); if (!toLine) playTo(m.url, "", o.vol); }
      else if (!HallVoice.inVoice) { toast("Join voice so the room hears your own sounds. Playing it just for you."); if (!toLine) playTo(m.url, "", o.vol); }
      else { const buf = await decode(m); if (buf && HallVoice.playInto(buf, o.vol)) { if (!toLine) playTo(m.url, "", o.vol * 0.8); flash(i); } }
    }
    if (!o.room && !toLine) playTo(m.url, "", o.vol);
  }
  async function decode(m) {
    if (m.buf) return m.buf;
    try { m.buf = await HallVoice.ctx().decodeAudioData(await m.blob.arrayBuffer()); } catch (e) { toast("Couldn't read that sound file."); return null; }
    return m.buf;
  }
  function flash(i) { const pad = document.querySelector(`#hl-pads [data-slot="${i}"]`); if (pad) { pad.classList.remove("hit"); void pad.offsetWidth; pad.classList.add("hit"); } }
  function onSfx(d) { // someone played a built-in sound to the room
    const key = d.uid + "|" + d.k;
    if (d.stop) { const a = roomLoops.get(key); if (a) { a.pause(); roomLoops.delete(key); } return; }
    if (o.hear) { const a = playTo(url(d.k), "", o.vol, d.loop); playing.add(a); a.onended = () => playing.delete(a);
      if (d.loop) { const old = roomLoops.get(key); if (old) old.pause(); roomLoops.set(key, a); setTimeout(() => { if (roomLoops.get(key) === a) { a.pause(); roomLoops.delete(key); } }, 125000); } }
    const pad = document.querySelector(`#hl-pads [data-sfx="${CSS.escape(d.k)}"]`); if (pad) { pad.classList.remove("hit"); void pad.offsetWidth; pad.classList.add("hit"); }
    const log = $("hl-log"); if (!log) return;
    const div = document.createElement("div"); div.className = "hl-msg sfxline";
    div.innerHTML = `<span class="hl-t"></span><span class="hl-who">🔊</span><span class="hl-txt">${esc(d.by)} played <b>${esc(nameOf(d.k))}</b></span>`;
    if (d.uid) { div.dataset.uid = d.uid; div.hidden = !!(st && st.you && (st.you.blocks || []).includes(d.uid)); }
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.appendChild(div); if (stick) log.scrollTop = log.scrollHeight;
  }

  /* ---------- My board: your own files, kept in this browser for this room ---------- */
  const DB = { name: "cx-hall-board", store: "slots" };
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DB.name, 1); r.onupgradeneeded = () => r.result.createObjectStore(DB.store); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function persist() {
    if (!room) return;
    try { const db = await idb(), tx = db.transaction(DB.store, "readwrite"); tx.objectStore(DB.store).put(mine.map(m => m ? { name: m.name, blob: m.blob } : null), room); } catch (e) {}
  }
  async function restore(code) {
    for (let i = 0; i < SLOTS; i++) clearSlot(i, true);
    room = code; if (!code) return paintPads();
    try {
      const db = await idb(); const v = await new Promise(r => { const q = db.transaction(DB.store).objectStore(DB.store).get(code); q.onsuccess = () => r(q.result); q.onerror = () => r(null); });
      (v || []).forEach((m, i) => { if (m && m.blob && i < SLOTS) mine[i] = { name: m.name, blob: m.blob, url: URL.createObjectURL(m.blob), buf: null }; });
    } catch (e) {}
    paintPads();
  }
  async function forget(code) { try { const db = await idb(); db.transaction(DB.store, "readwrite").objectStore(DB.store).delete(code || room); } catch (e) {} }
  function clearSlot(i, quiet) { const m = mine[i]; if (m && m.url) URL.revokeObjectURL(m.url); mine[i] = null; if (!quiet) { persist(); paintPads(); } }
  const okFile = f => f && (/^audio\//.test(f.type) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f.name));
  async function addFiles(files, start = 0) {
    const list = [...files].filter(okFile); if (!list.length) return toast("Those aren't sound files. Try MP3, WAV, OGG, M4A or FLAC.");
    let i = start, added = 0;
    for (const f of list) {
      if (f.size > MAX_MB * 1048576) { toast(`${f.name} is over ${MAX_MB} MB.`); continue; }
      while (i < SLOTS && mine[i] && i !== start) i++;
      if (i >= SLOTS) { i = mine.findIndex(x => !x); if (i < 0) { toast("Your board is full. Clear a pad or drop onto one to replace it."); break; } }
      const m = { name: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 40) || "Sound", blob: f, url: URL.createObjectURL(f), buf: null };
      const buf = await decode(m); if (!buf) { URL.revokeObjectURL(m.url); continue; }
      if (buf.duration > MAX_SEC) { toast(`${f.name} is longer than ${MAX_SEC / 60} minutes.`); URL.revokeObjectURL(m.url); continue; }
      if (mine[i]) clearSlot(i, true);
      mine[i] = m; added++; i++;
    }
    if (added) { persist(); paintPads(); toast(`Added ${added} sound${added === 1 ? "" : "s"} to your board.`); }
  }
  function swap(a, b) { if (a === b) return; [mine[a], mine[b]] = [mine[b], mine[a]]; persist(); paintPads(); }

  /* ---------- drawing ---------- */
  function paintTabs() {
    const tabs = [...boards.map(b => [b.id, b.name]), ["mine", "My board"]];
    if (!tabs.some(t => t[0] === o.board)) o.board = tabs[0][0];
    $("hl-sbtabs").innerHTML = tabs.map(([id, n]) => `<button type="button" role="tab" data-board="${esc(id)}" aria-selected="${o.board === id}">${esc(n)}</button>`).join("");
    $("hl-sbq").hidden = o.board === "mine"; $("hl-mine").hidden = o.board !== "mine";
  }
  function paintPads() {
    paintTabs();
    const pads = $("hl-pads"); pads.classList.toggle("mine", o.board === "mine");
    if (o.board === "mine") { pads.classList.remove("grid"); $("hl-sbfrom").textContent = "";
      pads.innerHTML = mine.map((m, i) => m
        ? `<div class="hl-pad full" draggable="true" data-slot="${i}" title="${esc(m.name)}${i < 10 ? ` (key ${(i + 1) % 10})` : ""}"><button type="button" class="hl-padhit" data-play="${i}"><b>${esc(m.name)}</b><small>${i < 10 ? `key ${(i + 1) % 10}` : "&nbsp;"}</small></button><span class="hl-padtools"><button type="button" data-rename="${i}" title="Rename">✎</button><button type="button" data-clear="${i}" title="Clear this pad">✕</button></span></div>`
        : `<button type="button" class="hl-pad empty" data-slot="${i}" data-pick="${i}"><b>+</b><small>Drop a sound</small></button>`).join("");
      return;
    }
    const b = boards.find(x => x.id === o.board) || boards[0];
    pads.classList.toggle("grid", !!b.grid); pads.style.setProperty("--cols", b.grid || "");
    if (b.grid) { // laid out like the original board, empty spots and all
      const at = new Map(b.pads.map(p => [p.pos, p]));
      pads.innerHTML = Array.from({ length: b.size }, (_, i) => { const x = at.get(i); if (!x) return `<span class="hl-pad blank" aria-hidden="true"></span>`;
        const n = b.pads.indexOf(x);
        return `<button type="button" class="hl-pad${x.loop ? " loop" : ""}${loops.has(x.k) ? " on" : ""}" data-sfx="${esc(x.k)}" data-q="${esc(x.t.toLowerCase())}" style="--pc:${esc(x.color || "#2b2650")};--pt:${esc(ink(x.color || "#2b2650", x.text || "#ffffff"))}" title="${esc(x.t)}${x.loop ? " (loop: tap again to stop)" : ""}${n < 10 ? ` (key ${(n + 1) % 10})` : ""}"><b>${esc(x.t)}</b>${x.loop ? "<small>⟳ loop</small>" : ""}</button>`; }).join("");
      $("hl-sbfrom").textContent = b.from ? `Layout from ${b.from}` : "";
      const q = $("hl-sbq").value.trim().toLowerCase(); if (q) for (const el of pads.querySelectorAll("[data-q]")) el.classList.toggle("dim", !el.dataset.q.includes(q));
      return;
    }
    $("hl-sbfrom").textContent = "";
    pads.innerHTML = b.pads.map((x, i) => `<button type="button" class="hl-pad" data-sfx="${esc(x.k)}" data-q="${esc((x.t + " " + (x.who || "")).toLowerCase())}" title="${esc(x.who ? x.who + ": " : "")}${esc(x.t)}${i < 10 ? ` (key ${(i + 1) % 10})` : ""}"><b>${esc(x.t.length > 40 ? x.t.slice(0, 38) + "…" : x.t)}</b><small>${esc(x.who || "")}${i < 10 ? ` · ${(i + 1) % 10}` : ""}</small></button>`).join("");
    const q = $("hl-sbq").value.trim().toLowerCase(); if (q) for (const el of pads.children) el.hidden = !el.dataset.q.includes(q);
  }
  function paint() {
    $("hl-sbroom").setAttribute("aria-pressed", String(o.room)); $("hl-sbline").setAttribute("aria-pressed", String(o.line)); $("hl-sbhear").setAttribute("aria-pressed", String(o.hear));
    $("hl-sbhear").textContent = o.hear ? "👂 Hearing room sounds" : "🙉 Room sounds off";
    $("hl-sbvol").value = o.vol;
    const m = st ? st.sfx : "open";
    $("hl-sbmode").textContent = !st ? "" : m === "off" ? "Room soundboard: off" : m === "mods" ? "Room: mods + caller only" : st.cur ? "Room: caller + mods only (call in progress)" : "Room: open";
    const host = st && st.you && st.you.host; $("hl-sbhost").hidden = !host; if (host) $("hl-sbhost").value = m;
  }
  async function devices(ask) {
    if (!navigator.mediaDevices) return;
    let ds = await navigator.mediaDevices.enumerateDevices();
    if (ask && !ds.some(d => d.kind === "audiooutput" && d.label)) { // labels need a mic permission in Chrome
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); ds = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
    }
    const outs = ds.filter(d => d.kind === "audiooutput" && d.deviceId !== "default"), sel = $("hl-sbdev");
    if (!("setSinkId" in HTMLMediaElement.prototype)) { sel.innerHTML = `<option>This browser can't pick an output (try Chrome or Edge)</option>`; sel.disabled = true; return; }
    sel.innerHTML = `<option value="">Choose your phone line output…</option>` + outs.map(d => `<option value="${esc(d.deviceId)}"${d.deviceId === o.dev ? " selected" : ""}>${esc(d.label || "Output device")}</option>`).join("");
  }
  function onState(s) {
    st = s; paint();
    const here = new Set(s.members.filter(m => m.on).map(m => m.id)); // their loops stop when they leave
    for (const [key, a] of roomLoops) if (!here.has(key.split("|")[0])) { a.pause(); roomLoops.delete(key); }
  }

  async function init(opts) {
    send = opts.send; getMe = opts.me;
    let drops = [];
    try { drops = (await getJSON("data/clips.json")).map(c => ({ k: "c:" + c.k, t: c.line, who: c.who })); } catch (e) {}
    boards = [{ id: "drops", name: "Crew drops", pads: [...SFX.map(([k, t]) => ({ k, t, who: "Phone" })), ...drops] }];
    try { // preset boards: {boards:[{id, name, pads:[{k:"b:<file>", t, file}]}]}, audio in sfx/boards/
      const pre = await getJSON("data/hall-boards.json");
      for (const b of pre.boards || []) boards.push({ id: b.id, name: b.name, grid: b.cols || 8, size: (b.cols || 8) * (b.rows || 8), from: b.from || "",
        pads: b.pads.map(p => ({ k: p.k, t: p.t, who: p.who || "", src: `sfx/boards/${p.file}`, pos: p.pos, color: p.color, text: p.text, loop: !!p.loop })) });
    } catch (e) {}
    for (const b of boards) for (const p of b.pads) all.set(p.k, { t: p.t, src: p.src, loop: !!p.loop });
    paintPads();

    $("hl-sbtabs").addEventListener("click", e => { const b = e.target.closest("[data-board]"); if (b) { o.board = b.dataset.board; save(); paintPads(); } });
    $("hl-sbq").addEventListener("input", paintPads);
    const pads = $("hl-pads"), picker = $("hl-file"); let pickAt = 0;
    pads.addEventListener("click", e => {
      let b;
      if ((b = e.target.closest("[data-sfx]"))) return hit(b.dataset.sfx);
      if ((b = e.target.closest("[data-play]"))) return hitMine(+b.dataset.play);
      if ((b = e.target.closest("[data-clear]"))) return clearSlot(+b.dataset.clear);
      if ((b = e.target.closest("[data-rename]"))) { const i = +b.dataset.rename, n = prompt("Name this pad:", mine[i].name); if (n && n.trim()) { mine[i].name = n.trim().slice(0, 40); persist(); paintPads(); } return; }
      if ((b = e.target.closest("[data-pick]"))) { pickAt = +b.dataset.pick; picker.click(); }
    });
    picker.addEventListener("change", () => { addFiles(picker.files, pickAt); picker.value = ""; });
    $("hl-mineadd").addEventListener("click", () => { pickAt = Math.max(0, mine.findIndex(x => !x)); picker.click(); });
    let armed = 0;
    $("hl-mineclear").addEventListener("click", () => {
      if (!mine.some(Boolean)) return;
      if (Date.now() > armed) { armed = Date.now() + 3000; return toast("Clear every pad on your board? Tap again to confirm."); }
      for (let i = 0; i < SLOTS; i++) clearSlot(i, true); persist(); paintPads();
    });
    // drag and drop: files onto a pad (or anywhere on the board), pads onto pads to swap
    let dragFrom = null;
    pads.addEventListener("dragstart", e => { const p = e.target.closest("[data-slot]"); if (p && o.board === "mine") { dragFrom = +p.dataset.slot; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "pad"); } });
    pads.addEventListener("dragend", () => { dragFrom = null; pads.querySelectorAll(".over").forEach(x => x.classList.remove("over")); });
    const zone = $("hl-sb");
    zone.addEventListener("dragover", e => {
      const files = [...(e.dataTransfer.types || [])].includes("Files"); if (!files && dragFrom === null) return;
      e.preventDefault(); e.dataTransfer.dropEffect = files ? "copy" : "move";
      if (files && o.board !== "mine") { o.board = "mine"; save(); paintPads(); }
      zone.classList.add("dropping"); pads.querySelectorAll(".over").forEach(x => x.classList.remove("over"));
      const p = e.target.closest && e.target.closest("[data-slot]"); if (p) p.classList.add("over");
    });
    zone.addEventListener("dragleave", e => { if (!zone.contains(e.relatedTarget)) { zone.classList.remove("dropping"); pads.querySelectorAll(".over").forEach(x => x.classList.remove("over")); } });
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("dropping");
      const p = e.target.closest && e.target.closest("[data-slot]"), at = p ? +p.dataset.slot : null;
      if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, at === null ? Math.max(0, mine.findIndex(x => !x)) : at);
      else if (dragFrom !== null && at !== null) swap(dragFrom, at);
      dragFrom = null; pads.querySelectorAll(".over").forEach(x => x.classList.remove("over"));
    });
    // number keys hit the first ten pads of the board you're on
    addEventListener("keydown", e => {
      if (!/^[0-9]$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
      if (!room || $("hl-room").hidden || Router.page !== "host") return;
      const i = (+e.key + 9) % 10;
      if (o.board === "mine") hitMine(i); else { const b = boards.find(x => x.id === o.board); if (b && b.pads[i]) hit(b.pads[i].k); }
    });
    $("hl-sbstop").addEventListener("click", stopAll);
    $("hl-sbroom").addEventListener("click", () => { o.room = !o.room; save(); paint(); });
    $("hl-sbline").addEventListener("click", () => { o.line = !o.line; save(); paint(); $("hl-sbdevrow").hidden = !o.line; if (o.line) devices(true); });
    $("hl-sbhear").addEventListener("click", () => { o.hear = !o.hear; save(); paint(); });
    $("hl-sbvol").addEventListener("input", e => { o.vol = +e.target.value; save(); });
    $("hl-sbdev").addEventListener("change", e => { o.dev = e.target.value; save(); if (o.dev) playTo("sfx/ring.mp3", o.dev, o.vol * 0.6); });
    $("hl-sbtest").addEventListener("click", () => o.dev ? playTo("sfx/ring.mp3", o.dev, o.vol) : devices(true));
    $("hl-sbhost").addEventListener("change", e => send({ type: "cmd", text: "!soundboard " + e.target.value }));
    $("hl-sbdevrow").hidden = !o.line; if (o.line) devices(false);
    paint();
  }
  return { init, onState, onSfx, stopAll, enterRoom: restore, leaveRoom: c => { stopAll(); forget(c); restore(null); } };
})();
