/* The line: a practice queue to play with. The real queue lives in the Discord. */
const Line = (() => {
  const SAMPLE = ["Arbee", "despicabledogs", "AndyAnderson", "GreenImp", "CrieFaux", "Buc-ee’s Kansas City", "cyber space kosmonaut"];
  let items = SAMPLE.map(n => ({ name: n }));

  function render(enterIdx = -1) {
    $("tickets").innerHTML = items.map((x, i) => {
      const cls = [i === 0 ? "up" : "", x.allcall ? "all" : "", x.you ? "you" : "", i === enterIdx ? "enter" : ""].join(" ");
      const tag = i === 0 ? "On the phone" : x.allcall ? "All call" : "";
      return `<li class="ticket ${cls}"><span class="pos">#${i + 1}</span><span class="nm">${esc(x.name)}</span>${tag ? `<span class="tag">${tag}</span>` : "<span></span>"}</li>`;
    }).join("") || `<li class="ticket"><span class="pos">–</span><span class="nm">Nobody's waiting.</span><span></span></li>`;
  }
  const log = html => { $("qlog").innerHTML = html; };
  const myName = () => ($("qname").value.trim() || "You").slice(0, 24);

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
  }
  return { init };
})();
