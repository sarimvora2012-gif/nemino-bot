# Hosting Nemino Bot on Wispbyte

**Upload file: `nemino-bot.zip` (145 KB).** One zip for every panel — Wispbyte, fps.ms,
bot-hosting.net, daki.cc, pella. It contains the bot code, the `data/` folder with your
current settings, and **no** `node_modules`; the panel installs dependencies itself.

Wispbyte free plan: **512 MB RAM**, no card, no ads. The catch is you must **log in every
two weeks** or the server pauses (files stay safe for 28 days). 512 MB is twice what this
bot needs, which is why it should stop the random crashes you had elsewhere.

## 1. Create the server

1. Go to **wispbyte.com/client** and sign up (Discord login is fastest).
2. **Create Server**, name it `Nemino Bot`.
3. When it asks for a **Docker image / runtime**, choose **Node.js**. That's the only one
   that runs this bot.
4. Pick any server location; the closest to your members is fine.
5. Wait until the server shows as created, then open it — you get a panel with tabs:
   **Console**, **Files**, **Startup**, **Settings**.

## 2. Upload the bot

The free plan uses the panel's file manager (SFTP is premium only), so this is the way in:

1. Open your server → **Files** tab.
2. Click **Upload** (or drag the file into the file list) and pick `nemino-bot.zip`.
3. Once it appears in the list, right-click it (or use the `...` menu) → **Unarchive** /
   **Extract**.
4. Delete `nemino-bot.zip` afterwards — it's not needed on the server.

The folder root must end up looking like this (not inside another folder):

```text
index.js
package.json
package-lock.json
src/
scripts/
data/
.env.example
HOSTING.md
README.md
```

If everything landed inside a `nemino-bot/` folder, open it, select all, and move the
contents up to the root — the bot cannot start from a subfolder.

## 3. Add your token

You can do this either way; environment variables are the safer one because a `.env` file
is easy to misname.

**Option A — panel variables (recommended)**

**Startup** tab → **Environment Variables** → add these four names:

| Variable | Value |
| --- | --- |
| `DISCORD_TOKEN` | your bot token (Developer Portal → Bot → Reset Token) |
| `CLIENT_ID` | your application ID (Developer Portal → General Information) |
| `GUILD_ID` | your server ID |
| `EMBED_COLOR` | `#5865F2` |

**Option B — `.env` file**

**Files** → **New file** → name it exactly `.env` (with the dot, no `.txt`) in the root,
then paste the same four lines:

```env
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-id
GUILD_ID=your-server-id
EMBED_COLOR=#5865F2
```

No spaces around the `=` signs. The bot reads whichever of the two it finds.

## 4. Server Configuration (the tiled settings page)

The panel calls it **Server Configuration** or **Startup**. It's a grid of boxes; almost
all of them stay empty because you are uploading files instead of using GitHub.

> This section is the **zip upload** path. If you connected a GitHub repo instead, stop —
> use the GitHub Integration page described in "Updating the bot later" at the end of this
> guide, and keep **User Uploaded Files** at `0`.

| Box | Set it to |
| --- | --- |
| Git Repo Address | **empty** |
| Install Branch | **empty** |
| Git Username / Git Access Token | **empty** |
| Auto Update | `0` |
| **User Uploaded Files** | **`1`** ← the important one |
| **JS file** (main file) | `index.js` |
| Uninstall Node packages | **empty** |

**User Uploaded Files must be `1`.** On `0` the installer goes looking for a GitHub repo,
finds none, and the server fails to install. On `1` it skips that step and runs whatever
you uploaded.

**JS file `index.js` is correct as-is** — the root `index.js` forwards to `src/index.js`, so
the panel never needs to point at a file inside `src/`.

After changing anything, click the **Save** button in that box.

There is no separate field for dependencies: the panel runs `npm install` from your
`package.json` on every start, which installs `discord.js` and `dotenv` automatically.

## 5. Start it

**Console** tab → **Start**. The first start takes a couple of minutes while dependencies
install. You want to see:

```text
✅ Logged in as Nemino Bot#0104
   Serving 2 server(s) · 16 commands loaded
```

That means it's live. Then **stop the copy running on your PC** — two copies means
duplicated tickets, panels and pings, and they'll fight over the same `data/data.json`.

## 6. Slash commands

Already registered for your server — nothing to do. Run this in the Console only if you
change command options later or move to a different server:

```bash
npm run deploy
```

## Updating the bot later

`nemino-bot.zip` is rebuilt from this folder without `data/`, `.env` or `node_modules`, so
re-uploading it only replaces the code — your live strikes, vouches, prices, tickets and
counters keep running on whatever the hosted bot has saved.

1. Files → **Upload** the new `nemino-bot.zip` → right-click → **Unarchive** → **Overwrite all**.
2. Delete the zip.
3. Console → **Restart**.

If the update adds or changes slash commands, run `npm run deploy` in the console once.

