/* Court, lineup, phone bill, directory and the hold line. */

/* ---------- hold line + player bar ---------- */
const Hold = (() => {
  const TRACKS = [
    { k: "theme", t: "The Callective Theme", s: "By IceCat and Suno · the opener", d: "1:19" },
    { k: "ira-rules", t: "Ira Reads the Rules", s: "The best part of the show, per the chat. Not a bit.", d: "2:28" },
    { k: "farewell", t: "The Callective Farewell", s: "By IceCat and Suno · the closer", d: "3:20" },
    { k: "theme-2026", t: "The Callective Theme, 2026 take", s: "Newer cut of the opener", d: "1:19" },
    { k: "jingle", t: "Jingle: Ramp In & Out", s: "Bumper between calls", d: "0:27" },
    { k: "sting", t: "Jingle: Sting", s: "Instrumental hit", d: "0:05" },
    { k: "technical-issues", t: "The Technical Issues Song", s: "Plays when the phones fight back and win", d: "3:50" },
    { k: "host-has-to-pee", t: "Host Has to Pee", s: "For when the host has to pee. Again.", d: "2:08" },
    { k: "badly-sung", t: "The Theme, Badly Sung", s: "a.k.a. the drunk version. Rule 5 was not enforced.", d: "0:31" },
    { k: "church", t: "The Theme, Church Version", s: "Alternate version", d: "1:00" },
    { k: "lullaby", t: "The Theme, Lullaby Version", s: "Alternate version", d: "0:54" },
    { k: "dinglective", t: "Dinglective Remix", s: "Dial D-I-N-G", d: "1:05" },
    { k: "doglective", t: "The Doglective", s: "Dial D-O-G", d: "1:35" },
    { k: "hellective", t: "Hellective Theme", s: "Dial H-E-L-L", d: "1:59" },
    { k: "cheers-to-ira", t: "Cheers to Ira the Governor", s: "A toast to the show runner, who is muting you right now", d: "3:18" },
    { k: "be-quiet", t: "Be Quiet, the Callective Is On", s: "Drop", d: "0:05" }];
  const T = Object.fromEntries(TRACKS.map(t => [t.k, t]));
  let cur = null; const aud = () => $("holdaud");
  function sync() {
    const on = cur && !aud().paused;
    document.querySelectorAll("[data-hold]").forEach(b => b.classList.toggle("is-playing", on && b.dataset.hold === cur));
    document.querySelectorAll(".track").forEach(li => li.classList.toggle("cur", li.dataset.k === cur));
    Player.sync();
  }
  function play(k) {
    if (!T[k]) return;
    if (cur === k) { aud().paused ? (Media.claim(aud()), aud().play().catch(() => {})) : aud().pause(); return; }
    cur = k; aud().src = `audio/${k}.mp3`; Media.claim(aud()); aud().play().catch(() => {});
    Player.set({ kind: "song", el: aud(), title: T[k].t, page: "downloads", seek: true, clip: () => Player.clipFrom(aud(), `audio/${k}.mp3`, T[k].t) });
    $("callerno").textContent = Math.max(1, TRACKS.length - TRACKS.findIndex(t => t.k === k) - 1);
  }
  function init() {
    $("tracks").innerHTML = TRACKS.map((t, i) => `<li class="track" data-k="${t.k}"><button type="button" data-hold="${t.k}" aria-label="Play ${esc(t.t)}"><span class="tri" aria-hidden="true"></span></button><span class="ln">LINE ${i + 1}</span><div class="tt"><b>${esc(t.t)}</b><span>${esc(t.s)}</span></div><span class="d">${t.d}</span><a class="dl" href="audio/${t.k}.mp3" download="callective-${t.k}.mp3" aria-label="Download ${esc(t.t)}">MP3 ↓</a></li>`).join("");
    document.addEventListener("click", e => { const b = e.target.closest("[data-hold]"); if (b) play(b.dataset.hold); });
    document.addEventListener("player-stopped", () => { if (aud().paused) { cur = null; sync(); } });
    const a = aud();
    ["play", "pause", "ended"].forEach(ev => a.addEventListener(ev, sync));
  }
  return { init, play, TRACKS };
})();
window.Hold = Hold;

