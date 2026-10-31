/* The Hall's soundboard. Built-in boards across the top (Crew drops, SFX 1, SFX 2), then your own boards.
   Pads work like IceCat's Broadcast Backpack: press to play, press again to stop. Right-click (or long-press on a phone) a pad for
   loop mode, colors, rename, cut / copy / paste and clear. The built-in boards keep their colors; your own boards are yours to dress up.
   Where a sound goes:
   🔊 Room: built-in sounds → every browser in the room plays it. Your own files → mixed into your voice (you need to be in voice).
            Rule 7 applies either way: during a call only the caller and mods.
   📞 My line: out of an audio device you pick, like a Voicemeeter or VB-Cable input that feeds your phone line (see the Audio Bible).
   With both off it just previews in your own ears.
   Volume is one global slider: it sets what the room hears from you, what you hear, and what goes down your phone line, live.
   "Others" is your own listening level for everybody else's room sounds (it multiplies their volume, only for you).
   Your own boards are saved in this browser (IndexedDB) and follow you from room to room. Keys 1–9 and 0 hit the first ten pads. */
const HallSB = (() => {
  let send = () => false, getMe = () => null, st = null, room = null;
  const o = { room: true, line: false, hear: true, hearVol: 1, dev: "", vol: 0.9, board: "drops" };
  try { Object.assign(o, JSON.parse(localStorage.getItem("cx-hall-sb") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("cx-hall-sb", JSON.stringify(o)); } catch (e) {} };
  const ov = { loop: {} }; // your loop on/off choices for built-in pads
  try { Object.assign(ov, JSON.parse(localStorage.getItem("cx-hall-sbx") || "{}")); } catch (e) {}
  const saveOv = () => { try { localStorage.setItem("cx-hall-sbx", JSON.stringify(ov)); } catch (e) {} };

  const SFX = [["s:ring", "Phone ring"], ["s:pickup", "Pick up"], ["s:hangup", "Hang up"], ["s:slam", "Phone slam"], ["s:coin", "Coin drop"], ["s:page", "Page"], ["s:drop", "Drop"], ["s:setdown", "Set it down"]];
  const CREW = { // [pad color, text color]
    "Phone": ["#1c3d78", "#ffd700"], "Ira": ["#cc0000", "#ffffff"], "IceCat": ["#2f80ed", "#ffffff"], "DespicableDogs": ["#f0a020", "#000000"],
    "Dr. Tom Servo": ["#767067", "#ffffff"], "Andy Anderson": ["#ff6644", "#000000"], "Drake Dragsaw": ["#20b85a", "#000000"], "AnteaterTpose": ["#8c625b", "#ffffff"],
    "CrieFaux": ["#6a35b8", "#ffffff"], "Rozin": ["#87a5dc", "#000000"], "GreenImp": ["#9be15d", "#000000"], "PoopMyPee": ["#5c3a1e", "#ffffff"],
    "IDontKnow": ["#000000", "#ffffff"], "The Callective": ["#ff2bd6", "#000000"], "On the other end": ["#c4dffd", "#000000"] };
  const COLS = 8, NEW_ROWS = 4, MAX_SLOTS = 64, MAX_BOARDS = 12, MAX_MB = 15, MAX_SEC = 180, PAD_BG = "#2b2650", PAD_TX = "#ffffff";
  let boards = [];                 // built-in: [{id, name, grid, size, pads:[{k,t,who,src,pos,color,text,loop}]}]
  let mine = [];                   // yours: [{id, name, slots:[null | {name, color, text, loop, ref?, blob?, url?, buf?}]}]
  const all = new Map();           // k → {t, src, loop, sec} for every built-in sound
  let clip = null;                 // the soundboard clipboard (one pad)
  const url = k => (all.get(k) || {}).src || (k.startsWith("s:") ? `sfx/${k.slice(2)}.mp3` : `clips/${k.slice(2)}.mp3`);
  const nameOf = k => (all.get(k) || {}).t || k.slice(2);
  const lum = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16), c = [n >> 16, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); if (x === null || y === null) return 0; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const ink = (bg, fg) => ratio(bg, fg) >= 3.5 ? fg : (ratio(bg, "#000000") > ratio(bg, "#ffffff") ? "#000000" : "#ffffff"); // keep the text color unless it can't be read
  const myBoard = id => mine.find(b => b.id === id);
  const builtIn = id => boards.find(b => b.id === id);
  const cur = () => myBoard(o.board) || builtIn(o.board) || boards[0];
  const loopFor = k => k in ov.loop ? !!ov.loop[k] : !!(all.get(k) || {}).loop;

  /* ---------- playback: press to play, press again to stop ---------- */
  const act = new Map();      // pad key ("k:<sound>" or "f:<board>:<slot>") → {k, room, els:Set<Audio>, nodes:Set<AudioNode>, timers:[]}
  const roomAud = new Map();  // "<uid>|<k>" → Set<Audio> (what the room is playing, including your own echo)
  const clampV = v => Math.max(0, Math.min(1, v));
  function playTo(src, sink, v, loop) {
    const a = new Audio(src); a.volume = clampV(v); a.loop = !!loop;
    const go = () => a.play().catch(() => {});
    if (sink && a.setSinkId) a.setSinkId(sink).then(go, () => toast("Couldn't reach your phone line device. Pick it again in the soundboard.")); else go();
    return a;
  }
  function allowed() {
    if (!st || !st.you) return false; const y = st.you, caller = st.cur && st.cur.id === y.id;
    if (st.sfx === "off") return !!y.host; if (y.mod || caller) return true; if (st.sfx === "mods") return false; return !st.cur;
  }
  function why() { return st && st.sfx === "off" ? "The room soundboard is off." : st && st.sfx === "mods" ? "Room sounds are mods-only right now." : "Rule 7: no sounds during someone's call unless you're invited."; }
  const playing = key => act.has(key);
  function track(key, E, el) { E.els.add(el); el.addEventListener("ended", () => { E.els.delete(el); settle(key, E); }); }
  function settle(key, E) { if (act.get(key) === E && !E.els.size && !E.nodes.size && !E.wait) { act.delete(key); paintState(); } }
  function stop(key, quiet) {
    const E = act.get(key); if (!E) return; act.delete(key);
    E.els.forEach(a => a.pause()); E.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); E.timers.forEach(clearTimeout);
    if (E.room && E.k) { send({ type: "sfx", k: E.k, stop: true }); const me = getMe(); if (me) (roomAud.get(me.id + "|" + E.k) || new Set()).forEach(a => a.pause()); }
    if (!quiet) paintState();
  }
  function begin(key, k, loop) {
    const E = { k, room: false, els: new Set(), nodes: new Set(), timers: [], wait: false };
    act.set(key, E);
    if (loop) E.timers.push(setTimeout(() => stop(key), 120000)); // loops stop themselves after 2 minutes
    return E;
  }
  // when nothing local tells us the sound ended (room only, not hearing the room), clear the "playing" light after its length
  function waitOut(key, E, src, loop) {
    if (loop || E.els.size || E.nodes.size) return; E.wait = true;
    const done = s => E.timers.push(setTimeout(() => { E.wait = false; settle(key, E); }, Math.max(1, s) * 1000 + 300));
    const known = E.k && (all.get(E.k) || {}).sec; if (known) return done(known);
    const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => done(a.duration || 5); a.onerror = () => done(5); a.src = src;
  }
  function hit(k, key = "k:" + k, loop = loopFor(k)) { // a built-in sound (from a built-in board or a pad you copied onto your board)
    if (playing(key)) return stop(key);
    const E = begin(key, k, loop), src = url(k);
    if (o.line) { if (o.dev) track(key, E, playTo(src, o.dev, o.vol, loop)); else toast("Pick your phone line output first (📞 My line)."); }
    if (o.room) {
      if (allowed()) { E.room = true; send({ type: "sfx", k, loop, v: o.vol }); if (o.hear) E.wait = true; } // your echo from the room joins this pad
      else { toast(why()); if (!o.line) track(key, E, playTo(src, "", o.vol, loop)); }
    } else if (!o.line) track(key, E, playTo(src, "", o.vol, loop));
    if (E.room && o.hear) E.timers.push(setTimeout(() => { if (E.wait && !E.els.size) { E.wait = false; waitOut(key, E, src, loop); } }, 4000)); // echo never came back
    else waitOut(key, E, src, loop);
    paintState(); settle(key, E);
  }
  async function hitFile(bid, i) { // one of your own sound files
    const b = myBoard(bid), m = b && b.slots[i]; if (!m) return;
    if (m.ref) return hit(m.ref, `f:${bid}:${i}`, !!m.loop);
    const key = `f:${bid}:${i}`; if (playing(key)) return stop(key);
    const E = begin(key, null, !!m.loop);
    if (o.line) { if (o.dev) track(key, E, playTo(m.url, o.dev, o.vol, m.loop)); else toast("Pick your phone line output first (📞 My line)."); }
    if (o.room) {
      if (!allowed()) { toast(why()); if (!o.line) track(key, E, playTo(m.url, "", o.vol, m.loop)); }
      else if (!HallVoice.inVoice) { toast("Join voice so the room hears your own sounds. Playing it just for you."); if (!o.line) track(key, E, playTo(m.url, "", o.vol, m.loop)); }
      else {
        E.wait = true; const buf = await decode(m); E.wait = false;
        if (act.get(key) !== E) return; // stopped while loading
        const n = buf && HallVoice.playInto(buf, o.vol, m.loop);
        if (n) { E.nodes.add(n); n.addEventListener("ended", () => { E.nodes.delete(n); settle(key, E); }); if (!o.line && o.hear) { const a = playTo(m.url, "", o.vol * 0.8, m.loop); a.dataset.mon = "1"; track(key, E, a); } }
      }
    } else if (!o.line) track(key, E, playTo(m.url, "", o.vol, m.loop));
    paintState(); settle(key, E);
  }
  async function decode(m) {
    if (m.buf) return m.buf;
    try { m.buf = await HallVoice.ctx().decodeAudioData(await m.blob.arrayBuffer()); } catch (e) { toast("Couldn't read that sound file."); return null; }
    return m.buf;
  }
  function stopAll() {
    for (const key of [...act.keys()]) stop(key, true);
    for (const set of roomAud.values()) set.forEach(a => a.pause()); roomAud.clear();
    paintState();
  }
  // the one volume slider: you, your phone line, and what the room hears from you, all live
  let volT = 0;
  function setVol(v) {
    o.vol = clampV(v); save();
    for (const E of act.values()) { E.els.forEach(a => { a.volume = a.dataset && a.dataset.mon ? o.vol * 0.8 : o.vol; }); E.nodes.forEach(n => { if (n.gainNode) n.gainNode.gain.value = o.vol; }); }
    const me = getMe(); if (me) for (const [key, set] of roomAud) if (key.startsWith(me.id + "|")) set.forEach(a => { a.dataset.sv = o.vol; a.volume = o.vol; });
    if ([...act.values()].some(E => E.room) && Date.now() - volT > 150) { volT = Date.now(); send({ type: "sfx", vol: true, v: o.vol }); }
    clearTimeout(setVol.t); setVol.t = setTimeout(() => { if ([...act.values()].some(E => E.room)) send({ type: "sfx", vol: true, v: o.vol }); }, 200); // make sure the last spot lands
  }
  const heard = (uid, v) => { const me = getMe(); return clampV(me && uid === me.id ? v : v * o.hearVol); }; // your own echo follows Volume; other people's sounds also follow "Others"
  function onVol(d) { for (const [key, set] of roomAud) if (key.startsWith(d.uid + "|")) set.forEach(a => { a.dataset.sv = d.v; a.volume = heard(d.uid, d.v); }); }
  function setHear(v) { o.hearVol = clampV(v); save(); for (const [key, set] of roomAud) { const uid = key.split("|")[0]; set.forEach(a => { a.volume = heard(uid, +(a.dataset.sv || 0.9)); }); } }
  function onSfx(d) { // someone (maybe you) played a built-in sound to the room
    const key = d.uid + "|" + d.k, me = getMe(), mineSnd = me && d.uid === me.id;
    if (d.stop) { (roomAud.get(key) || new Set()).forEach(a => a.pause()); roomAud.delete(key); if (!mineSnd) flashKey(d.k); return; }
    let E = null;
    if (mineSnd) { for (const [pk, x] of act) if (x.k === d.k && x.room) { E = [pk, x]; break; } if (!E) return; } // you already stopped it
    if (o.hear) {
      const sv = d.v === undefined ? 0.9 : d.v, a = playTo(url(d.k), "", heard(d.uid, sv), d.loop); a.dataset.sv = sv;
      let set = roomAud.get(key); if (!set) roomAud.set(key, set = new Set()); set.add(a);
      a.addEventListener("ended", () => set.delete(a));
      if (d.loop) setTimeout(() => { a.pause(); set.delete(a); }, 125000);
      if (E) { E[1].wait = false; track(E[0], E[1], a); }
    }
    flashKey(d.k);
    const log = $("hl-log"); if (!log) return;
    const div = document.createElement("div"); div.className = "hl-msg sfxline";
    div.innerHTML = `<span class="hl-t"></span><span class="hl-who">🔊</span><span class="hl-txt">${esc(d.by)} played <b>${esc(nameOf(d.k))}</b>${d.loop ? " (loop)" : ""}</span>`;
    if (d.uid) { div.dataset.uid = d.uid; div.hidden = !!(st && st.you && (st.you.blocks || []).includes(d.uid)); }
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80; log.appendChild(div); if (stick) log.scrollTop = log.scrollHeight;
  }
  function flashKey(k) { const pad = document.querySelector(`#hl-pads [data-sfx="${CSS.escape(k)}"]`); if (pad) { pad.classList.remove("hit"); void pad.offsetWidth; pad.classList.add("hit"); } }

  /* ---------- your own boards, saved in this browser ---------- */
  const DB = { name: "cx-hall-myboards", store: "data", key: "v1" };
  function idb(name = DB.name, store = DB.store) { return new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore(store); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  const idbGet = (db, store, key) => new Promise(r => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(null); });
  const newId = () => "m" + Math.random().toString(36).slice(2, 8);
  const blankBoard = name => ({ id: newId(), name, slots: new Array(COLS * NEW_ROWS).fill(null) });
  let saveT = 0;
  function persist() {
    clearTimeout(saveT); saveT = setTimeout(async () => {
      try {
        const db = await idb(), data = mine.map(b => ({ id: b.id, name: b.name, slots: b.slots.map(m => m ? { name: m.name, color: m.color || "", text: m.text || "", loop: !!m.loop, ref: m.ref || "", blob: m.blob || null } : null) }));
        db.transaction(DB.store, "readwrite").objectStore(DB.store).put(data, DB.key);
      } catch (e) {}
    }, 250);
  }
  const live = m => { if (m && m.blob && !m.url) m.url = URL.createObjectURL(m.blob); return m; };
  async function load() {
    try {
      const db = await idb(), v = await idbGet(db, DB.store, DB.key);
      if (Array.isArray(v) && v.length) mine = v.map(b => ({ id: b.id || newId(), name: b.name || "My board", slots: (b.slots || []).map(m => m && (m.blob || m.ref) ? live({ ...m, buf: null }) : null) }));
    } catch (e) {}
    if (!mine.length) mine = [blankBoard("My board")];
  }
  async function importOld(code) { // boards from before Oct 31 2026 were kept per room: pull them into your first board once
    try {
      const db = await idb("cx-hall-board", "slots"), v = await idbGet(db, "slots", code); if (!v || !v.some(Boolean)) return;
      const b = mine[0];
      for (const m of v) { if (!m || !m.blob) continue; let i = b.slots.findIndex(x => !x); if (i < 0) { if (b.slots.length >= MAX_SLOTS) break; b.slots.push(...new Array(COLS).fill(null)); i = b.slots.findIndex(x => !x); } b.slots[i] = live({ name: m.name, blob: m.blob, loop: false, color: "", text: "", buf: null }); }
      db.transaction("slots", "readwrite").objectStore("slots").delete(code); persist(); paintPads();
    } catch (e) {}
  }
  function clearSlot(b, i, quiet) { const m = b.slots[i]; if (m && m.url) URL.revokeObjectURL(m.url); stop(`f:${b.id}:${i}`, true); b.slots[i] = null; if (!quiet) { persist(); paintPads(); } }
  const okFile = f => f && (/^audio\//.test(f.type) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f.name));
  async function addFiles(b, files, start = 0, replace = false) {
    const list = [...files].filter(okFile); if (!list.length) return toast("Those aren't sound files. Try MP3, WAV, OGG, M4A or FLAC.");
    let i = start, added = 0;
    for (const f of list) {
      if (f.size > MAX_MB * 1048576) { toast(`${f.name} is over ${MAX_MB} MB.`); continue; }
      if (!(replace && i === start)) while (i < b.slots.length && b.slots[i]) i++;
      if (i >= b.slots.length) { if (b.slots.length >= MAX_SLOTS) { toast("This board is full (64 pads). Start a new board or clear some pads."); break; } b.slots.push(...new Array(COLS).fill(null)); }
      const m = { name: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 40) || "Sound", blob: f, url: URL.createObjectURL(f), buf: null, loop: false, color: "", text: "" };
      const buf = await decode(m); if (!buf) { URL.revokeObjectURL(m.url); continue; }
      if (buf.duration > MAX_SEC) { toast(`${f.name} is longer than ${MAX_SEC / 60} minutes.`); URL.revokeObjectURL(m.url); continue; }
      const old = b.slots[i]; if (old) { m.color = old.color; m.text = old.text; m.loop = old.loop; clearSlot(b, i, true); }
      b.slots[i] = m; added++; i++;
    }
    if (added) { persist(); paintPads(); toast(`Added ${added} sound${added === 1 ? "" : "s"} to ${b.name}.`); }
  }
  function swap(b, x, y) { if (x === y) return; stop(`f:${b.id}:${x}`, true); stop(`f:${b.id}:${y}`, true); [b.slots[x], b.slots[y]] = [b.slots[y], b.slots[x]]; persist(); paintPads(); }
  function newBoard() {
    if (mine.length >= MAX_BOARDS) return toast(`That's ${MAX_BOARDS} boards. Delete one to make another.`);
    const n = prompt("Name your new board:", `Board ${mine.length + 1}`); if (n === null) return;
    const b = blankBoard((n.trim() || `Board ${mine.length + 1}`).slice(0, 30)); mine.push(b); o.board = b.id; save(); persist(); paintPads();
  }
  function renameBoard(b) { const n = prompt("Board name:", b.name); if (n && n.trim()) { b.name = n.trim().slice(0, 30); persist(); paintPads(); } }
  let delArm = 0;
  function deleteBoard(b) {
    if (Date.now() > delArm) { delArm = Date.now() + 3000; return toast(`Delete "${b.name}" and its sounds? Tap again to confirm.`); }
    b.slots.forEach((m, i) => m && clearSlot(b, i, true)); mine = mine.filter(x => x !== b); if (!mine.length) mine = [blankBoard("My board")];
    o.board = mine[0].id; save(); persist(); paintPads();
  }

  /* ---------- right-click menu ---------- */
  const snap = m => m && { name: m.name, color: m.color || "", text: m.text || "", loop: !!m.loop, ref: m.ref || "", blob: m.blob || null };
  function fromBuiltIn(k) { const p = boards.flatMap(b => b.pads).find(x => x.k === k) || {}; return { name: (p.who && p.who !== "Phone" ? p.who + ": " : "") + (p.t || nameOf(k)), color: p.color || "", text: p.text || "", loop: loopFor(k), ref: k, blob: null }; }
  function pasteInto(b, i) { if (!clip) return; const old = b.slots[i]; if (old) clearSlot(b, i, true); b.slots[i] = live({ ...clip, url: null, buf: null }); persist(); paintPads(); }
  let menuFor = null;
  function closeMenu() { const m = $("hl-ctx"); if (m) m.hidden = true; menuFor = null; }
  function openMenu(x, y, target) {
    const box = $("hl-ctx"); menuFor = target; let h = "";
    const item = (act, label, extra = "") => `<button type="button" role="menuitem" data-act="${act}" ${extra}>${label}</button>`;
    if (target.type === "built") {
      const k = target.k, on = playing("k:" + k);
      h = `<p class="hl-ctxt">${esc(nameOf(k))}</p>` + item("play", on ? "■ Stop" : "▶ Play") + item("loop", `${loopFor(k) ? "☑" : "☐"} Loop mode`) + `<hr>` + item("copy", "⧉ Copy (paste it on your own board)")
        + `<p class="hl-ctxn">Built-in pads keep their colors. Copy one to your board to restyle it.</p>`;
    } else {
      const b = myBoard(target.b), m = b.slots[target.i];
      if (m) {
        const key = `f:${b.id}:${target.i}`, bg = m.color || PAD_BG, tx = m.text || PAD_TX;
        h = `<p class="hl-ctxt">${esc(m.name)}</p>` + item("play", playing(key) ? "■ Stop" : "▶ Play") + item("loop", `${m.loop ? "☑" : "☐"} Loop mode`) + item("rename", "✎ Rename…")
          + `<label class="hl-ctxc">Button color <input type="color" data-col="color" value="${esc(bg)}"></label><label class="hl-ctxc">Text color <input type="color" data-col="text" value="${esc(tx)}"></label>`
          + item("reset", "↺ Reset colors") + `<hr>` + item("cut", "✂ Cut") + item("copy", "⧉ Copy") + item("paste", "📋 Paste here", clip ? "" : "disabled")
          + (m.ref ? "" : item("replace", "🎵 Replace sound file…")) + `<hr>` + item("clear", "✕ Clear pad");
      } else h = `<p class="hl-ctxt">Empty pad</p>` + item("paste", "📋 Paste", clip ? "" : "disabled") + item("add", "🎵 Add a sound file…");
    }
    box.innerHTML = h; box.hidden = false;
    const r = box.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    box.style.left = Math.max(6, Math.min(x, W - r.width - 6)) + "px"; box.style.top = Math.max(6, Math.min(y, H - r.height - 6)) + "px";
    const f = box.querySelector("button:not([disabled])"); if (f) f.focus({ preventScroll: true });
  }
  let pickFor = null;
  function menuAct(a) {
    const t = menuFor; if (!t) return;
    if (t.type === "built") {
      if (a === "play") hit(t.k); else if (a === "loop") { ov.loop[t.k] = !loopFor(t.k); saveOv(); paintPads(); toast(`Loop ${ov.loop[t.k] ? "on" : "off"}: ${nameOf(t.k)}`); }
      else if (a === "copy") { clip = fromBuiltIn(t.k); toast("Copied. Right-click a pad on your own board and paste."); }
      return closeMenu();
    }
    const b = myBoard(t.b), i = t.i, m = b && b.slots[i]; if (!b) return closeMenu();
    if (a === "play") hitFile(b.id, i);
    else if (a === "loop" && m) { m.loop = !m.loop; persist(); paintPads(); }
    else if (a === "rename" && m) { const n = prompt("Name this pad:", m.name); if (n && n.trim()) { m.name = n.trim().slice(0, 40); persist(); paintPads(); } }
    else if (a === "reset" && m) { m.color = ""; m.text = ""; persist(); paintPads(); }
    else if (a === "cut" && m) { clip = snap(m); clearSlot(b, i); toast("Cut. Paste it on any pad of your boards."); }
    else if (a === "copy" && m) { clip = snap(m); toast("Copied."); }
    else if (a === "paste") pasteInto(b, i);
    else if (a === "replace" || a === "add") { pickFor = { b: b.id, i, replace: true }; $("hl-file").click(); }
    else if (a === "clear" && m) clearSlot(b, i);
    closeMenu();
  }

  /* ---------- drawing ---------- */
  function paintTabs() {
    if (!cur() || (!myBoard(o.board) && !builtIn(o.board))) o.board = boards[0] ? boards[0].id : mine[0].id;
    const tab = (id, n, own) => `<button type="button" role="tab" data-board="${esc(id)}" aria-selected="${o.board === id}"${own ? ' class="own" title="Double-click to rename"' : ""}>${esc(n)}</button>`;
    $("hl-sbtabs").innerHTML = boards.map(b => tab(b.id, b.name)).join("") + mine.map(b => tab(b.id, b.name, true)).join("")
      + (mine.length < MAX_BOARDS ? `<button type="button" class="hl-sbnew" data-newboard title="Make a new board of your own">＋ New board</button>` : "");
    const own = !!myBoard(o.board); $("hl-mine").hidden = !own;
    if (own) { const b = myBoard(o.board); $("hl-mineaddrow").disabled = b.slots.length >= MAX_SLOTS; }
  }
  function padStyle(bg, tx) { return `--pc:${esc(bg)};--pt:${esc(ink(bg, tx))}`; }
  function paintPads() {
    paintTabs(); closeMenu();
    const pads = $("hl-pads"), b = cur(), own = !!myBoard(b.id), q = $("hl-sbq").value.trim().toLowerCase();
    pads.classList.add("grid"); pads.classList.toggle("mine", own);
    if (own) {
      pads.style.setProperty("--cols", COLS);
      pads.innerHTML = b.slots.map((m, i) => {
        const keyHint = i < 10 ? `key ${(i + 1) % 10}` : "";
        if (!m) return `<button type="button" class="hl-pad empty" data-slot="${i}" data-pick="${i}" title="Tap to add a sound, or drop a file here"><b>+</b></button>`;
        const key = `f:${b.id}:${i}`, hay = m.name.toLowerCase();
        return `<button type="button" class="hl-pad${m.loop ? " loop" : ""}${playing(key) ? " on" : ""}${q && !hay.includes(q) ? " dim" : ""}" draggable="true" data-slot="${i}" data-play="${i}" data-pk="${esc(key)}"${m.ref ? ` data-ref="${esc(m.ref)}"` : ""} style="${padStyle(m.color || PAD_BG, m.text || PAD_TX)}" title="${esc(m.name)}${keyHint ? ` (${keyHint})` : ""}. Right-click to edit."><b>${esc(m.name)}</b><small>${m.loop ? "⟳ loop" : ""}${m.ref ? " ⧉" : ""}</small></button>`;
      }).join("");
      $("hl-sbfrom").textContent = `${b.slots.filter(Boolean).length} of ${b.slots.length} pads used · saved in this browser`;
      return;
    }
    pads.style.setProperty("--cols", b.grid || COLS);
    const at = new Map(b.pads.map(p => [p.pos, p]));
    pads.innerHTML = Array.from({ length: b.size }, (_, i) => {
      const x = at.get(i); if (!x) return `<span class="hl-pad blank" aria-hidden="true"></span>`;
      const n = b.pads.indexOf(x), lp = loopFor(x.k), hay = (x.t + " " + (x.who || "")).toLowerCase();
      return `<button type="button" class="hl-pad${lp ? " loop" : ""}${playing("k:" + x.k) ? " on" : ""}${q && !hay.includes(q) ? " dim" : ""}" data-sfx="${esc(x.k)}" data-pk="k:${esc(x.k)}" style="${padStyle(x.color || PAD_BG, x.text || PAD_TX)}" title="${x.who && x.who !== "Phone" ? esc(x.who) + ": " : ""}${esc(x.t)}${n < 10 ? ` (key ${(n + 1) % 10})` : ""}. Press again to stop. Right-click for more."><b>${esc(x.t)}</b>${lp ? "<small>⟳ loop</small>" : ""}</button>`;
    }).join("");
    $("hl-sbfrom").innerHTML = b.legend ? b.legend.map(w => `<span class="hl-leg"><i style="background:${esc((CREW[w] || [PAD_BG])[0])}"></i>${esc(w === "Phone" ? "Phone sounds" : w)}</span>`).join("") : b.from ? `Layout from ${esc(b.from)}` : "";
  }
  function paintState() { for (const el of document.querySelectorAll("#hl-pads [data-pk]")) el.classList.toggle("on", playing(el.dataset.pk)); }
  function paint() {
    $("hl-sbroom").setAttribute("aria-pressed", String(o.room)); $("hl-sbline").setAttribute("aria-pressed", String(o.line)); $("hl-sbhear").setAttribute("aria-pressed", String(o.hear));
    $("hl-sbhear").textContent = o.hear ? "👂 Hearing room sounds" : "🙉 Room sounds off";
    $("hl-sbvol").value = o.vol; $("hl-sbvoln").textContent = Math.round(o.vol * 100) + "%";
    $("hl-sbhvol").value = o.hearVol; $("hl-sbhvoln").textContent = Math.round(o.hearVol * 100) + "%"; $("hl-sbhvol").disabled = !o.hear;
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
    const here = new Set(s.members.filter(m => m.on).map(m => m.id)); // their sounds stop when they leave
    for (const [key, set] of roomAud) if (!here.has(key.split("|")[0])) { set.forEach(a => a.pause()); roomAud.delete(key); }
  }

  async function init(opts) {
    send = opts.send; getMe = opts.me;
    let drops = [];
    try { drops = (await getJSON("data/clips.json")).map(c => ({ k: "c:" + c.k, t: c.line, who: c.who })); } catch (e) {}
    // Crew drops, laid out like a Broadcast Backpack board: filled down each column, one color per person. Colors are fixed.
    const order = ["Phone", "Ira", "IceCat", "DespicableDogs", "Dr. Tom Servo", "Andy Anderson", "Drake Dragsaw", "AnteaterTpose", "CrieFaux", "Rozin", "GreenImp", "PoopMyPee", "IDontKnow", "The Callective", "On the other end"];
    const crew = [...SFX.map(([k, t]) => ({ k, t, who: "Phone" })), ...drops].sort((a, b) => (order.indexOf(a.who) + 1 || 99) - (order.indexOf(b.who) + 1 || 99));
    const rows = 8, cols = Math.max(6, Math.ceil(crew.length / rows));
    crew.forEach((x, i) => { const c = CREW[x.who] || [PAD_BG, PAD_TX]; x.pos = (i % rows) * cols + Math.floor(i / rows); x.color = c[0]; x.text = c[1]; });
    crew.sort((a, b) => a.pos - b.pos);
    boards = [{ id: "drops", name: "Crew drops", grid: cols, size: cols * rows, pads: crew, legend: order.filter(w => crew.some(x => x.who === w)) }];
    try { // preset boards: {boards:[{id, name, cols, rows, pads:[{k:"b:<file>", t, file, pos, color, text, loop, sec}]}]}, audio in sfx/boards/
      const pre = await getJSON("data/hall-boards.json");
      for (const b of pre.boards || []) boards.push({ id: b.id, name: b.name, grid: b.cols || 8, size: (b.cols || 8) * (b.rows || 8), from: b.from || "",
        pads: b.pads.map(p => ({ k: p.k, t: p.t, who: p.who || "", src: `sfx/boards/${p.file}`, pos: p.pos, color: p.color, text: p.text, loop: !!p.loop, sec: p.sec })).sort((a, b) => a.pos - b.pos) });
    } catch (e) {}
    for (const b of boards) for (const p of b.pads) all.set(p.k, { t: p.t, src: p.src, loop: !!p.loop, sec: p.sec });
    await load();
    paintPads();

    $("hl-sbtabs").addEventListener("click", e => {
      if (e.target.closest("[data-newboard]")) return newBoard();
      const b = e.target.closest("[data-board]"); if (b && o.board !== b.dataset.board) { o.board = b.dataset.board; save(); paintPads(); }
    });
    $("hl-sbtabs").addEventListener("dblclick", e => { const t = e.target.closest("[data-board]"); const b = t && myBoard(t.dataset.board); if (b) renameBoard(b); });
    $("hl-sbq").addEventListener("input", paintPads);
    const pads = $("hl-pads"), picker = $("hl-file");
    pads.addEventListener("click", e => {
      if (Date.now() < longAt) return; // that touch opened the menu
      let el;
      if ((el = e.target.closest("[data-sfx]"))) return hit(el.dataset.sfx);
      if ((el = e.target.closest("[data-play]"))) return hitFile(o.board, +el.dataset.play);
      if ((el = e.target.closest("[data-pick]"))) { pickFor = { b: o.board, i: +el.dataset.pick, replace: false }; picker.click(); }
    });
    const targetOf = el => { const s = el.closest("[data-sfx]"); if (s) return { type: "built", k: s.dataset.sfx }; const p = el.closest("[data-slot]"); if (p && myBoard(o.board)) return { type: "mine", b: o.board, i: +p.dataset.slot }; return null; };
    pads.addEventListener("contextmenu", e => { const t = targetOf(e.target); if (!t) return; e.preventDefault(); openMenu(e.clientX, e.clientY, t); });
    let longT = 0, longAt = 0; // long-press on touch screens opens the same menu
    pads.addEventListener("touchstart", e => { const t = targetOf(e.target); if (!t) return; const p = e.touches[0]; clearTimeout(longT); longT = setTimeout(() => { longAt = Date.now() + 600; openMenu(p.clientX, p.clientY, t); }, 550); }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach(ev => pads.addEventListener(ev, () => clearTimeout(longT), { passive: true }));
    const menu = $("hl-ctx");
    menu.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b && !b.disabled) menuAct(b.dataset.act); });
    menu.addEventListener("input", e => { const c = e.target.closest("[data-col]"); if (!c || !menuFor || menuFor.type !== "mine") return; const m = myBoard(menuFor.b).slots[menuFor.i]; if (!m) return; m[c.dataset.col] = c.value; persist(); const el = pads.querySelector(`[data-slot="${menuFor.i}"]`); if (el) el.style.cssText = padStyle(m.color || PAD_BG, m.text || PAD_TX); });
    addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
    addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) closeMenu(); });
    addEventListener("scroll", () => { if (!menu.hidden) closeMenu(); }, true);
    picker.addEventListener("change", () => { const t = pickFor || { b: o.board, i: 0 }, b = myBoard(t.b); if (b) addFiles(b, picker.files, t.i, !!t.replace); picker.value = ""; pickFor = null; });
    $("hl-mineadd").addEventListener("click", () => { const b = myBoard(o.board); if (!b) return; pickFor = { b: b.id, i: Math.max(0, b.slots.findIndex(x => !x)), replace: false }; picker.click(); });
    $("hl-mineaddrow").addEventListener("click", () => { const b = myBoard(o.board); if (!b || b.slots.length >= MAX_SLOTS) return; b.slots.push(...new Array(COLS).fill(null)); persist(); paintPads(); });
    $("hl-minename").addEventListener("click", () => { const b = myBoard(o.board); if (b) renameBoard(b); });
    $("hl-minedel").addEventListener("click", () => { const b = myBoard(o.board); if (b) deleteBoard(b); });
    let armed = 0;
    $("hl-mineclear").addEventListener("click", () => {
      const b = myBoard(o.board); if (!b || !b.slots.some(Boolean)) return;
      if (Date.now() > armed) { armed = Date.now() + 3000; return toast(`Clear every pad on "${b.name}"? Tap again to confirm.`); }
      b.slots.forEach((m, i) => m && clearSlot(b, i, true)); persist(); paintPads();
    });
    // drag and drop: files onto a pad (or anywhere on the board), pads onto pads to swap
    let dragFrom = null;
    pads.addEventListener("dragstart", e => { const p = e.target.closest("[data-slot]"); if (p && myBoard(o.board)) { dragFrom = +p.dataset.slot; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "pad"); } });
    pads.addEventListener("dragend", () => { dragFrom = null; pads.querySelectorAll(".over").forEach(x => x.classList.remove("over")); });
    const zone = $("hl-sb");
    zone.addEventListener("dragover", e => {
      const files = [...(e.dataTransfer.types || [])].includes("Files"); if (!files && dragFrom === null) return;
      e.preventDefault(); e.dataTransfer.dropEffect = files ? "copy" : "move";
      if (files && !myBoard(o.board)) { o.board = mine[0].id; save(); paintPads(); }
      zone.classList.add("dropping"); pads.querySelectorAll(".over").forEach(x => x.classList.remove("over"));
      const p = e.target.closest && e.target.closest("[data-slot]"); if (p) p.classList.add("over");
    });
    zone.addEventListener("dragleave", e => { if (!zone.contains(e.relatedTarget)) { zone.classList.remove("dropping"); pads.querySelectorAll(".over").forEach(x => x.classList.remove("over")); } });
    zone.addEventListener("drop", e => {
      e.preventDefault(); zone.classList.remove("dropping");
      const b = myBoard(o.board); if (!b) return;
      const p = e.target.closest && e.target.closest("[data-slot]"), at = p ? +p.dataset.slot : null;
      if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(b, e.dataTransfer.files, at === null ? Math.max(0, b.slots.findIndex(x => !x)) : at, at !== null);
      else if (dragFrom !== null && at !== null) swap(b, dragFrom, at);
      dragFrom = null; pads.querySelectorAll(".over").forEach(x => x.classList.remove("over"));
    });
    // number keys hit the first ten pads of the board you're on
    addEventListener("keydown", e => {
      if (!/^[0-9]$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
      if (!room || $("hl-room").hidden || Router.page !== "host") return;
      const i = (+e.key + 9) % 10, b = cur();
      if (myBoard(b.id)) hitFile(b.id, i); else if (b.pads[i]) hit(b.pads[i].k);
    });
    $("hl-sbstop").addEventListener("click", stopAll);
    $("hl-sbroom").addEventListener("click", () => { o.room = !o.room; save(); paint(); });
    $("hl-sbline").addEventListener("click", () => { o.line = !o.line; save(); paint(); $("hl-sbdevrow").hidden = !o.line; if (o.line) devices(true); });
    $("hl-sbhear").addEventListener("click", () => { o.hear = !o.hear; save(); paint(); });
    $("hl-sbvol").addEventListener("input", e => { setVol(+e.target.value); $("hl-sbvoln").textContent = Math.round(o.vol * 100) + "%"; });
    $("hl-sbhvol").addEventListener("input", e => { setHear(+e.target.value); $("hl-sbhvoln").textContent = Math.round(o.hearVol * 100) + "%"; });
    $("hl-sbdev").addEventListener("change", e => { o.dev = e.target.value; save(); if (o.dev) playTo("sfx/ring.mp3", o.dev, o.vol * 0.6); });
    $("hl-sbtest").addEventListener("click", () => o.dev ? playTo("sfx/ring.mp3", o.dev, o.vol) : devices(true));
    $("hl-sbhost").addEventListener("change", e => send({ type: "cmd", text: "!soundboard " + e.target.value }));
    $("hl-sbdevrow").hidden = !o.line; if (o.line) devices(false);
    paint();
  }
  return { init, onState, onSfx, onVol, stopAll, enterRoom: code => { room = code; importOld(code); }, leaveRoom: () => { stopAll(); room = null; } };
})();
