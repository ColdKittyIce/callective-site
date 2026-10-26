/* Host your own Callective: one Durable Object per room (a "Hall").
   It's the Discord text chat plus the queue bot in one place. Everyone in the room holds a WebSocket to it;
   the bot answers commands the way the real one does (!join, !next, !lock …) and the page shows the line.
   Hibernation keeps it free while people sit idle. Rooms delete themselves after 12 quiet hours. */
import { DurableObject } from "cloudflare:workers";
import { screen, SLURS } from "./screen.js";

const IDLE_MS = 12 * 3600e3, ALLCALL_COOLDOWN = 60e3, LOG_MAX = 150, MAX_ONLINE = 150;
const BOT = "Patrick Howard", DM_KEEP = 60;
const now = () => Date.now();
const rid = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
async function hash(s) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join(""); }
const tidy = (s, n) => String(s ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
const low = s => String(s || "").toLowerCase().replace(/^@/, "");
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const HELP_USER = "**Everyone:** `!join` (or drop 🔔 / :PLA: in chat) · `!leave` · `!queue` · `!position` · `!allcall` (or :TheCallectiveTitle:) · `!flair <emoji|off>` · `!mystats` · `!dm <name> <message>` (private: numbers and links are OK in DMs) · `!block <name>` / `!unblock <name>`";
const HELP_MOD = "**Mods:** `!next` · `!remove <name|#pos>` · `!move <name> <pos>` · `!swap <a> <b>` · `!shuffle` · `!reverse` · `!lock` · `!unlock` · `!clear` · `!allcall <pos>` · `!kick <name>` · `!blacklist <name>` · `!unblacklist <name>` · `!blacklistlist`\n**Host:** `!mod <name>` · `!unmod <name>` · `!title <text>` · `!close`";

export class Hall extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.s = (await ctx.storage.get("s")) || null; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  async save() { if (!this.s) return; this.s.lastAt = now(); await this.ctx.storage.put("s", this.s); await this.ctx.storage.setAlarm(this.s.lastAt + IDLE_MS); }

  async fetch(req) {
    const url = new URL(req.url), p = url.pathname;
    if (p === "/create") {
      if (this.s) return Response.json({ error: "taken" }, { status: 409 });
      const b = await req.json(), hostKey = rid(24);
      this.s = { code: b.code, title: b.title || "The Callective", created: now(), lastAt: now(), hostKey: await hash(hostKey),
        locked: false, allcallAt: 0, cur: null, queue: [], members: {}, ban: { names: [], ips: [], ids: [] }, log: [], seq: 0, calls: 0 };
      this.post(null, `📞 **${this.s.title}** is open. Drop 🔔 or type \`!join\` to get in line. \`!help\` for everything else.`);
      await this.save();
      return Response.json({ ok: true, hostKey });
    }
    if (p === "/info") {
      if (!this.s) return Response.json({ error: "No room with that code" }, { status: 404 });
      return Response.json({ code: this.s.code, title: this.s.title, online: this.online().size, inLine: this.s.queue.length, locked: this.s.locked });
    }
    if (p === "/ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      const pair = new WebSocketPair(), [client, ws] = Object.values(pair);
      this.ctx.acceptWebSocket(ws);
      const fail = (msg, code = 4000) => { ws.send(JSON.stringify({ type: "error", error: msg })); ws.close(code, msg.slice(0, 120)); return new Response(null, { status: 101, webSocket: client }); };
      if (!this.s) return fail("That room is closed or the code is wrong.", 4004);
      const watch = url.searchParams.get("watch") === "1", ip = req.headers.get("x-ip") || "";
      if (watch) { ws.serializeAttachment({ watch: true }); ws.send(JSON.stringify(this.state(null))); return new Response(null, { status: 101, webSocket: client }); }
      if (this.ctx.getWebSockets().length > MAX_ONLINE) return fail("This room is full.");
      const name = tidy(url.searchParams.get("name"), 24), key = tidy(url.searchParams.get("key"), 40), keyH = key ? await hash(key) : "";
      let id = Object.keys(this.s.members).find(k => this.s.members[k].key === keyH && keyH);
      const isHost = keyH && keyH === this.s.hostKey;
      if (!id) {
        if (name.length < 2) return fail("Pick a name (2 to 24 characters).");
        if (screen(name)) return fail("Pick a different name.");
        if (this.s.ban.ips.includes(ip) || this.s.ban.names.includes(low(name))) return fail("You've been blacklisted from this room.", 4003);
        const on = this.online();
        for (const [k, m] of Object.entries(this.s.members)) // free up names of people who left a while ago
          if (low(m.name) === low(name) && !on.has(k) && !m.banned && !m.host && !this.s.queue.some(e => e.id === k) && now() - (m.seen || 0) > 20 * 60e3) delete this.s.members[k];
        const clash = Object.entries(this.s.members).find(([, m]) => low(m.name) === low(name));
        if (clash || low(name) === low(BOT)) return fail("Someone in here already has that name.", 4009);
        id = rid(8); const newKey = isHost ? key : rid(24);
        this.s.members[id] = { name, key: isHost ? this.s.hostKey : await hash(newKey), host: !!isHost, mod: !!isHost, flair: "", joins: 0, calls: 0, ip, seen: now() };
        ws.serializeAttachment({ id }); ws.send(JSON.stringify({ type: "welcome", id, key: newKey, name }));
        this.post(null, `👋 **${name}** ${isHost ? "opened the doors" : "joined the room"}.`);
      } else {
        const m = this.s.members[id];
        if (this.s.ban.ids.includes(id)) return fail("You've been blacklisted from this room.", 4003);
        m.seen = now(); if (ip) m.ip = ip;
        ws.serializeAttachment({ id }); ws.send(JSON.stringify({ type: "welcome", id, key, name: m.name }));
      }
      ws.send(JSON.stringify({ type: "log", log: this.s.log }));
      ws.send(JSON.stringify({ type: "dms", list: this.dmsFor(id) }));
      await this.save(); this.broadcastState();
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }

  /* ---------- sockets ---------- */
  online() { const o = new Set(); for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.id) o.add(a.id); } return o; }
  sockets(id) { return this.ctx.getWebSockets().filter(ws => (ws.deserializeAttachment() || {}).id === id); }
  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch (e) {} }
  broadcast(o) { const t = JSON.stringify(o); for (const ws of this.ctx.getWebSockets()) try { ws.send(t); } catch (e) {} }
  state(id) {
    const s = this.s, on = this.online(), M = s.members;
    const q = s.queue.map(e => e.all ? { k: e.k, all: true, by: e.by } : { k: e.k, id: e.id, name: M[e.id]?.name || "?", flair: M[e.id]?.flair || "" });
    const members = Object.entries(M).filter(([k]) => on.has(k) || s.queue.some(e => e.id === k)).map(([k, m]) => ({ id: k, name: m.name, flair: m.flair, mod: m.mod, host: m.host, on: on.has(k) }))
      .sort((a, b) => (b.host - a.host) || (b.mod - a.mod) || (b.on - a.on) || a.name.localeCompare(b.name));
    return { type: "state", code: s.code, title: s.title, locked: s.locked, cur: s.cur, queue: q, members, calls: s.calls,
      you: id && M[id] ? { id, name: M[id].name, mod: M[id].mod, host: M[id].host, flair: M[id].flair, blocks: M[id].blocks || [] } : null };
  }
  broadcastState() {
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment() || {}; this.send(ws, this.state(a.id || null)); }
  }
  post(from, text, extra = {}) {
    const m = from ? this.s.members[from] : null;
    const msg = { n: ++this.s.seq, at: now(), uid: from || null, bot: !from, name: m ? m.name : BOT, flair: m?.flair || "", mod: !!m?.mod, host: !!m?.host, text, ...extra };
    this.s.log.push(msg); if (this.s.log.length > LOG_MAX) this.s.log.splice(0, this.s.log.length - LOG_MAX);
    this.broadcast({ type: "msg", msg }); return msg;
  }
  whisper(ws, text) { this.send(ws, { type: "msg", msg: { n: 0, at: now(), bot: true, name: BOT, text, only: true } }); }

  async webSocketMessage(ws, raw) {
    if (!this.s) return ws.close(4004, "closed");
    const a = ws.deserializeAttachment() || {}; if (!a.id) return;
    const me = this.s.members[a.id]; if (!me) return ws.close(4001, "removed");
    let d; try { d = JSON.parse(raw); } catch (e) { return; }
    // flood control: 8 messages per 10 seconds
    const t = now(); me.burst = (me.burst || []).filter(x => t - x < 10000); if (me.burst.length >= 8) return this.whisper(ws, "Slow down a little. 🐢"); me.burst.push(t);
    me.seen = t;
    if (d.type === "say") {
      const text = tidy(d.text, 800); if (!text) return;
      if (/^!(dm|msg|w)\s/i.test(text)) { await this.command(ws, a.id, text); return await this.save(); } // private: never echoed or filtered for numbers
      if (text.length > 500) return this.whisper(ws, "That's a long one. Keep chat messages under 500 characters.");
      const flag = screen(text);
      if (flag) return this.whisper(ws, flag === "phone number" ? "Not posted: that looks like a phone number. Keep numbers out of the room chat. Send it in a DM instead (✉️ next to their name)." : flag === "language" ? "Not posted. Rule 3: no slurs." : `Not posted: no ${flag}s in the room chat. Send it in a DM instead.`);
      if (text.startsWith("!")) { if (!d.quiet) this.post(a.id, text, { cmd: true }); await this.command(ws, a.id, text); }
      else {
        this.post(a.id, text);
        if (/🔔|:pla:/i.test(text)) await this.command(ws, a.id, "!join", true);
        else if (/:thecallectivetitle:/i.test(text)) await this.command(ws, a.id, "!allcall", true);
      }
      await this.save();
    } else if (d.type === "dm") { await this.dm(ws, a.id, String(d.to || ""), d.text); await this.save(); }
    else if (d.type === "block" || d.type === "unblock") { this.block(ws, a.id, String(d.to || ""), d.type === "block"); await this.save(); }
    else if (d.type === "cmd") { await this.command(ws, a.id, tidy(d.text, 200)); await this.save(); }
  }
  /* ---------- DMs: just the two people. Numbers and links are allowed here (that's the point); slurs still aren't. ---------- */
  pair(a, b) { return a < b ? a + ":" + b : b + ":" + a; }
  dmsFor(id) { const out = []; for (const [k, list] of Object.entries(this.s.dms || {})) if (k.split(":").includes(id)) out.push(...list); return out.sort((x, y) => x.n - y.n); }
  async dm(ws, from, to, raw) {
    const s = this.s, A = s.members[from], B = s.members[to];
    if (!B || B.banned) return this.whisper(ws, "Couldn't find that person.");
    if (to === from) return this.whisper(ws, "You can't DM yourself.");
    const text = tidy(raw, 800); if (!text) return;
    if (SLURS.test(text)) return this.whisper(ws, "Not sent. Rule 3: no slurs, not even in DMs.");
    if ((B.blocks || []).includes(from)) return this.send(ws, { type: "dmfail", to, error: `${B.name} isn't taking DMs from you.` });
    if ((A.blocks || []).includes(to)) return this.send(ws, { type: "dmfail", to, error: `You blocked ${B.name}. Unblock them to send a DM.` });
    s.dms = s.dms || {}; const k = this.pair(from, to), list = s.dms[k] = s.dms[k] || [];
    const dm = { n: ++s.seq, at: now(), from, fromName: A.name, to, toName: B.name, text };
    list.push(dm); if (list.length > DM_KEEP) list.splice(0, list.length - DM_KEEP);
    for (const w of [...this.sockets(from), ...this.sockets(to)]) this.send(w, { type: "dm", dm });
  }
  block(ws, id, who, on) {
    const me = this.s.members[id], t = this.s.members[who]; if (!t || who === id) return;
    me.blocks = (me.blocks || []).filter(x => x !== who); if (on) me.blocks.push(who);
    this.whisper(ws, on ? `🚫 Blocked ${t.name}. They can't DM you, and you won't see their chat messages.` : `Unblocked ${t.name}.`);
    for (const w of this.sockets(id)) this.send(w, this.state(id));
  }
  async webSocketClose(ws) { if (this.s) this.broadcastState(); }
  async webSocketError(ws) { if (this.s) this.broadcastState(); }
  async alarm() {
    if (!this.s) return;
    if (now() - this.s.lastAt >= IDLE_MS - 1000) { for (const ws of this.ctx.getWebSockets()) ws.close(4004, "Room closed after 12 quiet hours"); await this.ctx.storage.deleteAll(); this.s = null; }
    else await this.ctx.storage.setAlarm(this.s.lastAt + IDLE_MS);
  }

  /* ---------- the bot ---------- */
  find(arg) {
    const s = this.s, x = low(arg); if (!x) return null;
    const pos = x.match(/^#?(\d+)$/); if (pos) { const e = s.queue[+pos[1] - 1]; return e ? (e.all ? { entry: e } : { id: e.id, entry: e }) : null; }
    const all = Object.entries(s.members);
    const hit = all.find(([, m]) => low(m.name) === x) || (all.filter(([, m]) => low(m.name).startsWith(x)).length === 1 ? all.find(([, m]) => low(m.name).startsWith(x)) : null);
    return hit ? { id: hit[0], entry: s.queue.find(e => e.id === hit[0]) } : null;
  }
  label(e) { return e.all ? `📣 ALL CALL — by ${e.by}` : `${this.s.members[e.id]?.flair ? this.s.members[e.id].flair + " " : ""}${this.s.members[e.id]?.name || "?"}`; }
  listText() {
    const q = this.s.queue; if (!q.length) return `The line is empty.${this.s.locked ? " (Locked.)" : ""}`;
    return `**The line${this.s.locked ? " (locked)" : ""}:**\n` + q.map((e, i) => `${i + 1}. ${this.label(e)}`).join("\n");
  }
  async command(ws, id, text, auto = false) {
    const s = this.s, me = s.members[id], [c0, ...args] = text.trim().split(/\s+/), c = c0.toLowerCase().replace(/^!/, "");
    const say = t => this.post(null, t), tell = t => this.whisper(ws, t), mod = me.mod, host = me.host;
    const needMod = () => { if (!mod) { tell("That one's for mods."); return true; } return false; };
    const done = () => this.broadcastState();
    switch (c) {
      case "help": tell(HELP_USER + (mod ? "\n" + HELP_MOD : "")); return;
      case "join": {
        if (s.queue.some(e => e.id === id)) { if (!auto) tell(`You're already in line at #${s.queue.findIndex(e => e.id === id) + 1}.`); return; }
        if (s.cur && s.cur.id === id) return tell("You're on the phone right now. 📞");
        if (s.locked && !mod) return tell("🔒 The line is locked right now.");
        s.queue.push({ k: rid(6), id }); me.joins++;
        say(`🔔 **${me.name}** is in line at #${s.queue.length}.`); return done();
      }
      case "leave": {
        const i = s.queue.findIndex(e => e.id === id); if (i < 0) return tell("You're not in line.");
        s.queue.splice(i, 1); say(`👋 **${me.name}** left the line.`); return done();
      }
      case "queue": case "q": case "line": return tell(this.listText());
      case "position": case "pos": { const i = s.queue.findIndex(e => e.id === id); return tell(i < 0 ? "You're not in line. Drop 🔔 to get in." : `You're #${i + 1} of ${s.queue.length}.`); }
      case "mystats": return tell(`**${me.name}:** joined the line ${me.joins}×, made ${me.calls} call${me.calls === 1 ? "" : "s"} tonight.`);
      case "flair": {
        const f = args.join(" ");
        if (!f || /^off$/i.test(f)) { me.flair = ""; tell("Flair off."); return done(); }
        if ([...f].length > 3 || /[\w<>]/.test(f)) return tell("Flair has to be an emoji, like `!flair 🐸`.");
        me.flair = f; tell(`Flair set: ${f}`); return done();
      }
      case "dm": case "msg": case "w": {
        // names can have spaces: use the longest run of words that matches someone
        for (let n = args.length - 1; n >= 1; n--) {
          const f = this.find(args.slice(0, n).join(" "));
          if (f && f.id && low(s.members[f.id].name).startsWith(low(args.slice(0, n).join(" ")))) { await this.dm(ws, id, f.id, args.slice(n).join(" ")); return; }
        }
        return tell("Use `!dm <name> <message>`, or tap ✉️ next to someone in the room list.");
      }
      case "block": case "unblock": { const f = this.find(args.join(" ")); if (!f || !f.id) return tell("Couldn't find that person."); return this.block(ws, id, f.id, c === "block"); }
      case "ping": return tell("Turn the \"your turn\" sound on or off with the 🔔 switch above the chat.");
      case "allcall": {
        const pos = args[0] && mod ? parseInt(args[0], 10) : NaN;
        if (s.locked && !mod) return tell("🔒 The line is locked right now.");
        if (!mod && now() - s.allcallAt < ALLCALL_COOLDOWN) return tell(`ALL CALL is cooling down. Try again in ${Math.ceil((ALLCALL_COOLDOWN - (now() - s.allcallAt)) / 1000)}s.`);
        const e = { k: rid(6), all: true, by: me.name }; s.allcallAt = now();
        if (pos >= 1) s.queue.splice(Math.min(pos - 1, s.queue.length), 0, e); else s.queue.push(e);
        say(`📣 **ALL CALL** added by **${me.name}** at #${s.queue.indexOf(e) + 1}. Everybody on the phone!`); return done();
      }
      // ---- mod commands ----
      case "next": {
        if (needMod()) return;
        const prev = s.cur ? s.cur.name : null, e = s.queue.shift();
        if (s.cur && s.cur.id && s.members[s.cur.id]) s.members[s.cur.id].calls++;
        if (s.cur) s.calls++;
        if (!e) { s.cur = null; say(prev ? `✅ Done with **${prev}**. The line is empty. Drop 🔔 to get in.` : "The line is empty. Drop 🔔 to get in."); return done(); }
        s.cur = e.all ? { all: true, name: `ALL CALL (by ${e.by})` } : { id: e.id, name: s.members[e.id]?.name || "?" };
        const up = s.queue[0] ? ` On deck: **${this.label(s.queue[0])}**.` : "";
        say(`${prev ? `✅ Done with **${prev}**… ` : ""}📞 Now calling **${e.all ? "📣 ALL CALL" : s.cur.name}**!${e.all ? " Everybody unmute when the host says so." : ""}${up}`);
        if (!e.all) for (const w of this.sockets(e.id)) this.send(w, { type: "ping", text: "You're up! 📞" });
        return done();
      }
      case "done": case "end": {
        if (needMod()) return; if (!s.cur) return tell("Nobody's on the phone.");
        if (s.cur.id && s.members[s.cur.id]) s.members[s.cur.id].calls++; s.calls++;
        say(`✅ Done with **${s.cur.name}**.`); s.cur = null; return done();
      }
      case "remove": case "rm": {
        if (needMod()) return; const f = this.find(args.join(" ")); if (!f || !f.entry) return tell("Couldn't find them in line.");
        s.queue.splice(s.queue.indexOf(f.entry), 1); say(`🗑️ Removed **${this.label(f.entry)}** from the line.`); return done();
      }
      case "move": {
        if (needMod()) return; const pos = parseInt(args.at(-1), 10), f = this.find(args.slice(0, -1).join(" "));
        if (!f || !f.entry || !(pos >= 1)) return tell("Use `!move <name> <position>`.");
        s.queue.splice(s.queue.indexOf(f.entry), 1); s.queue.splice(Math.min(pos - 1, s.queue.length), 0, f.entry);
        say(`↕️ Moved **${this.label(f.entry)}** to #${s.queue.indexOf(f.entry) + 1}.`); return done();
      }
      case "up": case "down": {
        if (needMod()) return; const f = this.find(args.join(" ")); if (!f || !f.entry) return;
        const i = s.queue.indexOf(f.entry), j = c === "up" ? i - 1 : i + 1; if (j < 0 || j >= s.queue.length) return;
        [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]]; return done();
      }
      case "swap": {
        if (needMod()) return; const a = this.find(args[0]), b = this.find(args[1]);
        if (!a?.entry || !b?.entry) return tell("Use `!swap <name> <name>` (or positions like `#2 #5`).");
        const i = s.queue.indexOf(a.entry), j = s.queue.indexOf(b.entry); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
        say(`🔀 Swapped **${this.label(a.entry)}** and **${this.label(b.entry)}**.`); return done();
      }
      case "shuffle": if (needMod()) return; shuffle(s.queue); say("🎲 Shuffled the line.\n" + this.listText()); return done();
      case "reverse": if (needMod()) return; s.queue.reverse(); say("🔃 Flipped the line.\n" + this.listText()); return done();
      case "lock": if (needMod()) return; s.locked = true; say("🔒 **The line is locked.** No new joins for now."); return done();
      case "unlock": if (needMod()) return; s.locked = false; say("🔓 **The line is open!** Drop 🔔 to get in."); return done();
      case "clear": if (needMod()) return; s.queue = []; say("🧹 Cleared the line."); return done();
      case "kick": case "blacklist": case "ban": {
        if (needMod()) return; const f = this.find(args.join(" ")); if (!f || !f.id) return tell("Couldn't find that person.");
        const m = s.members[f.id]; if (m.host || (m.mod && !host)) return tell("You can't do that to the host or another mod.");
        s.queue = s.queue.filter(e => e.id !== f.id); if (s.cur && s.cur.id === f.id) s.cur = null;
        if (c !== "kick") { s.ban.names.push(low(m.name)); if (m.ip) s.ban.ips.push(m.ip); s.ban.ids.push(f.id); }
        for (const w of this.sockets(f.id)) { this.send(w, { type: "error", error: c === "kick" ? "You were removed from the room." : "You've been blacklisted from this room." }); w.close(4003, "removed"); }
        if (c === "kick") delete s.members[f.id]; else m.banned = true;
        say(c === "kick" ? `👢 **${m.name}** was removed from the room.` : `⛔ **${m.name}** is blacklisted.`); return done();
      }
      case "unblacklist": case "unban": {
        if (needMod()) return; const x = low(args.join(" ")); const e = Object.entries(s.members).find(([, m]) => m.banned && low(m.name) === x);
        s.ban.names = s.ban.names.filter(n => n !== x);
        if (e) { s.ban.ids = s.ban.ids.filter(i => i !== e[0]); s.ban.ips = s.ban.ips.filter(i => i !== e[1].ip); delete s.members[e[0]]; }
        return tell(e || s.ban.names.length ? `✅ ${args.join(" ")} can come back in.` : "They weren't on the blacklist.");
      }
      case "blacklistlist": case "banlist": if (needMod()) return; return tell(s.ban.names.length ? "**Blacklist:** " + s.ban.names.join(", ") : "The blacklist is empty.");
      case "mod": case "unmod": {
        if (!host) return tell("Only the host can hand out mod."); const f = this.find(args.join(" ")); if (!f || !f.id) return tell("Couldn't find that person.");
        s.members[f.id].mod = c === "mod"; say(c === "mod" ? `🛡️ **${s.members[f.id].name}** is a mod now.` : `**${s.members[f.id].name}** isn't a mod anymore.`); return done();
      }
      case "title": {
        if (!host) return tell("Only the host can rename the room."); const t = tidy(args.join(" "), 60);
        if (!t || screen(t)) return tell("Try a different title."); s.title = t; say(`📝 The room is now **${t}**.`); return done();
      }
      case "close": {
        if (!host) return tell("Only the host can close the room.");
        say("📴 The host closed the room. Thanks for calling!");
        for (const w of this.ctx.getWebSockets()) { this.send(w, { type: "closed" }); w.close(4004, "closed"); }
        await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm(); this.s = null; return;
      }
      default: if (!auto) tell(`I don't know \`!${c}\`. Try \`!help\`.`);
    }
  }
}
