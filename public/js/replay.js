/* Replay booth: an episode plus its Prankcast chat, synced. The heat strip is chat messages per minute. */
const Replay = (() => {
  let ep = null, chat = [], bins = [], dur = 0, hasAudio = false, vt = 0, vplaying = false, vlast = 0, shown = 0, speedI = 0, raf = null, loadToken = 0;
  const aud = () => $("rp-audio");
  const SPEEDS_AUDIO = [1, 1.5, 2], SPEEDS_VIRT = [1, 10, 60];
  const now = () => hasAudio ? aud().currentTime : vt;
  const playing = () => hasAudio ? !aud().paused : vplaying;

  function fillSelect(selectId) {
    const byYear = new Map();
    const recent = recentIds();
    for (const e of C.episodes.filter(x => recent.has(x.id))) { const y = e.d ? e.d.slice(0, 4) : "Undated"; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(e); }
    $("ep-select").innerHTML = [...byYear].map(([y, list]) => `<optgroup label="${y}">${list.map(e =>
      `<option value="${e.id}">${esc(fmtDate(e.d))} · ${esc(e.h || niceTitle(e).replace(/^The Callective\s*[-–:]?\s*/i, "") || "The Callective")}${e.chat ? ` · ${e.chat} chats` : ""}</option>`).join("")}</optgroup>`).join("");
    if (selectId) $("ep-select").value = selectId;
  }

  async function load(id, autoplay) {
    if (!isRecent(id)) { window.open(PC_POST + id, "_blank", "noopener"); return; }
    const token = ++loadToken;
    stop(); ep = C.episodes.find(e => e.id === +id); if (!ep) return;
    $("ep-select").value = ep.id;
    dur = ep.sec || 0; vt = 0; shown = 0; chat = []; hasAudio = false;
    $("ep-title").textContent = niceTitle(ep);
    $("ep-meta").innerHTML = [`<span>${esc(fmtDate(ep.d))}</span>`, ep.h ? `<span>Host <b>${esc(ep.h)}</b></span>` : "", `<span>${fmtLen(dur)}</span>`,
      `<a href="${PC_POST}${ep.id}" target="_blank" rel="noopener">Open on Prankcast ↗</a>`].join("");
    $("rp-dur").textContent = hms(dur, true); $("msgs").innerHTML = `<li class="feed-empty">Loading the chat…</li>`;
    let src = null, cid = null;
    if (C.api) {
      try { const info = await getJSON(`${C.api}/episode/${ep.id}`, 8000); src = info.mp3; cid = info.cid; if (info.sec) dur = info.sec; } catch (e) {}
      if (cid) { try { const r = await getJSON(`${C.api}/chat/${cid}`, 10000); if (Array.isArray(r.messages)) chat = r.messages; } catch (e) {} }
    }
    if (!chat.length && ep.chat) { try { chat = await getJSON(`data/chat/${ep.id}.json`); } catch (e) {} }
    if (token !== loadToken) return;
    chat.sort((a, b) => a[0] - b[0]);
    if (src) { hasAudio = true; aud().src = src; aud().preload = "metadata"; }
    else { aud().removeAttribute("src"); aud().load(); }
    speedI = 0; $("rp-speed").textContent = (hasAudio ? SPEEDS_AUDIO : SPEEDS_VIRT)[0] + "×";
    $("rp-note").textContent = hasAudio ? "Audio streams straight from Prankcast. The chat is the real Prankcast chat replay."
      : "The episode audio plays on the live site. Here the chat replays on its own, so crank it to 60× and watch a whole night go by.";
    $("feed-count").textContent = chat.length ? `${chat.length} messages` : "No chat saved for this one";
    ideasOpen = null; paintCalls(); buildBins(); drawHeat(); renderFeed(true); tick();
    if (autoplay) play();
  }

  function buildBins() {
    const mins = Math.max(1, Math.ceil(dur / 60)); bins = new Array(mins).fill(0);
    for (const m of chat) { const i = Math.min(mins - 1, Math.floor(m[0] / 60)); bins[i]++; }
    const peak = bins.indexOf(Math.max(...bins));
    $("rp-peak").disabled = !chat.length; $("rp-peak").dataset.t = peak * 60;
    $("heat-mid").textContent = chat.length ? `Busiest minute: ${hms(peak * 60, true)} (${bins[peak]} messages)` : "No chat to graph";
    $("heat-end").textContent = hms(dur, true);
  }
  function drawHeat() {
    const cv = $("heatc"), box = $("heat"), dpr = devicePixelRatio || 1, w = box.clientWidth, h = box.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const max = Math.max(1, ...bins), bw = w / bins.length, peak = bins.indexOf(max);
    g.fillStyle = "#18f0ff18"; for (let y = h - 1; y > 0; y -= h / 4) g.fillRect(0, Math.round(y), w, 1);
    g.fillStyle = "#ffffff30"; for (const c of callsFor(ep?.id, dur)) if (!c.skip) g.fillRect(Math.round(c.t / dur * w), 0, 1, h);
    bins.forEach((v, i) => { const bh = v / max * (h - 8); g.fillStyle = i === peak ? "#ff2bd6" : (v / max > .6 ? "#e9ff3b" : "#18f0ff"); g.shadowColor = g.fillStyle; g.shadowBlur = 6; g.fillRect(i * bw + .5, h - bh, Math.max(1, bw - 1), bh); });
  }

  function msgHTML(m) {
    const [t, u, txt] = m, crew = CREW.has(String(u).toLowerCase());
    const body = /^\[gif/.test(txt) ? `<span class="gif">${esc(txt)}</span>` : esc(txt);
    return `<li class="msg${crew ? " crew" : ""}"><time>${hms(t, true)}</time><span><b>${esc(u)}</b>${body}</span></li>`;
  }
  function renderFeed(full) {
    const t = now(), list = $("msgs");
    if (!chat.length) { list.innerHTML = `<li class="feed-empty">Nobody typed in the Prankcast chat for this one, or it wasn't saved. Episodes from 2025 on have the most chat.</li>`; return; }
    let idx = 0; while (idx < chat.length && chat[idx][0] <= t) idx++;
    if (full || idx < shown) {
      const from = Math.max(0, idx - 60);
      list.innerHTML = idx ? chat.slice(from, idx).map(msgHTML).join("") : `<li class="feed-empty">The chat shows up here as the show plays. First message at ${hms(chat[0][0], true)}.</li>`;
    } else if (idx > shown) {
      if (shown === 0) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", chat.slice(Math.max(shown, idx - 60), idx).map(msgHTML).join(""));
      while (list.children.length > 80) list.firstElementChild.remove();
    }
    shown = idx; list.scrollTop = list.scrollHeight;
  }

  /* The call list: who's on, jump to a call, clip a whole call. */
  let curCall = null, ideasOpen = null;
  function ideasPanel(c) {
    const ideas = c.ideas || [];
    return `<div class="ideas" data-t="${c.t}">${ideas.length ? `<ol>${ideas.map(x => `<li><button type="button" class="idea-v" data-vote="${esc(x.id)}" title="+1 this title">▲ ${x.v}</button><span>${esc(x.title)}</span><button type="button" class="idea-r" data-rep="${esc(x.id)}" title="Report this one">⚑</button>${crew() ? `<button type="button" class="idea-r" data-crewrm="${esc(x.id)}" title="Crew: remove this idea">✕</button>` : ""}</li>`).join("")}</ol>` : `<p>No ideas yet. What was this call?</p>`}
      <form class="idea-f"><label class="sr" for="idea-in">Suggest a title</label><input id="idea-in" maxlength="80" placeholder="Suggest a title, e.g. The Pumpkin Man" autocomplete="off"><button class="btn sm" type="submit">Suggest</button></form>
      <small>One vote per person per call. No phone numbers, links or slurs. The crew can still change any title.</small></div>`;
  }
  async function ideaAct(t, action, extra) {
    try { await suggestAct(action, ep.id, t, extra); toast(action === "add" ? "Thanks! Your title is up." : action === "vote" ? "Voted." : "Reported. Thanks."); }
    catch (e) { toast(e.message); }
  }
  const crew = () => { try { return sessionStorage.getItem("cx-mod") || ""; } catch (e) { return ""; } };
  function paintCalls() {
    const box = $("ep-calls"), L = callsFor(ep.id, dur), info = C.calls[ep.id], ed = !!crew() && !!C.api; curCall = null;
    box.hidden = !L.length; if (!L.length) { box.innerHTML = ""; return; }
    const pen = (attr, what) => ed ? `<button type="button" class="call-ed" ${attr} title="Edit ${what}" aria-label="Edit ${what}">✎</button>` : "";
    box.innerHTML = `${info.desc || ed ? `<p class="calls-desc">${esc(info.desc || "No show blurb yet.")} ${pen('data-desc="1"', "the show blurb")}</p>` : ""}<div class="calls-head"><b>${L.filter(c => !c.skip).length} calls</b><span>${ed ? "Crew mode: ✎ fixes a title or name" : "Tap to jump · ✂ clips the whole turn"}</span></div><ol>${L.map((c, i) => c.skip
      ? `<li class="call skip"><time>${hms(c.at, true)}</time><span><b>${esc(c.by)}</b><em>skipped</em></span></li>`
      : `<li class="call${ideasOpen === c.t ? " open" : ""}" data-i="${i}"><button type="button" class="call-go" data-t="${c.at}"><time>${hms(c.at, true)}</time><span><b>${esc(c.by)}</b>${c.title ? `<em>${esc(c.title)}${c.community ? ` <i class="cm" title="Title suggested by listeners">community</i>` : ""}</em>` : ""}</span><small>${fmtLen(c.end - c.t)}</small></button>${pen(`data-i="${i}"`, `${esc(c.by)}'s call`)}${C.api && (!c.title || c.community) ? `<button type="button" class="call-idea" data-idea="${c.t}" title="${c.title ? "Vote on the title or suggest a better one" : "Know what this call was? Name it"}" aria-label="Name this call">${c.title ? "💡" : "💡+"}</button>` : ""}<button type="button" class="call-clip" data-i="${i}" title="Clip this whole call" aria-label="Clip ${esc(c.by)}'s call">✂</button>${ideasOpen === c.t ? ideasPanel(c) : ""}</li>`).join("")}</ol>
      ${C.api && L.some(c => !c.skip && !c.title) ? `<p class="calls-help">💡+ = no title yet. Heard the call? Name it. Titles show up right away, and the one with the most votes wins.</p>` : ""}`;
  }
  async function editCall(i, desc) {
    const tok = crew(); if (!tok) return; const body = { ep: ep.id };
    if (desc) { const v = prompt("Show blurb (one or two sentences):", C.calls[ep.id]?.desc || ""); if (v == null) return; body.desc = v; }
    else { const c = callsFor(ep.id, dur)[i]; const title = prompt(`Title for ${c.by}'s call at ${hms(c.t, true)} (leave empty for none):`, c.title || ""); if (title == null) return;
      const by = prompt("Who made the call?", c.by); if (by == null) return; Object.assign(body, { t: c.t, title, by }); }
    try {
      const r = await fetch(`${C.api}/mod/calls`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
      if (r.status === 401) { toast("Wrong crew password. Log in again on the Clip board page."); return; }
      if (!r.ok) throw 0; const j = await r.json(), fix = {}; fix[ep.id] = j.fix;
      const cur = await getJSON(`${C.api}/calls?x=${Date.now()}`, 6000).catch(() => ({})); applyCallFixes({ ...cur, ...fix }); toast("Saved. Everyone sees it within a minute.");
    } catch (e) { toast("That didn't save. Try again."); }
  }
  function paintCurCall(t) {
    const c = ep ? callAt(ep.id, t, dur) : null; if (curCall !== undefined && (c === curCall || (c && curCall && c.t === curCall.t))) return; curCall = c;
    $("ep-calls").querySelectorAll(".call.on").forEach(x => x.classList.remove("on"));
    if (c) { const li = $("ep-calls").querySelector(`.call[data-i="${c.n - 1}"]`); li?.classList.add("on"); const ol = li?.parentElement; if (ol) ol.scrollTop = li.offsetTop - ol.offsetTop - ol.clientHeight / 3; }
    if (Player.current?.kind === "ep" && ep) Player.update({ title: c ? callLabel(c) : `${fmtDate(ep.d)} · ${ep.h || niceTitle(ep)}` });
  }
  function clipCall(i) {
    const c = callsFor(ep.id, dur)[i]; if (!c) return;
    if (!hasAudio || !C.api) { toast("Clipping works on the live site, where the episode audio plays."); return; }
    if (c.end - c.t > 1200) toast("Clips top out at 20 minutes, so this one has the first 20. Drag the markers if you want a different part.");
    Clipper.open(Clipper.episodeSource(aud(), ep), 30, { from: c.t, to: c.end, name: callLabel(c) });
  }

  function tick() {
    const t = now();
    $("rp-now").textContent = hms(t, true);
    $("heat-ph").style.left = (dur ? clamp(t / dur, 0, 1) * 100 : 0) + "%";
    $("heat").setAttribute("aria-valuenow", Math.round(t)); $("heat").setAttribute("aria-valuemax", Math.round(dur));
    $("rp-play").classList.toggle("is-playing", playing()); $("rp-play").setAttribute("aria-label", playing() ? "Pause episode" : "Play episode");
    renderFeed(false); paintCurCall(t);
  }
  function loop(ts) {
    if (!hasAudio && vplaying) { const dt = vlast ? (ts - vlast) / 1000 : 0; vt = Math.min(dur, vt + dt * SPEEDS_VIRT[speedI]); if (vt >= dur) vplaying = false; }
    vlast = ts; tick(); if (playing()) raf = requestAnimationFrame(loop); else raf = null;
  }
  function play() {
    if (!ep) return;
    if (hasAudio) { Media.claim(aud()); aud().play().catch(() => { toast("Couldn't start the audio. Try again or open it on Prankcast."); });
      Player.set({ kind: "ep", el: aud(), title: `${fmtDate(ep.d)} · ${ep.h || niceTitle(ep)}`, page: "replay", seek: true, clip: () => clip() }); curCall = undefined; paintCurCall(now()); }
    else { if (vt >= dur) vt = 0; vplaying = true; vlast = 0; }
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function pause() { if (hasAudio) aud().pause(); vplaying = false; tick(); }
  function stop() { pause(); if (raf) cancelAnimationFrame(raf); raf = null; }
  function seek(t) { t = clamp(t, 0, dur); if (hasAudio) aud().currentTime = t; else vt = t; renderFeed(true); tick(); }

  function clip() {
    if (!ep) return;
    if (!hasAudio || !C.api) { toast("Clipping works on the live site, where the episode audio plays."); return; }
    if (now() < 1) { toast("Play a little first, then clip."); return; }
    Clipper.open(Clipper.episodeSource(aud(), ep), 30);
  }
  function init() {
    fillSelect();
    $("cl-quick").addEventListener("click", () => clip());
    $("ep-calls").addEventListener("submit", e => { const f = e.target.closest(".idea-f"); if (!f) return; e.preventDefault(); const v = f.querySelector("input").value.trim(); if (v) ideaAct(+f.closest(".ideas").dataset.t, "add", { title: v }); });
    $("ep-calls").addEventListener("click", e => {
      const idea = e.target.closest("[data-idea]"); if (idea) { ideasOpen = ideasOpen === +idea.dataset.idea ? null : +idea.dataset.idea; paintCalls(); curCall = undefined; tick(); if (ideasOpen != null) $("idea-in")?.focus(); return; }
      const vt = e.target.closest("[data-vote]"); if (vt) { ideaAct(+vt.closest(".ideas").dataset.t, "vote", { id: vt.dataset.vote }); return; }
      const rp = e.target.closest("[data-rep]"); if (rp) { if (confirm("Report this title as spam or nasty?")) ideaAct(+rp.closest(".ideas").dataset.t, "report", { id: rp.dataset.rep }); return; }
      const cr = e.target.closest("[data-crewrm]"); if (cr) { const t = +cr.closest(".ideas").dataset.t;
        fetch(`${C.api}/mod/suggest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${crew()}` }, body: JSON.stringify({ ep: ep.id, t, id: cr.dataset.crewrm }) })
          .then(r => r.ok ? r.json() : Promise.reject()).then(j => { const sh = CALL_SG[ep.id] || (CALL_SG[ep.id] = {}); sh[String(t)] = j.call.map(({ mine, ...x }) => x); rebuildCalls(); toast("Removed."); }).catch(() => toast("Wrong crew password, or it didn't go through."));
        return; }
      if (e.target.closest(".ideas")) return;
      const go = e.target.closest(".call-go"), cl = e.target.closest(".call-clip"), ed = e.target.closest(".call-ed");
      if (ed) editCall(+ed.dataset.i, !!ed.dataset.desc); else if (go) { seek(+go.dataset.t); play(); } else if (cl) clipCall(+cl.dataset.i);
    });
    $("ep-select").addEventListener("change", e => load(e.target.value));
    $("rp-play").addEventListener("click", () => playing() ? pause() : play());
    $("rp-back").addEventListener("click", () => seek(now() - 30));
    $("rp-fwd").addEventListener("click", () => seek(now() + 30));
    $("rp-peak").addEventListener("click", e => { seek(+e.currentTarget.dataset.t - 20); play(); });
    $("rp-speed").addEventListener("click", () => {
      const list = hasAudio ? SPEEDS_AUDIO : SPEEDS_VIRT; speedI = (speedI + 1) % list.length;
      $("rp-speed").textContent = list[speedI] + "×"; if (hasAudio) aud().playbackRate = list[speedI];
    });
    const heat = $("heat");
    const seekAt = ev => { const b = heat.getBoundingClientRect(); seek((ev.clientX - b.left) / b.width * dur); };
    heat.addEventListener("pointerdown", ev => { heat.setPointerCapture(ev.pointerId); seekAt(ev); const mv = e => seekAt(e); heat.addEventListener("pointermove", mv); heat.addEventListener("pointerup", () => heat.removeEventListener("pointermove", mv), { once: true }); });
    heat.addEventListener("keydown", e => { if (e.key === "ArrowRight") { seek(now() + 60); e.preventDefault(); } if (e.key === "ArrowLeft") { seek(now() - 60); e.preventDefault(); } });
    const a = aud();
    a.addEventListener("play", () => { if (!raf) raf = requestAnimationFrame(loop); });
    a.addEventListener("pause", tick); a.addEventListener("seeked", () => renderFeed(true));
    a.addEventListener("loadedmetadata", () => { if (isFinite(a.duration) && a.duration > 60) { dur = a.duration; $("rp-dur").textContent = hms(dur, true); buildBins(); drawHeat(); } });
    a.addEventListener("error", () => { if (hasAudio) { hasAudio = false; $("rp-note").textContent = "The audio didn't load. The chat still replays on its own, or open the show on Prankcast."; } });
    new ResizeObserver(() => drawHeat()).observe(heat);
    document.addEventListener("episodes-changed", () => fillSelect(ep?.id));
    document.addEventListener("calls-changed", () => { if (ep) { paintCalls(); curCall = undefined; tick(); drawHeat(); } });
    const recent = recentIds(), mine = C.episodes.filter(e => recent.has(e.id));
    const start = mine.find(e => e.chat >= 30) || mine[0];
    load(start.id);
  }
  return { init, load: (id, autoplay = true) => { if (!isRecent(id)) { window.open(PC_POST + id, "_blank", "noopener"); return; } load(id, autoplay); go("replay"); },
    loadAt: async (id, t, autoplay) => { if (!isRecent(id)) { window.open(PC_POST + id, "_blank", "noopener"); return; } await load(id, false); seek(t); go("replay"); if (autoplay) play(); },
    clipRange: async (id, from, to, name) => { if (!isRecent(id)) { window.open(PC_POST + id, "_blank", "noopener"); return; } await load(id, false); seek(from); go("replay");
      if (!hasAudio || !C.api) { toast("Clipping works on the live site, where the episode audio plays."); return; }
      Clipper.open(Clipper.episodeSource(aud(), ep), 30, { from, to, name }); } };
})();
