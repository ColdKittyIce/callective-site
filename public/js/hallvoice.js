/* The Hall's voice channel: peer-to-peer WebRTC audio between everyone in voice (up to 12).
   The room's WebSocket only carries the setup messages ("perfect negotiation"); the audio goes browser to browser.
   Rule 1: you join muted. Rule 6: echo cancellation and noise suppression start OFF (use headphones).
   Data: muted people send nothing at all (the track is pulled, not just silenced), talkers use Opus at 24 kbps
   with DTX (near-zero during pauses), and phones / data saver drop to 16 kbps. One person talking ≈ 10 MB an hour to hear. */
const HallVoice = (() => {
  let send = () => false, getMe = () => null, ice = null;
  let vs = "", inVoice = false, muted = true, ptt = false, stream = null, track = null, actx = null, st = null, smute = false;
  const peers = new Map(); // id → {pc, audio, polite, makingOffer, ignoreOffer, level, node}
  const vol = new Map();   // id → 0..1 (per-person volume, kept for the session)
  const opts = { ec: false, ns: false, agc: true, mic: "", out: "", saver: null };
  try { Object.assign(opts, JSON.parse(localStorage.getItem("cx-hall-voice") || "{}")); } catch (e) {}
  const saveOpts = () => { try { localStorage.setItem("cx-hall-voice", JSON.stringify(opts)); } catch (e) {} };

  const cell = () => { const c = navigator.connection; return !!(c && (c.saveData || c.type === "cellular" || /2g|3g/.test(c.effectiveType || ""))); };
  const saver = () => opts.saver === null ? cell() : !!opts.saver;
  const kbps = () => saver() ? 16000 : 24000;
  // Ask the other side to send us Opus at our bitrate, with DTX (silence costs ~nothing) and FEC (fewer dropouts).
  function munge(sdp) {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i); if (!m) return sdp;
    const pt = m[1], extra = `maxaveragebitrate=${kbps()};usedtx=1;useinbandfec=1;stereo=0;sprop-stereo=0`;
    const re = new RegExp(`a=fmtp:${pt} ([^\r\n]*)`);
    if (re.test(sdp)) return sdp.replace(re, (_, p) => `a=fmtp:${pt} ${p.split(";").filter(x => !/^(maxaveragebitrate|usedtx|useinbandfec|stereo|sprop-stereo)=/.test(x)).concat(extra).join(";")}`);
    return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${extra}`);
  }
  async function capSender(P) { // and cap what we send, belt and braces
    for (const snd of P.pc.getSenders()) { try { const p = snd.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = kbps(); await snd.setParameters(p); } catch (e) {} }
  }
  async function iceServers() {
    if (ice) return ice;
    try { ice = (await (await fetch("/api/hall-ice")).json()).iceServers; } catch (e) {}
    return ice || (ice = [{ urls: "stun:stun.cloudflare.com:3478" }]);
  }
  function ctx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); return actx; }
  function meter(src) { const a = ctx().createAnalyser(); a.fftSize = 512; src.connect(a); return a; }
  function level(an) { const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b); let s = 0; for (const x of b) s += x * x; return Math.sqrt(s / b.length); }

  async function getMic() {
    const c = { echoCancellation: opts.ec, noiseSuppression: opts.ns, autoGainControl: opts.agc, channelCount: 1 };
    if (opts.mic) c.deviceId = { exact: opts.mic };
    try { return await navigator.mediaDevices.getUserMedia({ audio: c }); }
    catch (e) { if (opts.mic) { opts.mic = ""; saveOpts(); delete c.deviceId; return navigator.mediaDevices.getUserMedia({ audio: c }); } throw e; }
  }
  let localMeter = null;
  async function join() {
    if (inVoice) return;
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast("This browser can't do voice. Try Chrome, Edge, Firefox or Safari.");
    try { stream = await getMic(); } catch (e) { return toast("Couldn't get your mic. Check the browser's mic permission."); }
    track = stream.getAudioTracks()[0]; muted = true; applyMute();
    localMeter = meter(ctx().createMediaStreamSource(stream));
    await iceServers(); inVoice = true;
    vs = Math.random().toString(36).slice(2, 10); send({ type: "voice", on: true, muted: true, vs }); render(); fillDevices();
    toast("You're in voice, muted. Rule 1: unmute when it's your turn.");
  }
  function leave(quiet) {
    if (!inVoice && !stream) return;
    inVoice = false; for (const id of [...peers.keys()]) drop(id);
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = track = null; localMeter = null;
    if (!quiet) send({ type: "voice", on: false }); render();
  }
  function applyMute() {
    const on = !!track && inVoice && !smute && (!muted || ptt); if (track) track.enabled = on;
    for (const P of peers.values()) if (P.sender) P.sender.replaceTrack(on ? track : null).catch(() => {}); // muted = send nothing
  }
  function setMuted(m) {
    if (smute && !m) return toast("A mod muted you. Ask in chat.");
    muted = m; applyMute(); if (inVoice) send({ type: "voice", on: true, muted, vs }); render();
  }
  function talk(on) { if (!inVoice) return; ptt = on; applyMute(); $("hl-vptt").classList.toggle("on", on); }

  /* ---------- peers ---------- */
  function makePeer(id) {
    const me = getMe(); if (!me) return null;
    const pc = new RTCPeerConnection({ iceServers: ice || [] });
    const audio = new Audio(); audio.autoplay = true; audio.playsInline = true;
    if (opts.out && audio.setSinkId) audio.setSinkId(opts.out).catch(() => {});
    const P = { pc, audio, polite: me.id > id, makingOffer: false, ignoreOffer: false, node: null };
    peers.set(id, P);
    P.sender = pc.addTransceiver("audio", { direction: "sendrecv", streams: stream ? [stream] : [] }).sender;
    const talking = !!track && track.enabled; if (talking) P.sender.replaceTrack(track).catch(() => {});
    pc.onnegotiationneeded = async () => {
      try {
        P.makingOffer = true; const off = await pc.createOffer(); if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription({ type: "offer", sdp: munge(off.sdp) }); send({ type: "rtc", to: id, sig: { desc: pc.localDescription, vs } });
      } catch (e) {} finally { P.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ type: "rtc", to: id, sig: { cand: candidate, vs } }); };
    pc.ontrack = ({ streams, track: t }) => {
      const s = streams[0] || new MediaStream([t]); audio.srcObject = s; audio.play().catch(() => {});
      try { P.node = meter(ctx().createMediaStreamSource(s)); } catch (e) {}
      volFor(id);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") { try { pc.restartIce(); } catch (e) {} }
      if (pc.connectionState === "connected") capSender(P);
      render();
    };
    return P;
  }
  function drop(id) { const P = peers.get(id); if (!P) return; try { P.pc.close(); } catch (e) {} P.audio.srcObject = null; peers.delete(id); }
  async function onSignal(from, sig) {
    if (!inVoice || !sig) return;
    let P = peers.get(from);
    if (P && sig.vs && P.vs && sig.vs !== P.vs) { drop(from); P = null; } // they rejoined voice
    P = P || makePeer(from); if (!P) return; if (!P.vs) P.vs = sig.vs || ""; const pc = P.pc;
    try {
      if (sig.desc) {
        const collision = sig.desc.type === "offer" && (P.makingOffer || pc.signalingState !== "stable");
        P.ignoreOffer = !P.polite && collision; if (P.ignoreOffer) return;
        if (sig.desc.type === "offer" && pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
        await pc.setRemoteDescription(sig.desc);
        if (sig.desc.type === "offer") { const ans = await pc.createAnswer(); await pc.setLocalDescription({ type: "answer", sdp: munge(ans.sdp) }); send({ type: "rtc", to: from, sig: { desc: pc.localDescription, vs } }); }
        capSender(P);
      } else if (sig.cand) {
        try { await pc.addIceCandidate(sig.cand); } catch (e) { if (!P.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn("voice", e); }
  }
  function volFor(id) {
    const P = peers.get(id); if (!P) return;
    const m = st && st.members.find(x => x.id === id), blocked = st && st.you && (st.you.blocks || []).includes(id);
    P.audio.volume = vol.has(id) ? vol.get(id) : 1;
    P.audio.muted = !!(m && m.v && m.v.smute) || !!blocked; // receivers enforce mod mutes and blocks
  }

  /* ---------- room state ---------- */
  function onState(s) {
    st = s; const me = getMe(); const y = s.you || {};
    smute = !!y.smute; applyMute();
    if (inVoice && me) {
      const there = new Set(s.members.filter(m => m.v && m.id !== me.id).map(m => m.id));
      for (const m of s.members) { const P = peers.get(m.id); if (P && m.v && P.vs && m.v.vs !== P.vs) drop(m.id); else if (P && m.v && !P.vs) P.vs = m.v.vs; } // they rejoined: start fresh
      for (const id of there) if (!peers.has(id) && me.id < id) { const P = makePeer(id); if (P) P.vs = (s.members.find(m => m.id === id).v || {}).vs || ""; } // the lower id starts; the other answers when the offer arrives
      for (const id of [...peers.keys()]) if (!there.has(id)) drop(id);
      for (const id of peers.keys()) volFor(id);
    }
    render();
  }
  function onReconnect() { if (inVoice) { for (const id of [...peers.keys()]) drop(id); vs = Math.random().toString(36).slice(2, 10); send({ type: "voice", on: true, muted, vs }); } }
  function onForceMute(except) { const me = getMe(); if (inVoice && me && !(except || []).includes(me.id)) { setMuted(true); toast("🔇 A mod muted all open mics."); } }

  /* ---------- screen ---------- */
  function render() {
    if (!$("hl-voice")) return;
    const me = getMe(), list = st ? st.members.filter(m => m.v) : [], full = st && list.length >= (st.vmax || 12) && !inVoice;
    $("hl-vcount").textContent = st ? `${list.length}/${st.vmax || 12}` : "";
    $("hl-vjoin").hidden = inVoice; $("hl-vjoin").disabled = !!full; $("hl-vjoin").textContent = full ? "Voice is full" : "🎙️ Join voice";
    $("hl-vmute").hidden = $("hl-vleave").hidden = $("hl-vptt").hidden = !inVoice;
    const live = inVoice && !muted && !smute;
    $("hl-vmute").textContent = smute ? "🔇 Mod muted" : muted ? "🔇 Muted · tap to talk" : "🎙️ Live · tap to mute";
    $("hl-vmute").classList.toggle("live", live); $("hl-vmute").setAttribute("aria-pressed", String(!muted));
    $("hl-vlist").innerHTML = list.length ? list.map(m => {
      const self = me && m.id === me.id, P = peers.get(m.id), cs = P ? P.pc.connectionState : "";
      const status = m.v.smute ? "🔇 mod muted" : m.v.muted ? "🔇" : "🎙️";
      const conn = self ? "" : !inVoice ? "" : cs === "connected" ? "" : cs === "failed" ? " · can't connect" : " · connecting…";
      const modBtn = st.you && st.you.mod && !self && !m.host ? `<button type="button" data-cmd="!${m.v.smute ? "unmute" : "mute"} ${esc(m.name)}" title="${m.v.smute ? "Let them talk" : "Mute them for everyone"}">${m.v.smute ? "🔊" : "🔇"}</button>` : "";
      const slider = !self && inVoice ? `<input type="range" min="0" max="1" step="0.05" value="${vol.has(m.id) ? vol.get(m.id) : 1}" data-vol="${esc(m.id)}" aria-label="Volume for ${esc(m.name)}">` : "";
      return `<li data-vid="${esc(m.id)}"><i class="hl-ring" aria-hidden="true"></i><span>${esc(m.name)}${self ? " (you)" : ""}<small>${status}${conn}</small></span>${slider}${modBtn}</li>`;
    }).join("") : `<li class="hl-empty">Nobody's in voice yet.</li>`;
  }
  // speaking rings, 10× a second
  setInterval(() => {
    if (!$("hl-vlist")) return; const me = getMe();
    for (const li of $("hl-vlist").querySelectorAll("[data-vid]")) {
      const id = li.dataset.vid; let lv = 0;
      if (me && id === me.id) lv = localMeter && track && track.enabled ? level(localMeter) : 0;
      else { const P = peers.get(id); lv = P && P.node && !P.audio.muted ? level(P.node) : 0; }
      li.classList.toggle("talking", lv > 0.02);
    }
  }, 100);

  async function fillDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const ds = await navigator.mediaDevices.enumerateDevices();
    const opt = (d, sel) => `<option value="${esc(d.deviceId)}"${d.deviceId === sel ? " selected" : ""}>${esc(d.label || "Device")}</option>`;
    $("hl-vmic").innerHTML = `<option value="">Default mic</option>` + ds.filter(d => d.kind === "audioinput" && d.deviceId !== "default").map(d => opt(d, opts.mic)).join("");
    const outs = ds.filter(d => d.kind === "audiooutput" && d.deviceId !== "default");
    $("hl-vout").innerHTML = `<option value="">Default speakers</option>` + outs.map(d => opt(d, opts.out)).join("");
    $("hl-vout").disabled = !("setSinkId" in HTMLMediaElement.prototype);
    document.dispatchEvent(new CustomEvent("hall-devices", { detail: ds }));
  }
  async function restartMic() {
    if (!inVoice) return;
    const old = stream; let s; try { s = await getMic(); } catch (e) { return toast("Couldn't switch mics."); }
    stream = s; track = s.getAudioTracks()[0]; applyMute(); localMeter = meter(ctx().createMediaStreamSource(s));
    applyMute();
    if (old) old.getTracks().forEach(t => t.stop());
  }

  function init(o) {
    send = o.send; getMe = o.me;
    $("hl-vjoin").addEventListener("click", join);
    $("hl-vleave").addEventListener("click", () => leave());
    $("hl-vmute").addEventListener("click", () => setMuted(!muted));
    const ptb = $("hl-vptt");
    ptb.addEventListener("pointerdown", e => { e.preventDefault(); talk(true); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => ptb.addEventListener(ev, () => talk(false)));
    // push to talk: hold ` (backtick) when you're not typing
    addEventListener("keydown", e => { if (e.key === "`" && !e.repeat && inVoice && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); talk(true); } });
    addEventListener("keyup", e => { if (e.key === "`") talk(false); });
    $("hl-vset").addEventListener("click", () => { const p = $("hl-vsettings"); p.hidden = !p.hidden; $("hl-vset").setAttribute("aria-expanded", String(!p.hidden)); if (!p.hidden) fillDevices(); });
    for (const [id, k] of [["hl-vec", "ec"], ["hl-vns", "ns"], ["hl-vagc", "agc"]]) {
      const c = $(id); c.checked = !!opts[k]; c.addEventListener("change", () => { opts[k] = c.checked; saveOpts(); restartMic(); });
    }
    const sv = $("hl-vsaver"); sv.checked = saver();
    sv.addEventListener("change", () => { opts.saver = sv.checked; saveOpts(); for (const P of peers.values()) capSender(P); toast(sv.checked ? "Data saver on: 16 kbps voice." : "Data saver off: 24 kbps voice."); });
    $("hl-vmic").addEventListener("change", e => { opts.mic = e.target.value; saveOpts(); restartMic(); });
    $("hl-vout").addEventListener("change", e => { opts.out = e.target.value; saveOpts(); for (const P of peers.values()) if (P.audio.setSinkId) P.audio.setSinkId(opts.out).catch(() => {}); });
    $("hl-vlist").addEventListener("input", e => { const r = e.target.closest("[data-vol]"); if (!r) return; vol.set(r.dataset.vol, +r.value); volFor(r.dataset.vol); });
    addEventListener("pagehide", () => leave(true));
  }
  return { _pcs: () => [...peers.values()].map(P => P.pc), init, onState, onSignal, onReconnect, onForceMute, leave, fillDevices, get inVoice() { return inVoice; },
    off(why) { leave(true); if (why) toast(why); } };
})();
