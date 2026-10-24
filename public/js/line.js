/* The line: the live queue from the Discord bot when a show is on, a practice line otherwise. */
const Line = (() => {
  const SAMPLE = ["Arbee", "despicabledogs", "AndyAnderson", "GreenImp", "CrieFaux", "Buc-ee’s Kansas City", "cyber space kosmonaut"];
  let mode = "practice", items = SAMPLE.map(n => ({ name: n })), pollT = null, lastLiveKey = "";
  const FRESH_MS = 15 * 60 * 1000;

  function render(enterIdx = -1) {
    $("tickets").innerHTML = items.map((x, i) => {
      const cls = [i === 0 ? "up" : "", x.allcall ? "all" : "", x.you ? "you" : "", i === enterIdx ? "enter" : ""].join(" ");
      const tag = i === 0 ? "On the phone" : x.allcall ? "All call" : "";
      return `<li class="ticket ${cls}"><span class="pos">#${i + 1}</span><span class="nm">${esc(x.name)}</span>${tag ? `<span class="tag">${tag}</span>` : "<span></span>"}</li>`;
    }).join("") || `<li class="ticket"><span class="pos">–</span><span class="nm">Nobody's waiting.</span><span></span></li>`;
  }
  function setStatus(kind, text) {
    const s = $("qstatus"); s.className = "status-pill " + (kind || ""); s.querySelector("span").textContent = text;
  }
  const log = html => { $("qlog").innerHTML = html; };
  const myName = () => ($("qname").value.trim() || "You").slice(0, 24);

  function practiceControls(on) { $("qctl").hidden = !on; }

  async function poll() {
    if (!C.api) return;
    try {
      const q = await getJSON(C.api + "/queue", 5000);
      const fresh = q && q.updated && (Date.now() - Date.parse(q.updated) < FRESH_MS) && (C.live?.live || q.items?.length);
      if (fresh) {
        const key = JSON.stringify(q.items);
        const prev = new Set(items.map(x => x.name));
        mode = "live"; practiceControls(false);
        items = (q.items || []).map(x => ({ name: x.name, allcall: !!x.allcall }));
        const newIdx = items.findIndex(x => !prev.has(x.name));
        if (key !== lastLiveKey) render(newIdx);
        lastLiveKey = key;
        setStatus(q.locked ? "locked live" : "live", q.locked ? "Live · queue closed" : "Live from the Discord");
        const ago = Math.max(0, Math.round((Date.now() - Date.parse(q.updated)) / 1000));
        log(q.locked ? `The queue is closed right now. Updated ${ago < 60 ? ago + "s" : Math.round(ago / 60) + "m"} ago.` :
          `This is the real queue. Updated ${ago < 60 ? ago + "s" : Math.round(ago / 60) + "m"} ago. Want in? <a href="https://discord.gg/NCHd2Mp5km" target="_blank" rel="noopener">Join the Discord</a> and drop a PLA bell.`);
      } else if (mode === "live") {
        mode = "practice"; items = SAMPLE.map(n => ({ name: n })); render(); practiceControls(true);
        setStatus("", "Practice line"); log("The show's over, so this is a practice line again.");
      }
    } catch (e) {}
  }

  function init() {
    render();
    $("q-join").addEventListener("click", () => {
      const n = myName(), at = items.findIndex(x => !x.allcall && x.name.toLowerCase() === n.toLowerCase());
      if (at >= 0) { log(`<b>${esc(n)}</b> is already on the line at #${at + 1}.`); return; }
      items.push({ name: n, you: true }); render(items.length - 1); tone(880, .12, .08);
      log(`<b>${esc(n)}</b> dropped a PLA bell and got ticket #${items.length}.`);
    });
    $("q-next").addEventListener("click", () => {
      if (!items.length) { log("Nobody's waiting. Drop a PLA bell to get it going."); return; }
      const done = items.shift(); render(); click(0, .4);
      if (items[0]?.you) playClip("icecat-what-call");
      log(items.length ? `${esc(done.name)} hung up. You're up, <b>${esc(items[0].name)}</b>.` : `${esc(done.name)} hung up. That was the last call of the night.`);
    });
    $("q-all").addEventListener("click", () => {
      items.push({ name: `ALL CALL by ${myName()}`, allcall: true }); render(items.length - 1);
      log(`<b>All Call</b> queued at #${items.length}. Everybody on the line for that one.`);
    });
    if (C.api) { poll(); pollT = setInterval(() => { if (!document.hidden) poll(); }, 10000); }
  }
  return { init };
})();