**Want it automatic?** Wispbyte can pull the code itself instead of you uploading zips.
This folder is already a git repo with a first commit, and `.env`, `data/`, `node_modules/`,
`*.zip` and `wispbyte.env` are ignored, so no secret can be pushed by accident.

1. Create an empty repo on GitHub (no README, no `.gitignore`).
2. Push once from this folder:

```bash
git remote add origin https://github.com/YOUR-USERNAME/nemino-bot.git
git branch -M main
git push -u origin main
```

3. In the panel: server sidebar → **General** → **GitHub Integration**. Set
   **Git Repo Address** = `https://github.com/YOUR-USERNAME/nemino-bot.git`,
   **Install Branch** = `main`, **Auto Update** = `1`, **User Uploaded Files** = `0`, save each
   tile, then press **Clone** at the top of the page (first time only). Later updates use
   **Pull**. There is no "Reinstall Server" button in this panel.

> If that page says **GitHub Unavailable**, the server's egg does not support Git. Create the
> server with a GitHub-compatible Node.js egg, or stay on the zip upload method below.

> **Clone or Pull can overwrite files on the server.** Download `data/data.json` first, and
> keep `DISCORD_TOKEN` and friends in Startup → Environment Variables rather than a `.env`.

For a **private** repo, paste a GitHub token with `repo` scope into the panel's **Git Access
Token** box. The token still comes from the `.env` you uploaded or the Startup variables.

To ship a change after that: commit and push here, then restart the server. No zip, no
re-upload:

```bash
git add -A && git commit -m "change" && git push
```

## Keeping your data

`data/data.json` holds strikes, vouches, levels, ticket counters, spawner prices, panel IDs
and activity-check history.

- Never delete `data/` when redeploying — download it first if you're replacing everything.
- To take a backup: Files → right-click `data/data.json` → **Download**.

## Staying online

Free Wispbyte servers need a **login every 2 weeks** to keep running; there's no daily ad
to watch. If the server pauses, open the panel and resume it — nothing is lost.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `DISCORD_TOKEN is missing` | No env file next to `package.json`. `.env`, `wispbyte.env` and `env` are all accepted, so `wispbyte.env` can be uploaded without renaming. Clone never brings it — `.env` is gitignored on purpose so the token cannot leak into GitHub. |
| `An invalid token was provided` | Token copied wrong or reset. Copy it again from the Developer Portal → Bot. |
| `Used disallowed intents` | Developer Portal → Bot → enable **Message Content** and **Server Members** intents. |
| `Cannot find module 'discord.js'` | `package.json` is missing from the root, so `npm install` had nothing to install. Re-upload it and restart. |
| `Cannot find module './src/index.js'` or similar | Files are inside a subfolder, or the zip was extracted with broken paths. Re-upload `nemino-bot.zip` and Unarchive it again. |
| Bot online, commands missing | Console: `npm run deploy`, then Ctrl+R in Discord. |
| Activity checks / member counts fail | **Server Members** intent is off, or the bot's role sits below the staff role in the role list. |
| Nothing posts in a channel | Give the bot **View Channel**, **Send Messages**, **Embed Links** in that channel. |
| Server restarts by itself | RAM or CPU cap. 512 MB should be plenty; if the console says `heap out of memory`, contact Wispbyte support. |
| **Clone** says `Could not check files` | The panel could not read the server's file list before cloning. Check the **Files** tab: if it also fails to load, the server is not installed / is paused (free plan needs a login every 2 weeks) — resume it, then clone. If Files loads fine, it is the repo: a **private** repo with an empty **Git Access Token** box looks identical to a missing repo (both answer 404), so paste the username + read-only token, or make the repo public. |
| Clone still refuses after that | The panel only clones into a server it can scan. Upload `nemino-bot.zip` through **Files → Upload** instead — same code, no Git needed. |

## What runs automatically

- YouTube live tracker (`@RealNemino`) every 3 minutes
- Auto activity checks, if enabled with `/activity auto`
- Giveaway timers and claim-button expiry
- Vouch counter upkeep
- Member-count voice channel name updates

## Other panels (fps.ms, bot-hosting.net, daki.cc, pella)

The same `nemino-bot.zip` works anywhere Node 18+ is available: create a Discord Bot /
Node.js server, upload the zip, extract it in the file list, add the four variables, start.

**Do not upload `nemino-bot-ready.zip`** — that's an older build that includes
`node_modules` and predates the recent fixes.

### How much RAM this bot actually needs

Measured: loading discord.js alone uses **75 MB**, and your 747-member server adds the
member cache on top, so a running copy sits around **90–120 MB**.

| Plan | Verdict |
| --- | --- |
| 128 MB (fps.ms free, Discloud free) | Borderline — this is what makes free tiers crash or get OOM-killed |
| 256 MB (bot-hosting.net free, fps.ms €0.99/mo) | Comfortable |
| **512 MB (Wispbyte free, daki.cc free)** | Roomy, leaves headroom for activity checks |

Renewal rules differ and matter more than the brand: fps.ms daily, bot-hosting.net every
4 days, pella about daily, **Wispbyte only a login every two weeks**.