/* ---------- court ---------- */
const Court = {
  init() {
    const known = { 2: "Put the PLA bell in chat.", 3: "Follow the rules of WOPC." };
    $("callmandments").innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(n => known[n]
      ? `<li><span>${n}.</span>${known[n]}</li>`
      : `<li class="sealed"><span>${n}.</span><em aria-label="Sealed">${"█".repeat(10 + (n * 7) % 14)}</em></li>`).join("");
    $("gavel").addEventListener("click", () => { SFX.thump(); const b = $("bench"); b.classList.remove("banged"); void b.offsetWidth; b.classList.add("banged"); setTimeout(() => Hold.play("ira-rules"), 350); });
    $("objection").addEventListener("click", () => { playClip("anteater-court"); toast("Sustained. Somebody settle this out of court."); });
  }
};

/* ---------- lineup ---------- */
const Lineup = (() => {
  const S = [
    { k: "ira", name: "Ira", aka: "iregretjumping · the Governor", role: "Show runner", sign: "LEAKED CALL SOURCE", no: "0001", host: "iregretjumping", clip: "ira-my-name",
      imgs: [["Happy", "lineup-ira.webp"], ["Sad", "lineup-ira-sad.webp"]], priors: "Reads the rules at the top of every show, then gets asked to read them again. Wrote rule 5 for you specifically. Knows what you did." },
    { k: "icecat", name: "IceCat", aka: "icecat", role: "Crew", sign: "REFUSED TO MUTE", no: "0002", host: "IceCat", clip: "icecat-what-call",
      imgs: [["Excited", "lineup-icecat.webp"], ["Confused", "lineup-icecat-confused.webp"]], priors: "Made the logo, the cartoon cast, the theme songs and the queue bot. Also recorded the drunk version of the theme, which he will not be taking questions about." },
    { k: "dogs", name: "DespicableDogs", aka: "despicabledogs", role: "Crew", sign: "TOO LOUD ON MIC", no: "0003", host: "DespicableDogs", clip: "dogs-woo",
      imgs: [["Hype", "lineup-dogs.webp"]], priors: "Never seen without the sunglasses or the 101.1 The Butt hoodie. Will buttslam on sight. Hosted the Bonerhaus corporate takeover and somehow made quarterly targets." },
    { k: "tom", name: "Dr. Tom Servo", aka: "DrTomServo · Tom Man", role: "Crew", sign: "HACKED THE QUEUE SYSTEM", no: "0004", host: "Dr. Tom Servo", clip: "tom-yeaugh",
      imgs: [["Servo", "lineup-tom.webp"], ["Tom Man", "tomman.webp"]], priors: "Hosts more Callectives than anyone. Has a cape. Owns the roof, the sky, and every shingle you call a liar about." }];
  function stats(host) {
    const seen = new Map(); for (const e of C.episodes) if (e.h === host) seen.set(e.d || e.id, e);
    const list = [...seen.values()].filter(e => e.d).sort((a, b) => b.d.localeCompare(a.d));
    return { n: seen.size, last: list[0] };
  }
  function sheet(s, img = 0) {
    const st = stats(s.host);
    $("sheet").innerHTML = `<div class="mug">${s.imgs.length > 1 ? `<div class="mood" role="group" aria-label="Photo">${s.imgs.map((m, i) => `<button type="button" data-img="${i}" aria-pressed="${i === img}">${m[0]}</button>`).join("")}</div>` : ""}<img src="img/${s.imgs[img][1]}" alt="${esc(s.name)}"></div>
      <div><p class="kicker" style="color:var(--red)">Booking no. ${s.no}</p><h3>${esc(s.name)}</h3>
      <dl><dt>Known as</dt><dd>${esc(s.aka)}</dd><dt>Role</dt><dd>${esc(s.role)}</dd><dt>Charge</dt><dd>${esc(s.sign.charAt(0) + s.sign.slice(1).toLowerCase())}</dd>
      <dt>Shows hosted</dt><dd>${st.n} on Prankcast${st.last ? ` · last on ${fmtDate(st.last.d)}` : ""}</dd><dt>Priors</dt><dd>${esc(s.priors)}</dd></dl>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px"><span class="stamp">BOOKED</span>${st.last ? (isRecent(st.last.id) ? `<button class="btn sm" type="button" data-replay="${st.last.id}">Replay their last show</button>` : `<a class="btn sm" href="${PC_POST}${st.last.id}" target="_blank" rel="noopener">Their last show on Prankcast ↗</a>`) : ""}<button class="btn sm" type="button" data-clip="${s.clip}">Hear from the suspect</button></div></div>`;
    $("sheet").querySelectorAll("[data-img]").forEach(b => b.addEventListener("click", () => sheet(s, +b.dataset.img)));
  }
  function choose(s) {
    document.querySelectorAll(".suspect").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === s.k)));
    const f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); SFX.shutter(); sheet(s);
  }
  function init() {
    $("suspects").innerHTML = S.map(s => `<button class="suspect" type="button" data-k="${s.k}" aria-pressed="false" aria-label="Pick ${esc(s.name)} out of the lineup"><img src="img/${s.imgs[0][1]}" alt="" loading="lazy"><span class="plate"><small>${s.no}</small><b>${s.sign}</b></span></button>`).join("");
    $("suspects").addEventListener("click", e => { const b = e.target.closest(".suspect"); if (b) choose(S.find(s => s.k === b.dataset.k)); });
    document.addEventListener("click", e => { const c = e.target.closest("[data-clip]"); if (c) playClip(c.dataset.clip); const r = e.target.closest("[data-replay]"); if (r) Replay.load(+r.dataset.replay); });
    sheet(S[0]); document.querySelector('.suspect[data-k="ira"]').setAttribute("aria-pressed", "true");
  }
  return { init };
})();

