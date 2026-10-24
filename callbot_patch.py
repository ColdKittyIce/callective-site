# ---------------------------------------------------------------------------
# CallBot -> Callective website: push the queue to the site's "The line" board.
#
# 1) Add these two lines to CallBot's .env (next to DISCORD_BOT_TOKEN):
#      CALLECTIVE_SITE=https://YOUR-SITE-ADDRESS
#      CALLECTIVE_QUEUE_TOKEN=the-same-secret-you-gave-wrangler
#
# 2) Paste this code near the top of queue_bot.py, after the imports.
#    (aiohttp is already installed, discord.py depends on it.)
#
# 3) Find the function in queue_bot.py that writes queue.txt for OBS.
#    At the end of that function, add ONE line:
#
#      bot.loop.create_task(push_queue_to_site(<the list of names>, <True if the queue is locked>))
#
#    The names are whatever ends up in queue.txt, in order. ALL CALL entries
#    are detected automatically if their text starts with "ALL CALL".
#
# If you'd rather not do any of this by hand, send queue_bot.py over and it can be wired in for you.
# ---------------------------------------------------------------------------
import os
import aiohttp

CALLECTIVE_SITE = os.getenv("CALLECTIVE_SITE", "").rstrip("/")
CALLECTIVE_QUEUE_TOKEN = os.getenv("CALLECTIVE_QUEUE_TOKEN", "")


async def _post_to_site(path, payload):
    if not (CALLECTIVE_SITE and CALLECTIVE_QUEUE_TOKEN):
        return
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{CALLECTIVE_SITE}{path}",
                json=payload,
                headers={"Authorization": f"Bearer {CALLECTIVE_QUEUE_TOKEN}"},
            ) as resp:
                if resp.status != 200:
                    print(f"[site] {path} got HTTP {resp.status}")
    except Exception as e:  # the show goes on even if the site doesn't answer
        print(f"[site] {path} failed: {e}")


async def push_queue_to_site(names, locked=False):
    """Send the current queue to the website. Never breaks the bot if the site is down."""
    await _post_to_site("/api/queue", {
        "locked": bool(locked),
        "items": [{"name": str(n), "allcall": str(n).upper().startswith("ALL CALL")} for n in names],
    })
