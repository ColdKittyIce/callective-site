/* Dial-a-Premise: three reels (who you call, who you are, what you want), stocked from what the Callective actually calls
   most (hotel front desks by a mile, then pizza places, Five Below, gas stations, HOAs, Tradio sellers...) and its running bits.
   All lines are written for the site; nothing is quoted from chat. Rules still apply: no police, no threats, keep it light. */
const Premise = (() => {
  const W = (n, s) => Array(n).fill(s);
  const R = {
    who: [...W(6, "a hotel front desk"), ...W(2, "a motel night clerk"), ...W(3, "a pizza place"), ...W(2, "a Five Below"), ...W(2, "a gas station"),
      "an HOA office", "someone selling a lawn mower on Tradio", "a mattress store", "a fireworks stand", "a bowling alley", "a trampoline park",
      "a tattoo parlor", "a Dairy Queen", "a car wash", "a zoo gift shop", "an escape room", "a mini golf course", "a giant gas station with 120 pumps",
      "a pet store", "a used car lot", "a party supply store", "a donut shop", "a truck stop", "a bait and tackle shop", "a costume shop"],
    you: ["a guest who dinged a car in their parking lot", "a sleepwalker", "a man in a full pumpkin costume", "head office, calling about Q4 targets",
      "a guy whose duck is on the line too", "a mumble rapper who needs a beat", "a very confused grandpa", "someone's hippie aunt",
      "an Australian on holiday who has questions", "a professional pie sitter", "the biggest Five Below fan alive", "a man who says he owns the roof",
      "a nervous first-time caller", "the night DJ from 101.1 The Butt", "a guest whose crow keeps bringing back room keys", "someone calling from the city bus",
      "a guy who just woke up and isn't sure where he is", "a substitute manager from the other location", "a wedding planner in a crisis",
      "a man who brought 15 support animals", "the regional director of ice machines", "a guest who checked out in 2003 and wants back in"],
    want: ["need a room booked until 2041", "want to pay entirely in arcade tickets", "need someone to cover your shift, right now",
      "want to speak to the manager, who has your exact name", "are upset about the hold music and want it changed", "insist they already agreed to this last week",
      "need them to sign for a delivery of 40 pies", "want a price match with a store that doesn't exist", "want the Wi-Fi password changed to something specific",
      "swear the ice machine is talking to you", "need a quote on 400 rubber ducks", "want to rent the whole lobby for a birthday party",
      "want them to read the rules out loud, all of them", "want to know if anything is certified", "lost something very specific and won't say what it is",
      "need them to hold your spot in line", "want a job interview, on the spot", "have a coupon from 1997 and will fight for it",
      "need directions to their location on the moon", "want to leave a five-star review, but only over the phone", "want them to guess your name first"]
  };
  const keys = ["who", "you", "want"], lock = { who: false, you: false, want: false }, cur = {};
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function line() { return `Call ${cur.who}. You're ${cur.you}, and you ${cur.want}.`; }
  function paint(spinning) {
    for (const k of keys) { const el = $("pm-" + k); el.querySelector("b").textContent = cur[k]; el.classList.toggle("locked", lock[k]); el.classList.toggle("spin", !!spinning && !lock[k]); el.querySelector("button").setAttribute("aria-pressed", String(lock[k])); }
    $("pm-line").textContent = line();
  }
  function spin() {
    if (reduceMotion) { for (const k of keys) if (!lock[k]) cur[k] = pick(R[k]); paint(); return; }
    let n = 0; click(0, .25);
    const t = setInterval(() => { for (const k of keys) if (!lock[k]) cur[k] = pick(R[k]); paint(true); if (++n > 9) { clearInterval(t); paint(false); } }, 60);
  }
  function init() {
    for (const k of keys) cur[k] = pick(R[k]);
    $("pm-spin").addEventListener("click", spin);
    $("pm-reels").addEventListener("click", e => { const b = e.target.closest("[data-lock]"); if (!b) return; const k = b.dataset.lock; lock[k] = !lock[k]; paint(); });
    $("pm-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(line()); toast("Copied. Drop a PLA bell and go."); } catch (e) { toast(line()); } });
    paint();
  }
  return { init };
})();