/* ---------- phone bill ---------- */
const Bill = {
  init() {
    const by = new Map(); let unnamed = 0;
    for (const e of C.episodes) { if (!e.h) { unnamed++; continue; } if (!by.has(e.h)) by.set(e.h, new Map()); by.get(e.h).set(e.d || e.id, e); }
    const rows = [...by].map(([h, m]) => ({ h, n: m.size, min: Math.round([...m.values()].reduce((s, e) => s + (e.sec || 0), 0) / 60) })).sort((a, b) => b.min - a.min);
    const maxMin = Math.max(...rows.map(r => r.min)), dates = C.episodes.filter(e => e.d).map(e => e.d).sort();
    $("bill-period").textContent = `${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}`;
    const totN = rows.reduce((s, r) => s + r.n, 0), totM = rows.reduce((s, r) => s + r.min, 0);
    $("billtable").innerHTML = `<thead><tr><th>Host</th><th class="num">Shows</th><th class="num">Minutes on the line</th><th style="width:28%"><span class="sr">Share</span></th><th class="num">Charge</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.h)}</td><td class="num">${r.n}</td><td class="num">${r.min.toLocaleString()}</td><td><span class="bar" style="width:${(r.min / maxMin * 100).toFixed(1)}%"></span></td><td class="num">$0.00</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${totN}</td><td class="num">${totM.toLocaleString()}</td><td></td><td class="num">$0.00</td></tr></tfoot>`;
    $("billnote").textContent = `Counted from Prankcast episode titles, plus hosts worked out from the Discord chat for uploads that didn't name one. ${unnamed} uploads are still unknown (mostly spring and summer 2025). Shows uploaded twice are counted once.`;
  }
};

