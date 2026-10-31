/* The Hall: host your own Callective. Text chat + the queue bot, one room per code (#host/BUTT-1234).
   The room lives in a durable object on the worker; this file is just the screen and the WebSocket. */
const Hall = (() => {
  const CODE_RE = /^[A-Z]{2,6}-\d{4}$/;
  let ws = null, code = null, me = null, st = null, view = "room", dms = new Map(), unread = new Map(), names = new Map(), closed = new Set(), tries = 0, retry = null, leaving = false, sound = true, lastN = 0;
  const store = {
    get() { try { return JSON.parse(localStorage.getItem("cx-hall") || "{}"); } catch (e) { return {}; } },
    set(o) { try { localStorage.setItem("cx-hall", JSON.stringify(o)); } catch (e) {} },
    room(c) { return this.get()[c] || null; },
    put(c, v) { const o = this.get(); if (v) o[c] = { ...v, at: Date.now() }; else delete o[c]; this.set(o); },
    name() { try { return localStorage.getItem("cx-hall-name") || ""; } catch (e) { return ""; } },
    setName(n) { try { localStorage.setItem("cx-hall-name", n); } catch (e) {} }
  };
  const normCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]{2,6})(\d{4})$/, "$1-$2");
  const time = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function fmt(text) {
    let h = esc(text);
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    h = h.replace(/:pla:|🔔/gi, '<img class="hl-pla" src="img/pla-bell.png" alt=":PLA:" title=":PLA:">').replace(/:thecallectivetitle:/gi, '<span class="hl-pla" title=":TheCallectiveTitle:">📣</span>');
    if (me && me.name) h = h.replace(new RegExp(`(^|[^\\w])(@?${me.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w])`, "gi"), '$1<mark>$2</mark>');
    return h.replace(/\n/g, "<br>");
  }
  function err(msg) { const e = $("hl-err"); e.textContent = msg || ""; e.hidden = !msg; }
  function status(msg) { const e = $("hl-status"); e.textContent = msg || ""; e.hidden = !msg; }
  function show(inRoom) { $("hl-lobby").hidden = inRoom; $("hl-guide").hidden = inRoom; $("hl-room").hidden = !inRoom; }

  function addMsg(m) {
    const log = $("hl-log"), stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (m.n && m.n <= lastN) return; if (m.n) lastN = m.n;
    const div = document.createElement("div");
    div.className = "hl-msg" + (m.bot ? " bot" : "") + (m.only ? " only" : "") + (m.cmd ? " cmd" : "");
    if (m.uid) { div.dataset.uid = m.uid; div.hidden = blocked(m.uid); }
    const badge = m.bot ? '<i class="hl-tag bot">BOT</i>' : m.host ? '<i class="hl-tag host">HOST</i>' : m.mod ? '<i class="hl-tag mod">MOD</i>' : "";
    div.innerHTML = `<span class="hl-t">${time(m.at)}</span><span class="hl-who">${m.bot ? '<img class="hl-av" src="img/art/patrick-avatar.webp" alt="">' : ""}${m.flair ? esc(m.flair) + " " : ""}${esc(m.name)}${badge}</span><span class="hl-txt">${fmt(m.text)}${m.only ? '<em class="hl-only">Only you can see this</em>' : ""}</span>`;
    log.appendChild(div);
    while (log.children.length > 300) log.firstChild.remove();
    if (stick || m.only || (me && m.name === me.name)) log.scrollTop = log.scrollHeight;
  }
  const blocked = id => !!(st && st.you && (st.you.blocks || []).includes(id));
  const nameOf = id => (st && st.members.find(m => m.id === id) || {}).name || names.get(id) || "someone";
  function linkify(text) {
    return esc(text).replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/gi, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>').replace(/\n/g, "<br>");
  }
  function dmLine(dm, el) {
    const div = document.createElement("div"), mine = me && dm.from === me.id;
    div.className = "hl-msg" + (mine ? " mine" : "") + (dm.sys ? " only" : "");
    div.innerHTML = `<span class="hl-t">${time(dm.at)}</span><span class="hl-who">${esc(dm.sys ? "Patrick Howard" : mine ? "You" : dm.fromName)}</span><span class="hl-txt">${linkify(dm.text)}</span>`;
    el.appendChild(div);
  }
  function addDM(dm, quiet) {
    const other = me && dm.from === me.id ? dm.to : dm.from;
    names.set(dm.from, dm.fromName); if (dm.toName) names.set(dm.to, dm.toName);
    const list = dms.get(other) || []; if (dm.n && list.some(x => x.n === dm.n)) return; list.push(dm); dms.set(other, list);
    if (!quiet || dm.sys) closed.delete(other);
    if (view === other) { const el = $("hl-dmlog"); dmLine(dm, el); el.scrollTop = el.scrollHeight; }
    else if (!quiet && dm.from !== (me && me.id)) {
      unread.set(other, (unread.get(other) || 0) + 1);
      if (sound) { try { sample("page", .5); } catch (x) {} } toast(`✉️ DM from ${dm.fromName}`); flash(`DM from ${dm.fromName}`);
    }
    tabs();
  }
  function tabs() {
    const ids = [...dms.keys()].filter(id => !closed.has(id)); if (view !== "room" && !ids.includes(view)) ids.push(view);
    $("hl-tabs").innerHTML = `<button type="button" role="tab" data-view="room" aria-selected="${view === "room"}"># Room</button>` + ids.map(id => {
      const n = unread.get(id) || 0;
      return `<button type="button" role="tab" data-view="${esc(id)}" aria-selected="${view === id}">✉️ ${esc(nameOf(id))}${n ? `<i>${n}</i>` : ""}<span class="hl-x" data-closedm="${esc(id)}" title="Close">×</span></button>`;
    }).join("");
  }
  function openView(v) {
    view = v; unread.delete(v); closed.delete(v); const room = v === "room";
    $("hl-log").hidden = !room; $("hl-dm").hidden = room;
    $("hl-in").placeholder = room ? "Say something… or !help" : `Private message to ${nameOf(v)}… numbers and links are OK here`;
    if (!room) {
      const el = $("hl-dmlog"); el.innerHTML = "";
      el.insertAdjacentHTML("beforeend", `<p class="hl-dmnote">🔒 Only you and <b>${esc(nameOf(v))}</b> can see this. Phone numbers and links are fine in DMs. The room's mods can't read it. DMs disappear when the room closes.</p>`);
      (dms.get(v) || []).forEach(dm => dmLine(dm, el)); el.scrollTop = el.scrollHeight;
      $("hl-dmwho").textContent = `✉️ ${nameOf(v)}`; $("hl-block").textContent = blocked(v) ? "Unblock" : "🚫 Block";
    }
    tabs(); $("hl-in").focus();
  }
  // The room list: people in voice first (with live mic icons, like Discord), then everyone else here, then people who stepped away.
  // Tap a name to open their actions (DM, volume, mod tools).
  const opened = new Set();
  function members() {
    if (!st) return;
    const y = st.you || {}, mod = !!y.mod, box = $("hl-mem");
    if (box.contains(document.activeElement) && document.activeElement.type === "range") return; // don't yank a slider mid-drag
    const on = st.members.filter(m => m.on).length;
    $("hl-mn").textContent = `(${on})`;
    const row = m => {
      const tag = m.host ? '<i class="hl-tag host">HOST</i>' : m.mod ? '<i class="hl-tag mod">MOD</i>' : "";
      const v = HallVoice.info(m, y), open = opened.has(m.id), self = m.id === y.id;
      let acts = "";
      if (!self) acts += `<button type="button" data-dm="${esc(m.id)}">✉️ DM</button>`;
      if (v && v.slider) acts += v.slider;
      if (v && v.modBtn) acts += v.modBtn;
      if (mod && !self && !m.host && (y.host || !m.mod)) {
        if (y.host) acts += `<button type="button" data-cmd="!${m.mod ? "unmod" : "mod"} ${esc(m.name)}">🛡️ ${m.mod ? "Unmod" : "Make mod"}</button>`;
        acts += `<button type="button" data-cmd="!kick ${esc(m.name)}" data-confirm="Remove ${esc(m.name)} from the room?">👢 Kick</button><button type="button" data-cmd="!blacklist ${esc(m.name)}" data-confirm="Blacklist ${esc(m.name)}? They can't come back in.">⛔ Blacklist</button>`;
      }
      if (!self) acts += `<button type="button" data-blk="${esc(m.id)}">${blocked(m.id) ? "Unblock" : "🚫 Block"}</button>`;
      const icon = v ? `<i class="hl-vic${v.status.startsWith("live") ? " live" : ""}" aria-hidden="true">${v.icon}</i>` : `<i class="hl-dot" aria-hidden="true"></i>`;
      return `<li class="${m.on ? "" : "off"}${self ? " me" : ""}${blocked(m.id) ? " blocked" : ""}${v ? " vc" : ""}${open ? " open" : ""}"${v ? ` data-vid="${esc(m.id)}"` : ""}>
        <button type="button" class="hl-who" data-row="${esc(m.id)}" aria-expanded="${open}">${icon}<span class="hl-nm">${m.flair ? esc(m.flair) + " " : ""}${esc(m.name)}${self ? " <small>(you)</small>" : ""}</span>${tag}${v ? `<small class="hl-vst">${esc(v.status)}</small>` : ""}</button>
        ${open && acts ? `<div class="hl-acts2">${acts}</div>` : ""}</li>`;
    };
    const inV = st.members.filter(m => m.v), here = st.members.filter(m => !m.v && m.on), away = st.members.filter(m => !m.v && !m.on);
    const grp = (label, list) => list.length ? `<li class="hl-grp">${label}</li>${list.map(row).join("")}` : "";
    box.innerHTML = grp(`🔊 Voice · ${inV.length}/${st.vmax || 12}`, inV) + grp(`Here · ${here.length}`, here) + grp(`Stepped away · ${away.length}`, away);
  }
  document.addEventListener("hall-voice", members);
  function render() {
    if (!st) return;
    const y = st.you || {}, mod = !!y.mod;
    $("hl-title").textContent = st.title; $("hl-code").textContent = st.code;
    $("hl-lock").hidden = !st.locked;
    $("hl-closed").hidden = !st.locked;
    const lb = $("hl-lockbtn"); lb.dataset.cmd = st.locked ? "!unlock" : "!lock"; lb.textContent = st.locked ? "🔓 Unlock" : "🔒 Lock";
    $("hl-mod").hidden = !mod; $("hl-obs").hidden = !mod; $("hl-obs").href = `obs.html?room=${encodeURIComponent(st.code)}`;
    $("hl-cur").textContent = st.cur ? st.cur.name : "Nobody yet";
    $("hl-cur").classList.toggle("me", !!(st.cur && st.cur.id && st.cur.id === y.id));
    $("hl-calls").textContent = st.calls ? `${st.calls} call${st.calls === 1 ? "" : "s"} so far` : "";
    const inLine = st.queue.findIndex(e => e.id === y.id);
    const bell = $("hl-bell"); bell.innerHTML = inLine >= 0 ? `👋 Leave line (#${inLine + 1})` : `<img class="hl-pla" src="img/pla-bell.png" alt=""> Get in line`; bell.disabled = st.locked && !mod && inLine < 0;
    $("hl-qn").textContent = st.queue.length ? `(${st.queue.length})` : "";
    $("hl-q").innerHTML = st.queue.length ? st.queue.map((e, i) => `<li class="${e.id && e.id === y.id ? "me" : ""}${e.all ? " all" : ""}">
        <span class="hl-qn">${i + 1}</span><span class="hl-qname">${e.all ? `📣 ALL CALL <small>by ${esc(e.by)}</small>` : `${e.flair ? esc(e.flair) + " " : ""}${esc(e.name)}`}</span>
        ${mod ? `<span class="hl-qctl"><button type="button" data-cmd="!up #${i + 1}" aria-label="Move up" ${i ? "" : "disabled"}>▲</button><button type="button" data-cmd="!down #${i + 1}" aria-label="Move down" ${i < st.queue.length - 1 ? "" : "disabled"}>▼</button><button type="button" data-cmd="!remove #${i + 1}" aria-label="Remove">✕</button></span>` : ""}</li>`).join("")
      : `<li class="hl-empty">Empty. ${st.locked ? "The line is locked." : 'Drop the <img class="hl-pla" src="img/pla-bell.png" alt="PLA bell"> in chat to get in.'}</li>`;
    const on = st.members.filter(m => m.on).length;
    members();
    for (const div of $("hl-log").querySelectorAll("[data-uid]")) div.hidden = blocked(div.dataset.uid);
    st.members.forEach(m => names.set(m.id, m.name));
    if (view !== "room") $("hl-block").textContent = blocked(view) ? "Unblock" : "🚫 Block";
    tabs();
  }

  function wsUrl(params) { return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/hall/${encodeURIComponent(code)}/ws?${new URLSearchParams(params)}`; }
  function connect() {
    clearTimeout(retry); const saved = store.room(code) || {};
    status(tries ? "Reconnecting…" : "Connecting…");
    const sock = ws = new WebSocket(wsUrl({ name: saved.name || "", key: saved.key || "" }));
    let fatal = null, keep = null;
    sock.onopen = () => { tries = 0; status(""); keep = setInterval(() => { try { sock.send("ping"); } catch (e) {} }, 30000); };
    sock.onmessage = e => {
      if (e.data === "pong") return;
      let d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (d.type === "welcome") { const again = !!me; me = { id: d.id, name: d.name }; if (again) HallVoice.onReconnect(); else HallSB.enterRoom(code); store.put(code, { key: d.key, name: d.name }); store.setName(d.name); show(true); history.replaceState(null, "", "#host/" + code); }
      else if (d.type === "log") { $("hl-log").innerHTML = ""; lastN = 0; d.log.forEach(addMsg); $("hl-log").scrollTop = 1e9; }
      else if (d.type === "msg") addMsg(d.msg);
      else if (d.type === "rtc") HallVoice.onSignal(d.from, d.sig);
      else if (d.type === "sfx") HallSB.onSfx(d);
      else if (d.type === "sfxvol") HallSB.onVol(d);
      else if (d.type === "forcemute") HallVoice.onForceMute(d.except);
      else if (d.type === "voiceoff") HallVoice.off(d.why);
      else if (d.type === "voicefull") { HallVoice.off(`Voice is full (${d.max} max).`); }
      else if (d.type === "dms") { dms.clear(); d.list.forEach(x => addDM(x, true)); if (view !== "room") openView(view); }
      else if (d.type === "dm") addDM(d.dm);
      else if (d.type === "dmfail") addDM({ n: 0, at: Date.now(), sys: true, from: d.to, fromName: "", to: me && me.id, text: d.error }, true);
      else if (d.type === "state") { st = d; render(); HallVoice.onState(d); HallSB.onState(d); }
      else if (d.type === "ping") { if (sound) { try { sample("ring", .8); } catch (x) {} } toast(d.text); flash(d.text); }
      else if (d.type === "error") fatal = d.error;
      else if (d.type === "closed") fatal = "The host closed the room.";
    };
    sock.onclose = ev => {
      clearInterval(keep); if (sock !== ws) return;
      if (leaving) return;
      if (ev.code >= 4000 || fatal) {
        if (ev.code === 4003 || ev.code === 4004 || ev.code === 4001) store.put(code, null);
        ws = null; me = null; HallVoice.leave(true); show(false); err(fatal || ev.reason || "Couldn't get into that room."); history.replaceState(null, "", "#host"); return;
      }
      tries++; status("Lost the connection. Reconnecting…"); retry = setTimeout(connect, Math.min(15000, 800 * 2 ** Math.min(tries, 5)));
    };
  }
  let flashT = null;
  function flash(msg) {
    const orig = "The Callective"; let on = false, n = 0; clearInterval(flashT);
    if (!document.hidden) return;
    flashT = setInterval(() => { document.title = (on = !on) ? "📞 " + msg : orig; if (++n > 20 || !document.hidden) { clearInterval(flashT); document.title = orig; } }, 900);
  }
  function enter(c, name) {
    code = c; err("");
    if (name) { const saved = store.room(c); if (!saved || saved.name.toLowerCase() !== name.toLowerCase()) store.put(c, { key: saved && saved.key && saved.name.toLowerCase() === name.toLowerCase() ? saved.key : "", name }); }
    leaving = false; tries = 0; $("hl-log").innerHTML = ""; lastN = 0; st = null; dms.clear(); unread.clear(); names.clear(); view = "room"; openView("room"); connect();
  }
  function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } toast("Not connected yet"); return false; }
  const cmd = t => send({ type: "cmd", text: t });
  function leave() {
    leaving = true; clearTimeout(retry); HallVoice.leave(true); HallSB.leaveRoom(code); if (ws) try { ws.close(1000); } catch (e) {} ws = null; st = null; me = null;
    show(false); history.replaceState(null, "", "#host"); status("");
  }

  function fromHash() {
    const m = location.hash.match(/^#host\/([A-Za-z0-9-]+)/); if (!m) return;
    const c = normCode(m[1]); if (!CODE_RE.test(c)) return;
    if (ws && code === c) return;
    $("hl-join-code").value = c;
    const saved = store.room(c);
    if (saved && saved.key) enter(c); else { $("hl-join-name").focus(); }
  }
  function init() {
    const nm = store.name(); if (nm) { $("hl-new-name").value = nm; $("hl-join-name").value = nm; }
    $("hl-new").addEventListener("submit", async e => {
      e.preventDefault(); err("");
      const name = $("hl-new-name").value.trim(), title = $("hl-new-title").value.trim();
      if (name.length < 2) return err("Pick a name (2 to 24 characters).");
      const btn = e.submitter || e.target.querySelector("button"); btn.disabled = true;
      try {
        const r = await fetch("/api/hall", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
        const o = await r.json(); if (!r.ok) throw new Error(o.error || "Couldn't open a room");
        store.put(o.code, { key: o.hostKey, name }); store.setName(name); enter(o.code);
      } catch (x) { err(x.message || "Couldn't open a room. Try again."); }
      btn.disabled = false;
    });
    $("hl-join").addEventListener("submit", async e => {
      e.preventDefault(); err("");
      const c = normCode($("hl-join-code").value), name = $("hl-join-name").value.trim();
      if (!CODE_RE.test(c)) return err("Codes look like BUTT-1234.");
      if (name.length < 2) return err("Pick a name (2 to 24 characters).");
      try { const r = await fetch(`/api/hall/${c}`); if (!r.ok) return err((await r.json()).error || "No room with that code."); } catch (x) {}
      enter(c, name);
    });
    $("hl-join-code").addEventListener("blur", e => { const c = normCode(e.target.value); if (c) e.target.value = c; });
    $("hl-form").addEventListener("submit", e => {
      e.preventDefault(); const i = $("hl-in"), t = i.value.trim(); if (!t) return;
      if (send(view === "room" ? { type: "say", text: t } : { type: "dm", to: view, text: t })) i.value = "";
    });
    $("hl-bell").addEventListener("click", () => { const y = st && st.you; cmd(st && st.queue.some(e => e.id === (y && y.id)) ? "!leave" : "!join"); });
    $("hl-all").addEventListener("click", () => cmd("!allcall"));
    $("hl-tabs").addEventListener("click", e => {
      const x = e.target.closest("[data-closedm]"); if (x) { e.stopPropagation(); const id = x.dataset.closedm; closed.add(id); unread.delete(id); if (view === id) openView("room"); else tabs(); return; }
      const b = e.target.closest("[data-view]"); if (b) openView(b.dataset.view);
    });
    $("hl-mem").addEventListener("click", e => {
      const d = e.target.closest("[data-dm]"); if (d) return openView(d.dataset.dm);
      const k = e.target.closest("[data-blk]"); if (k) return send({ type: blocked(k.dataset.blk) ? "unblock" : "block", to: k.dataset.blk });
      const r = e.target.closest("[data-row]"); if (r) { const id = r.dataset.row; opened.has(id) ? opened.delete(id) : opened.add(id); members(); }
    });
    $("hl-block").addEventListener("click", () => { if (view !== "room") send({ type: blocked(view) ? "unblock" : "block", to: view }); });
    try { sound = localStorage.getItem("cx-hall-sound") !== "0"; } catch (e) {}
    const sb = $("hl-sound"), paint = () => { sb.setAttribute("aria-pressed", sound); sb.textContent = sound ? "🔊 Ring me" : "🔇 Ring me"; };
    paint(); sb.addEventListener("click", () => { sound = !sound; paint(); try { localStorage.setItem("cx-hall-sound", sound ? "1" : "0"); } catch (e) {} if (sound) try { sample("ring", .5); } catch (x) {} });
    const armed = new Map();
    $("hl-room").addEventListener("click", e => {
      const b = e.target.closest("[data-cmd]"); if (!b) return;
      if (b.dataset.confirm) { // tap twice to confirm
        if (armed.get(b.dataset.cmd) > Date.now()) armed.delete(b.dataset.cmd);
        else { armed.set(b.dataset.cmd, Date.now() + 3000); toast(b.dataset.confirm + " Tap again to confirm."); return; }
      }
      cmd(b.dataset.cmd);
    });
    const invite = () => { const u = `${location.origin}${location.pathname}#host/${code}`; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast("Invite link copied"), () => prompt("Copy the invite link:", u)); };
    $("hl-invite").addEventListener("click", invite); $("hl-code").addEventListener("click", invite);
    $("hl-leave").addEventListener("click", leave);
    HallVoice.init({ send, me: () => me }); HallSB.init({ send, me: () => me });
    addEventListener("hashchange", fromHash); fromHash();
  }
  return { init, get code() { return code; } };
})();
