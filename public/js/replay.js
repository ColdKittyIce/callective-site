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
    paintCalls(); buildBins(); drawHeat(); renderFeed(true); tick();
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
  let curCall = null;
  function paintCalls() {
    const box = $("ep-calls"), L = callsFor(ep.id, dur), info = C.calls[ep.id]; curCall = null;
    box.hidden = !L.length; if (!L.length) { box.innerHTML = ""; return; }
    box.innerHTML = `${info.desc ? `<p class="calls-desc">${esc(info.desc)}</p>` : ""}<div class="calls-head"><b>${L.filter(c => !c.skip).length} calls</b><span>Tap one to jump to it</span></div><ol>${L.map((c, i) => c.skip
      ? `<li class="call skip"><time>${hms(c.t, true)}</time><span><b>${esc(c.by)}</b><em>skipped</em></span></li>`
      : `<li class="call" data-i="${i}"><button type="button" class="call-go" data-t="${c.t}"><time>${hms(c.t, true)}</time><span><b>${esc(c.by)}</b><em>${esc(c.title)}</em></span><small>${fmtLen(c.end - c.t)}</small></button><button type="button" class="call-clip" data-i="${i}" title="Clip this whole call" aria-label="Clip ${esc(c.by)}'s call">✂</button></li>`).join("")}</ol>`;
  }
  function paintCurCall(t) {
    const c = ep ? callAt(ep.id, t, dur) : null; if (curCall !== undefined && (c === curCall || (c && curCall && c.t === curCall.t))) return; curCall = c;
    $("ep-calls").querySelectorAll(".call.on").forEach(x => x.classList.remove("on"));
    if (c) { const li = $("ep-calls").querySelector(`.call[data-i="${c.n - 1}"]`); li?.classList.add("on"); const ol = li?.parentElement; if (ol) ol.scrollTop = li.offsetTop - ol.offsetTop - ol.clientHeight / 3; }
    if (Player.current?.kind === "ep" && ep) Player.update({ title: c ? `${c.by}: ${c.title}` : `${fmtDate(ep.d)} · ${ep.h || niceTitle(ep)}` });
  }
  function clipCall(i) {
    const c = callsFor(ep.id, dur)[i]; if (!c) return;
    if (!hasAudio || !C.api) { toast("Clipping works on the live site, where the episode audio plays."); return; }
    if (c.end - c.t > 600) toast("Clips top out at 10 minutes, so this one starts with the first 10. Drag the end marker if you want a different part.");
    Clipper.open(Clipper.episodeSource(aud(), ep), 30, { from: c.t, to: c.end, name: `${c.by}: ${c.title}` });
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
    $("ep-calls").addEventListener("click", e => {
      const go = e.target.closest(".call-go"), cl = e.target.closest(".call-clip");
      if (go) { seek(+go.dataset.t); play(); } else if (cl) clipCall(+cl.dataset.i);
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
    const recent = recentIds(), mine = C.episodes.filter(e => recent.has(e.id));
    const start = mine.find(e => e.chat >= 30) || mine[0];
    load(start.id);
  }
  return { init, load: (id, autoplay = true) => { if (!isRecent(id)) { window.open(PC_POST + id, "_blank", "noopener"); return; } load(id, autoplay); go("replay"); },
    loadAt: async (id, t) => { if (!isRecent(id)) { window.open(PC_POST + id, "_blank", "noopener"); return; } await load(id, false); seek(t); go("replay"); } };
})();