/* ---------- directory ---------- */
const Directory = (() => {
  const ADS = [
    [14917, "Dingtember Special", "It's always Dingtember on this line."], [14548, "MEGA 4-Hour Show", "Over four hours on the phone. Bring snacks."],
    [14481, "Fourth of July Special", "We are Paul."], [14452, "The Poop Texts Show", "We called a guy who was getting poop texts, and he called us back."],
    [13908, "April Fools Special", "Hosted by iregretjumping. Allegedly."], [13536, "Valentine's Day Special", "Hosted by milkbox. Somebody got their heart broken by a front desk."],
    [13091, "Secret Santa Special", "The community swapped lists of wacky things to ask Five Below for."], [12938, "The Only Pranksgiving Special (so far)", "Three and a half hours of Thanksgiving calls. Pass the stuffing and the phone."],
    [12389, "The Secret Show", "A secret after-show, in two parts."]];
  let filter = "all", all = false;
  const SPECIAL = new Set([...ADS.map(a => a[0]), 12390, 13693, 13477, 11726]);
  function hosts() { const c = new Map(); for (const e of C.episodes) if (e.h) c.set(e.h, (c.get(e.h) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).slice(0, 7).map(x => x[0]); }
  function chips() { $("yp-chips").innerHTML = [["all", "All"], ["specials", "Specials"], ...hosts().map(h => [h, h])].map(([k, l]) => `<button class="yp-chip" type="button" data-k="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join(""); }
  function list() {
    const q = $("yp-q").value.trim().toLowerCase();
    let L = C.episodes.filter(e => filter === "all" || (filter === "specials" ? SPECIAL.has(e.id) : e.h === filter));
    if (q) L = L.filter(e => `${e.t} ${e.n || ""} ${e.h || ""} ${fmtDate(e.d)} ${(C.calls[e.id]?.calls || []).map(c => c.by + " " + (c.title || "")).join(" ")}`.toLowerCase().includes(q));
    const S = all ? L : L.slice(0, 30);
    $("listings").innerHTML = S.map(e => `<div class="lst"><a class="tt" href="#show/${e.id}">${esc(niceTitle(e))}</a><span class="dots"><span class="d">${esc(fmtDate(e.d))}</span><span class="len">${fmtLen(e.sec || 0)}</span></span>${e.h ? `<span class="h">Host: ${esc(e.h)}${e.hq ? ` <i title="Worked out from the Discord chat">(${esc(e.hq)})</i>` : ""}</span>` : ""}${C.calls[e.id]?.desc ? `<span class="n">${esc(C.calls[e.id].desc)}</span>` : e.n ? `<span class="n">${esc(e.n)}</span>` : ""}${C.calls[e.id] ? `<span class="n cl">${callsFor(e.id).filter(c => !c.skip).length} calls: ${esc([...new Set(callsFor(e.id).filter(c => !c.skip).map(c => c.by))].join(", "))}</span>` : ""}<span class="acts"><a href="#show/${e.id}">${C.calls[e.id] ? "Call list & details" : "Details"}</a>${isRecent(e.id) ? `<button type="button" data-replay="${e.id}">▶ Play here with chat</button><a href="${PC_POST}${e.id}" target="_blank" rel="noopener">Prankcast ↗</a>` : `<a href="${PC_POST}${e.id}" target="_blank" rel="noopener">▶ Listen on Prankcast ↗</a>`}</span></div>`).join("")
      || `<div class="lst"><span class="tt">No listings.</span><span class="h">Try another word, or pick All.</span></div>`;
    $("yp-count").textContent = `${S.length} of ${L.length} listings`; $("yp-more").hidden = all || L.length <= 30;
  }
  function init() {
    const byId = Object.fromEntries(C.episodes.map(e => [e.id, e]));
    $("ads").innerHTML = ADS.filter(a => byId[a[0]]).map(([id, t, p]) => { const e = byId[id];
      return `<a class="ad" href="${PC_POST}${id}" target="_blank" rel="noopener"><small>${esc(fmtDate(e.d))}${e.h ? " · " + esc(e.h) : ""}</small><b>${esc(t)}</b><p>${esc(p)}</p><span class="call">${fmtLen(e.sec || 0)} · Listen ↗</span></a>`; }).join("");
    chips(); list();
    $("yp-chips").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (b) { filter = b.dataset.k; all = false; chips(); list(); } });
    $("yp-q").addEventListener("input", () => { all = false; list(); });
    $("yp-more").addEventListener("click", () => { all = true; list(); });
    document.addEventListener("episodes-changed", list); document.addEventListener("calls-changed", list);
  }
  return { init };
})();

/* ---------- the Do Not Call Me registry (a parody: nothing is stored or sent) ---------- */
const DNC = {
  init() {
    const out = $("dnc-out"), rnd = a => a[Math.floor(Math.random() * a.length)];
    $("dnc-form").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("dnc-name").value.trim(), what = $("dnc-what").value.trim(); if (!name || !what) return;
      const steps = ["Dialing the registry…", "Busy signal. Redialing…", "Transferred to the Governor…", "Ira is reading your form out loud…", "Stamping it…"];
      out.innerHTML = `<ol class="dnc-steps"></ol>`; const ol = out.querySelector("ol"); let i = 0; SFX.ringback(1);
      const tick = () => {
        if (i < steps.length) { ol.insertAdjacentHTML("beforeend", `<li>&gt; ${steps[i++]}</li>`); setTimeout(tick, 650); return; }
        SFX.thump();
        const no = "DNC-" + String(Math.floor(Math.random() * 900000) + 100000), status = rnd(["UNDER ADVISEMENT", "FILED UNDER 'F'", "PENDING FOREVER", "APPROVED (NOT REALLY)", "LOST IN THE QUEUE"]);
        out.innerHTML = `<div class="dnc-cert"><p class="dnc-k">Certificate of Request · ${no}</p>
          <h3>This certifies that</h3><p class="dnc-big">${esc(name)}</p>
          <p>has formally asked not to be called<br><b>“${esc(what)}”</b><br>on Saturdays between 7pm and midnight Eastern.</p>
          <p class="dnc-stamp">${status}</p>
          <p class="ext">Your request has been placed in the queue behind ${Math.floor(Math.random() * 40) + 12} All Calls. The Callective thanks you for your patience and will be calling you something else shortly.</p>
          <p class="ext">Not a real registry. Nothing was saved or sent anywhere.</p>
          <button class="btn sm" type="button" id="dnc-again">File another</button></div>`;
        $("dnc-again").addEventListener("click", () => { $("dnc-form").reset(); out.innerHTML = `<p class="dnc-wait">&gt; Waiting for your paperwork…</p>`; });
      };
      tick();
    });
  }
};

/* ---------- the glossary: running bits, from the show's own history ---------- */
const Glossary = (() => {
  let bits = [];
  const mon = ym => { if (!ym) return ""; const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
  function card(b) {
    const q = b.quote ? `<blockquote><p>“${esc(b.quote.text)}”</p><cite>${esc(b.quote.who)}${b.quote.d ? `, ${esc(b.quote.d)}` : ""}</cite></blockquote>` : "";
    return `<article class="gl-card hud"><header><b>${esc(b.term)}</b><i>${esc(b.kind)}</i></header><p class="gl-def">${esc(b.def)}</p>${q}
      <footer><span>Since ${esc(mon(b.since))}. ${esc(b.stat || "")}</span>${b.search ? `<a href="#search/${encodeURIComponent(b.search)}">Find the calls →</a>` : ""}</footer></article>`;
  }
  function render() {
    const q = $("gl-q").value.trim().toLowerCase();
    const L = bits.filter(b => !q || `${b.term} ${b.kind} ${b.def} ${b.quote?.text || ""}`.toLowerCase().includes(q));
    $("gl-grid").innerHTML = L.map(card).join("") || `<p class="feed-empty">Not in the glossary yet. Try the <a href="#search/${encodeURIComponent(q)}">search</a>.</p>`;
  }
  async function init() {
    try { const d = await getJSON("data/lore.json"); bits = d.bits || []; $("gl-rules").innerHTML = (d.oldrules?.lines || []).map(l => `<li>${esc(l)}</li>`).join(""); } catch (e) { bits = []; }
    render(); $("gl-q").addEventListener("input", render);
  }
  return { init };
})();
