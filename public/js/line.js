/* The line: the four real steps on the left, and the rehearsal booth on the right. The booth is a little game that walks
   through a show night: drop a PLA bell, wait in line (stay muted, Patrick is watching), get a premise, make the call,
   read the chat, buttslam, see how you did. The real queue lives in the WOPC Discord. Everyone in line here is made up. */
const Line = (() => {
  const DISCORD = "https://discord.gg/NCHd2Mp5km";
  const AHEAD = ["Guy Who Owns The Roof (allegedly)", "Somebody's Hippie Aunt", "The Duck's Lawyer", "A Very Confused Grandpa", "Mop Enthusiast",
    "Sleepwalker #3", "Professional Pie Sitter", "A Guy On The City Bus", "Regional Ice Machine Director", "First-Timer Who Won't Stop Apologizing",
    "Man In Full Pumpkin Suit", "Somebody With 15 Support Animals", "Night DJ From 101.1 The Butt", "Crow Handler", "Lunk"];
  const PATRICK_NEXT = ["Alright, that one's done. I got a badge and I'm usin' it. NEXT.", "Done. Hang it up. NEXT.", "That's enough of that. Movin' the line. NEXT.",
    "Somebody clip that. Anyway. NEXT.", "Wrap it up, wrap it up. NEXT."];
  const PATRICK_MUTE = ["Hey. HEY. You're unmuted. Rule 1. Mute up.", "I can hear you breathing. Mute. Now.", "That's a hot mic, pal. Back of the line if it happens again."];
  const CHAT_GOOD = ["LMAOOO", "caw", "good job", "🔔🔔🔔", "this is the one", "clip it clip it", "HE'S NOT BREAKING", "roycipient is cooked", "😭😭😭", "keep going", "TOM MAN", "she believes it", "lunk alarm"];
  const CHAT_BAD = ["uh oh", "he's breaking", "dead air", "🦗", "rule 4: sometimes calls just don't work out", "it's ok we love you", "dial tone", "hang up hang up"];
  const S = { stage: "wait", queue: [], ticket: 0, muted: true, strikes: 0, premise: null, laughs: 50, t: 0, timers: [] };
  const $b = () => $("bt-body");
  const later = (fn, ms) => { const t = setTimeout(fn, ms); S.timers.push(t); return t; };
  const clearAll = () => { S.timers.forEach(clearTimeout); S.timers = []; clearInterval(S.tick); };
  const log = html => { $("bt-log").innerHTML = html; };
  const stage = (k, label) => { S.stage = k; $("bt-stage").textContent = label; $("booth").dataset.stage = k; };
  const pickN = (a, n) => [...a].sort(() => Math.random() - .5).slice(0, n);

  function waiting() {
    clearAll(); stage("wait", "Waiting room"); S.queue = []; S.strikes = 0; S.muted = true;
    $b().innerHTML = `<div class="bt-center"><p class="bt-big">Saturday, 7:00 PM. The voice channel is packed.</p>
      <button class="bt-bell" type="button" id="bt-bell" aria-label="Drop a PLA bell"><img src="img/pla-bell-lg.png" alt="" width="72" height="72"><span>Drop a PLA bell</span></button>
      <p class="bt-hint">That's how you get in line for real, too: the PLA bell emoji in the voice channel's text chat.</p></div>`;
    log("The booth is a rehearsal. Nobody in it is real, and nobody can hear you.");
  }
  function inLine() {
    stage("line", "In line"); SFX.ring();
    S.queue = pickN(AHEAD, 3 + Math.floor(Math.random() * 3)).map(n => ({ n })); S.queue.push({ n: "YOU", you: true }); S.ticket = S.queue.length;
    paintLine(); log(`Ticket #${S.ticket}. Patrick has your number. Stay muted until he calls you.`);
    advance();
  }
  function paintLine(msg) {
    $b().innerHTML = `<ol class="tickets bt-q">${S.queue.map((x, i) => `<li class="ticket ${i === 0 ? "up" : ""} ${x.you ? "you" : ""}"><span class="pos">#${i + 1}</span><span class="nm">${esc(x.n)}</span>${i === 0 ? `<span class="tag">On the phone</span>` : "<span></span>"}</li>`).join("")}</ol>
      <div class="bt-row"><button class="bt-mic ${S.muted ? "" : "hot"}" type="button" id="bt-mic" aria-pressed="${!S.muted}">${S.muted ? "🔇 Muted" : "🎙️ MIC IS HOT"}</button>
      <span class="bt-patrick" id="bt-pat">${msg || "Patrick: I see you. Stay muted."}</span></div>`;
  }
  function advance() {
    later(() => {
      if (S.stage !== "line") return;
      if (S.queue[0]?.you) return yourTurn();
      S.queue.shift(); click(0, .4); paintLine("Patrick: " + pick(PATRICK_NEXT));
      if (S.queue[0]?.you) later(yourTurn, 1600); else advance();
    }, 2300 + Math.random() * 1200);
  }
  function mic() {
    if (S.stage !== "line") return;
    S.muted = !S.muted;
    if (!S.muted) {
      S.strikes++; SFX.thump();
      if (S.strikes >= 2) { const me = S.queue.findIndex(x => x.you); const [you] = S.queue.splice(me, 1); S.queue.push(you); S.muted = true;
        paintLine("Patrick: Second hot mic. Back of the line. I don't make the rules. Ira does."); log("Rule 1: keep your mic muted until it's your turn. You got moved to the back."); return; }
      paintLine("Patrick: " + pick(PATRICK_MUTE)); log("Rule 1: mic stays muted until the host calls you. One more and it's the back of the line.");
    } else paintLine("Patrick: Better.");
  }
  function yourTurn() {
    clearAll(); stage("up", "You're up"); SFX.pickup();
    S.premise = Premise.random(); S.rerolls = 1;
    paintPremise(); log("Now calling YOU. The host hands you the phone.");
  }
  function paintPremise() {
    const p = S.premise;
    $b().innerHTML = `<div class="bt-card"><small>Patrick: Now calling YOU. Here's your bit.</small>
      <p class="bt-prem">Call <b>${esc(p.who)}</b>. You're <b>${esc(p.you)}</b>, and you <b>${esc(p.want)}</b>.</p>
      <div class="bt-row"><button class="btn sm red solid" type="button" id="bt-dial">☎ Dial it</button>${S.rerolls ? `<button class="btn sm ghost" type="button" id="bt-reroll">New premise (1 left)</button>` : ""}</div>
      <p class="bt-hint">Rules before you dial: no police or emergency lines, keep it fun not abusive, and never leak the source. If you reveal, you're 101.1 The Butt.</p></div>`;
  }
  function dial() {
    stage("dial", "Dialing"); $b().innerHTML = `<div class="bt-center"><p class="bt-big bt-dots">Dialing</p></div>`;
    // three digits on the rotary (real recordings), then it rings
    let at = 0; [5, 5, 5].forEach(d => { later(() => SFX.rotary(d) || click(0, .4), at); at += 1150; });
    later(() => { const b = $b().querySelector(".bt-big"); if (b) b.textContent = "Ringing…"; SFX.ringback(2); }, at + 200);
    later(live, at + 4800);
  }
  function live() {
    stage("live", "LIVE"); SFX.pickup(); S.laughs = 50; S.t = 40;
    $b().innerHTML = `<div class="bt-live"><div class="bt-top"><span class="bt-onair">● ON AIR</span><span class="bt-clock" id="bt-clock">0:40</span></div>
      <p class="bt-them" id="bt-them">“Thank you for calling, this is ${esc(S.premise.who.replace(/^an? /, "the "))}, how can I help you?”</p>
      <div class="bt-meter"><i id="bt-meter" style="width:50%"></i><span>Laugh meter</span></div>
      <ul class="bt-chat" id="bt-chat"></ul>
      <div class="bt-row"><button class="btn sm" type="button" id="bt-commit">Commit to the bit</button><button class="btn sm ghost" type="button" id="bt-escalate">Escalate</button><button class="btn sm ghost" type="button" id="bt-break">Break character</button><button class="btn sm red solid" type="button" id="bt-slam">BUTTSLAM</button></div></div>`;
    chat(pick(CHAT_GOOD));
    S.tick = setInterval(() => {
      S.t--; $("bt-clock").textContent = `0:${String(Math.max(0, S.t)).padStart(2, "0")}`;
      if (S.t % 3 === 0) { bump(-4); if (Math.random() < .5) chat(pick(S.laughs > 50 ? CHAT_GOOD : CHAT_BAD)); }
      if (S.t <= 0) end("hangup");
    }, 1000);
    log("You're live. Keep the meter up. Chat's watching.");
  }
  function chat(line) { const ul = $("bt-chat"); if (!ul) return; const li = document.createElement("li"); li.textContent = line; ul.prepend(li); while (ul.children.length > 5) ul.lastChild.remove(); }
  function bump(n) { S.laughs = clamp(S.laughs + n, 0, 100); const m = $("bt-meter"); if (m) m.style.width = S.laughs + "%"; if (S.laughs <= 0) end("dead"); }
  const THEM = ["“…I'm sorry, can you say that again?”", "“Sir, this is a place of business.”", "“Hold on, let me get my manager.”", "“Is this a joke?”", "“…okay. Okay. What's your name?”", "“We don't… we don't do that here.”", "“*long silence*”", "“Ma'am, I'm going to need you to slow down.”"];
  function act(kind) {
    if (S.stage !== "live") return;
    if (kind === "commit") { bump(8 + Math.random() * 8); chat(pick(CHAT_GOOD)); if (Math.random() < .5) $("bt-them").textContent = pick(THEM); }
    if (kind === "escalate") { const ok = Math.random() < .62; bump(ok ? 16 : -14); chat(ok ? pick(CHAT_GOOD) : pick(CHAT_BAD)); $("bt-them").textContent = ok ? pick(THEM) : "“Okay, I'm hanging up now.”"; if (!ok && Math.random() < .35) end("hungup"); }
    if (kind === "break") { bump(-18); chat("he's breaking 😭"); }
    if (kind === "slam") end("slam");
  }
  function end(how) {
    if (S.stage !== "live") return; clearAll(); stage("done", "Hung up");
    if (how === "slam") SFX.thump(); else SFX.hangup();
    const L = Math.round(S.laughs) + (how === "slam" && S.laughs > 40 ? 10 : 0);
    const rank = L >= 85 ? ["Certified Callective legend", "Somebody clip it. This one's going on the board."] : L >= 65 ? ["Good job, caller", "Patrick nods. Barely."]
      : L >= 45 ? ["Solid fleshbag", "Chat liked it. Mostly."] : L >= 20 ? ["Rule 4 applies", "Sometimes calls just don't work out, and it's nobody's fault."] : ["Dead air", "The crickets have entered the chat. Try again."];
    const why = how === "slam" ? "You told them they just got buttslammed by 101.1 The Butt." : how === "hungup" ? "They hung up on you." : how === "dead" ? "The call died. Chat went quiet." : "Time's up. The host took the phone back.";
    $b().innerHTML = `<div class="bt-card bt-end"><small>${esc(why)}</small><b class="bt-score">${clamp(L, 0, 100)}%</b><p class="bt-rank">${rank[0]}</p><p class="bt-hint">${rank[1]}</p>
      <div class="bt-row"><a class="btn sm blue solid" href="${DISCORD}" target="_blank" rel="noopener">Do it for real: Saturday 7PM ET</a><button class="btn sm ghost" type="button" id="bt-again">Rehearse again</button></div></div>`;
    log("For real: join the WOPC Discord, hop in The Callective voice channel on Saturday, drop the PLA bell in its text chat, and wait for the bot to call you.");
  }
  function init() {
    waiting();
    $("booth").addEventListener("click", e => {
      const id = e.target.closest("button")?.id; if (!id) return;
      ({ "bt-bell": inLine, "bt-mic": mic, "bt-dial": dial, "bt-reroll": () => { S.rerolls = 0; S.premise = Premise.random(); paintPremise(); click(0, .3); },
        "bt-commit": () => act("commit"), "bt-escalate": () => act("escalate"), "bt-break": () => act("break"), "bt-slam": () => act("slam"), "bt-again": waiting })[id]?.();
    });
  }
  return { init };
})();
