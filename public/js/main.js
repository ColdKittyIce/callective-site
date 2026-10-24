/* Boot: data, live status, countdown, modes. */
(async () => {
  const WEEK = 10080, START = 6 * 1440 + 19 * 60, END = WEEK;
  function etMinute(d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) * 1440 + (+p.hour) * 60 + (+p.minute);
  }
  function countdown() {
    const m = etMinute(), live = C.live ? C.live.live : (m >= START && m < END), box = $("next");
    box.classList.toggle("live", live);
    const lamp = $("lamp"); lamp.classList.toggle("live", live); $("lamptxt").textContent = live ? "Live now" : "Off the hook";
    if (live) { $("next-label").textContent = C.live ? "On the air now" : "Show time"; $("next-time").textContent = C.live ? "Listen on Prankcast" : "Should be on now"; $("next-local").textContent = "Until midnight ET"; return; }
    const left = (START - m + WEEK) % WEEK, d = Math.floor(left / 1440), h = Math.floor(left % 1440 / 60), mm = left % 60;
    $("next-label").textContent = "Next show in";
    $("next-time").textContent = (d ? `${d}d ` : "") + `${String(h).padStart(2, "0")}h ${String(mm).padStart(2, "0")}m`;
    const start = new Date(Date.now() + left * 60000);
    $("next-local").textContent = start.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  }

  Router.init(); Player.init(); FX.init();
  try { const m = localStorage.getItem("cx-mode"); if (m) setMode(m); } catch (e) {}
  await Promise.all([loadData(), detectApi()]);
  countdown(); setInterval(countdown, 30000);
  if (C.api) setInterval(async () => { try { C.live = await getJSON(C.api + "/status", 5000); countdown(); document.dispatchEvent(new CustomEvent("status")); } catch (e) {} }, 30000);

  Dial.init(); Hold.init(); Line.init(); SB.init(); Replay.init(); Lab.init(); Clipper.init(); Board.init();
  Court.init(); Lineup.init(); Bill.init(); Directory.init(); Bingo.init(); Downloads.init();
  await Listen.init();
  mergeLatest();

})();
