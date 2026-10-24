# The Callective website: how to put it on Cloudflare

Everything runs as one Cloudflare Worker: the site files in `public/` plus a few
live features in `worker/index.js`.

## What's in the folder

| Path | What it is |
|---|---|
| `public/` | The website: page, styles, scripts, art, songs, switchboard clips, episode data |
| `worker/index.js` | The live parts: on-air status, the live show, Callective Radio, chat replay, the queue, clips |
| `wrangler.toml` | Cloudflare settings |
| `callbot_patch.py` | Lets CallBot send the live queue to the site |
| `src/page.html` + `build.py` | Source for `public/index.html`. Edit `page.html`, then run `python build.py` |

## One-time setup

You need Node.js installed (the same one you used for the Zoo Crew site works).

1. Open a terminal in this folder:
   ```
   cd "G:\Art\Prankcast Art\The Callective\Callective Website"
   ```
2. Log in to Cloudflare (a browser window opens):
   ```
   npx wrangler login
   ```
3. Make the storage for the clip board records:
   ```
   npx wrangler kv namespace create DB
   ```
   It prints an `id`. Open `wrangler.toml` and paste that id over `PASTE_THE_KV_ID_HERE`.
4. Make the storage for clip audio:
   ```
   npx wrangler r2 bucket create callective-clips
   ```
   (If Cloudflare asks you to turn on R2 first, do it in the dashboard under **R2**. The free tier covers this easily.)
5. Make up two long random passwords and save them as secrets:
   ```
   npx wrangler secret put QUEUE_TOKEN
   npx wrangler secret put ADMIN_TOKEN
   ```
   `QUEUE_TOKEN` is for CallBot. `ADMIN_TOKEN` is the **crew password** for approving clips (dial M-O-D on the site, or click "Crew login" in the footer).
6. Optional: get new clips posted to a Discord channel so the crew can hear them. In Discord, go to the channel's settings → **Integrations** → **Webhooks** → **New Webhook**, copy the URL, then:
   ```
   npx wrangler secret put DISCORD_WEBHOOK
   ```
7. Put the site up:
   ```
   npx wrangler deploy
   ```
   It prints the address, something like `https://callective.<your-name>.workers.dev`.
   The first deploy also sets up the **Room** (a Cloudflare Durable Object that holds the live queue).
   There's nothing to create for it by hand, and the free plan covers it.

## Use your own domain (optional)

Cloudflare dashboard → **Workers & Pages** → **callective** → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.

## Updating the site later

Change files in `public/` (or `src/page.html`, then `python build.py`), then run:
```
npx wrangler deploy
```

## Hook up CallBot (live queue on "The line")

Open `callbot_patch.py` and follow the three steps at the top. In short:

1. Add `CALLECTIVE_SITE` and `CALLECTIVE_QUEUE_TOKEN` to CallBot's `.env`.
2. Paste the code block into `queue_bot.py`.
3. Add one line where CallBot writes `queue.txt`.

While a show is on, the site's queue board flips from "Practice line" to "Live from the Discord" and updates every 10 seconds.
It goes back to the practice line 15 minutes after the last update.

## Listen: Callective Radio and the live show

- **Callective Radio** plays every archived episode on a shuffled loop, around the clock.
  - The order comes from the clock, so everyone hears the same moment.
  - New Prankcast episodes join the loop on their own.
- **When TheCallective goes live on Prankcast**, the site notices within about 30 seconds.
  - Anyone listening to the radio is switched to the live show automatically, with video if the stream has it.
  - When the show ends, the radio picks back up.

## Clips

Anything playing on the site can be clipped: the radio, the live show, archive episodes, songs, clip board clips and patch bay drops.
Hit **Clip it** in the bar at the bottom, or press **C**.

- **Radio and archive episodes:** the Worker cuts the piece out of the episode's MP3.
- **The live show:** the browser keeps the last minute of what it has played and clips from that.
- **Songs and drops:** the clip comes from the file itself.

The clip opens in the **clip lab**. From there people can trim it, add effects, then:
- **Download MP3** (or WAV).
- **Post to the clip board.** It waits for the crew, then goes public.
- **Send to the crew only.** It's private. There's an optional note for the crew.

To review clips, dial **M-O-D** (or click **Crew login**) and enter the crew password. The inbox shows both kinds:
- **Board posts:** approve or reject.
- **Crew-only clips:** download, delete, or put on the board.

Rejected and deleted clips are removed from the site's own storage. Nothing on Prankcast is ever touched. Each person can send 6 clips an hour.

## What the live features use

- **On-air lamp and countdown:** reads TheCallective's Prankcast profile (checked at most once a minute).
- **The live show:** TheCallective's Prankcast live stream (the same HLS stream Prankcast's own player uses).
  If a browser can't read the stream directly, the Worker relays it. It only relays the current live stream, nothing else.
- **Radio and replay audio:** each episode's public MP3 from Prankcast. The replay terminal's chat comes from Prankcast's chat replay.
  If Prankcast is down, the booth falls back to the chat saved in `public/data/chat/`.
- **New episodes:** the newest Prankcast posts are added to the directory and the replay list automatically.

Nothing here ever posts to or deletes anything on Prankcast. The only writes are these:
- CallBot sending the queue.
- Listeners sending clips to the site's own storage.
- The crew approving or removing those clips.
- If you set it up, the Discord webhook heads-up for new clips.
