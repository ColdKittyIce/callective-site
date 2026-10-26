/* The Hall: host your own Callective. Text chat + the queue bot, one room per code (#host/BUTT-1234).
   The room lives in a durable object on the worker; this file is just the screen and the WebSocket. */
const Hall = (() => {
  const CODE_RE = /^[A-Z]{2,6}-\d{4}$/;
  let ws = null, code = null, me = null, st = null, tries = 0, retry = null, leaving = false, sound = true, lastN = 0;
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
    h = h.replace(/:pla:/gi, '<span class="hl-pla" title=":PLA:">🔔</span>').replace(/:thecallectivetitle:/gi, '<span class="hl-pla" title=":TheCallectiveTitle:">📣</span>');
    if (me && me.name) h = h.replace(new RegExp(`(^|[^\\w])(@?${me.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w])`, "gi"), '$1<mark>$2</mark>');
    return h.replace(/\n/g, "<br>");
  }
  function err(msg) { const e = $("hl-err"); e.textContent = msg || ""; e.hidden = !msg; }
  function status(msg) { const e = $("hl-status"); e.textContent = msg || ""; e.hidden = !msg; }
  function show(inRoom) { $("hl-lobby").hidden = inRoom; $("hl-room").hidden = !inRoom; }

  function addMsg(m) {
    const log = $("hl-log"), stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (m.n && m.n <= lastN) return; if (m.n) lastN = m.n;
    const div = document.createElement("div");
    div.className = "hl-msg" + (m.bot ? " bot" : "") + (m.only ? " only" : "") + (m.cmd ? " cmd" : "");
    const badge = m.bot ? '<i class="hl-tag bot">BOT</i>' : m.host ? '<i class="hl-tag host">HOST</i>' : m.mod ? '<i class="hl-tag mod">MOD</i>' : "";
    div.innerHTML = `<span class="hl-t">${time(m.at)}</span><span class="hl-who">${m.flair ? esc(m.flair) + " " : ""}${esc(m.name)}${badge}</span><span class="hl-txt">${fmt(m.text)}${m.only ? '<em class="hl-only">Only you can see this</em>' : ""}</span>`;
    log.appendChild(div);
    while (log.children.length > 300) log.firstChild.remove();
    if (stick || m.only || (me && m.name === me.name)) log.scrollTop = log.scrollHeight;
  }
  function render() {
    if (!st) return;
    const y = st.you || {}, mod = !!y.mod;
    $("hl-title").textContent = st.title; $("hl-code").textContent = st.code;
    $("hl-lock").hidden = !st.locked;
    const lb = $("hl-lockbtn"); lb.dataset.cmd = st.locked ? "!unlock" : "!lock"; lb.textContent = st.locked ? "🔓 Unlock" : "🔒 Lock";
    $("hl-mod").hidden = !mod; $("hl-obs").hidden = !mod; $("hl-obs").href = `obs.html?room=${encodeURIComponent(st.code)}`;
    $("hl-cur").textContent = st.cur ? st.cur.name : "Nobody yet";
    $("hl-cur").classList.toggle("me", !!(st.cur && st.cur.id && st.cur.id === y.id));
    $("hl-calls").textContent = st.calls ? `${st.calls} call${st.calls === 1 ? "" : "s"} so far` : "";
    const inLine = st.queue.findIndex(e => e.id === y.id);
    const bell = $("hl-bell"); bell.textContent = inLine >= 0 ? `👋 Leave line (#${inLine + 1})` : "🔔 Get in line"; bell.disabled = st.locked && !mod && inLine < 0;
    $("hl-qn").textContent = st.queue.length ? `(${st.queue.length})` : "";
    $("hl-q").innerHTML = st.queue.length ? st.queue.map((e, i) => `<li class="${e.id && e.id === y.id ? "me" : ""}${e.all ? " all" : ""}">
        <span class="hl-qn">${i + 1}</span><span class="hl-qname">${e.all ? `📣 ALL CALL <small>by ${esc(e.by)}</small>` : `${e.flair ? esc(e.flair) + " " : ""}${esc(e.name)}`}</span>
        ${mod ? `<span class="hl-qctl"><button type="button" data-cmd="!up #${i + 1}" aria-label="Move up" ${i ? "" : "disabled"}>▲</button><button type="button" data-cmd="!down #${i + 1}" aria-label="Move down" ${i < st.queue.length - 1 ? "" : "disabled"}>▼</button><button type="button" data-cmd="!remove #${i + 1}" aria-label="Remove">✕</button></span>` : ""}</li>`).join("")
      : `<li class="hl-empty">Empty. ${st.locked ? "The line is locked." : "Drop 🔔 in chat to get in."}</li>`;
    const on = st.members.filter(m => m.on).length;
    $("hl-mn").textContent = `(${on})`;
    $("hl-mem").innerHTML = st.members.map(m => {
      const tag = m.host ? '<i class="hl-tag host">HOST</i>' : m.mod ? '<i class="hl-tag mod">MOD</i>' : "";
      let ctl = "";
      if (mod && m.id !== y.id && !m.host && (y.host || !m.mod)) {
        ctl = `<span class="hl-mctl">${y.host ? `<button type="button" data-cmd="!${m.mod ? "unmod" : "mod"} ${esc(m.name)}" title="${m.mod ? "Take away mod" : "Make mod"}">🛡️</button>` : ""}<button type="button" data-cmd="!kick ${esc(m.name)}" data-confirm="Remove ${esc(m.name)} from the room?" title="Remove from room">👢</button><button type="button" data-cmd="!blacklist ${esc(m.name)}" data-confirm="Blacklist ${esc(m.name)}? They can't come back in." title="Blacklist">⛔</button></span>`;
      }
      return `<li class="${m.on ? "" : "off"}${m.id === y.id ? " me" : ""}"><i class="hl-dot" aria-hidden="true"></i><span>${m.flair ? esc(m.flair) + " " : ""}${esc(m.name)}${tag}</span>${ctl}</li>`;
    }).join("");
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
      if (d.type === "welcome") { me = { id: d.id, name: d.name }; store.put(code, { key: d.key, name: d.name }); store.setName(d.name); show(true); history.replaceState(null, "", "#host/" + code); }
      else if (d.type === "log") { $("hl-log").innerHTML = ""; lastN = 0; d.log.forEach(addMsg); $("hl-log").scrollTop = 1e9; }
      else if (d.type === "msg") addMsg(d.msg);
      else if (d.type === "state") { st = d; render(); }
      else if (d.type === "ping") { if (sound) { try { sample("ring", .8); } catch (x) {} } toast(d.text); flash(d.text); }
      else if (d.type === "error") fatal = d.error;
      else if (d.type === "closed") fatal = "The host closed the room.";
    };
    sock.onclose = ev => {
      clearInterval(keep); if (sock !== ws) return;
      if (leaving) return;
      if (ev.code >= 4000 || fatal) {
        if (ev.code === 4003 || ev.code === 4004 || ev.code === 4001) store.put(code, null);
        ws = null; show(false); err(fatal || ev.reason || "Couldn't get into that room."); history.replaceState(null, "", "#host"); return;
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
    leaving = false; tries = 0; $("hl-log").innerHTML = ""; lastN = 0; st = null; connect();
  }
  function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } toast("Not connected yet"); return false; }
  const cmd = t => send({ type: "cmd", text: t });
  function leave() {
    leaving = true; clearTimeout(retry); if (ws) try { ws.close(1000); } catch (e) {} ws = null; st = null; me = null;
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
      if (send({ type: "say", text: t })) i.value = "";
    });
    $("hl-bell").addEventListener("click", () => { const y = st && st.you; cmd(st && st.queue.some(e => e.id === (y && y.id)) ? "!leave" : "!join"); });
    $("hl-all").addEventListener("click", () => cmd("!allcall"));
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
    addEventListener("hashchange", fromHash); fromHash();
  }
  return { init, get code() { return code; } };
})();
