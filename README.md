# Server Bot

A Discord staff bot with **tickets**, **staff applications**, **giveaways**, **activity checks**, **leave of absence requests**, **suggestions**, **automod**, **promotions / demotions**, **strikes** and **kick protection**. Built with [discord.js v14](https://discord.js.org). Slash commands handle almost everything, with `!loasetup`, `!staffguide`, `!to`, `!purge`, `!strike` and the vouch commands as prefix commands. Activity checks use the **Server Members Intent**; automod uses the **Message Content Intent**.

## Features

| System | What it does |
| --- | --- |
| 🎫 Tickets | Button panel, private ticket channels, claim, add/remove members, close with transcript saved to a staff channel |
| 📝 Applications | Custom questions, Apply button, questions answered by DM with a 60-minute limit and `cancel`, staff Accept/Deny with a reason, a 2-week reapply cooldown after denial, optional role on acceptance, and an **Open ticket** button to talk with the applicant |
| 🎁 Giveaways | `/giveaway create`, entry button, automatic winner draw, Claim Prize button, private claim ticket with the host and forwarded winner message |
| 📈 Promotions & demotions | `/promote` and `/demote` take the member and the exact role directly, with hierarchy checks and audit logs; selecting the role never sends a notification, and the member's server name picks up their new rank in small caps |
| 🛡️ Kick protection | `/protect add` marks chosen members so only admins can kick them; `/kick` enforces it and is available to staff with **Kick Members** |
| ⚠️ Strikes | `!strike @user reason` issues a strike, `!strikeremove @user reason` voids their latest one, `!strike list` is open to staff and ID-based removal is admin-only; cards post in the staff strikes channel and the member is DMed |
| ✅ Activity checks | Admin-only reaction checkmark checks with configurable duration, automatic schedules, LOA exemptions and missing-staff reminders |
| 🌴 LOA requests | `!loasetup` panel, request modal, staff accept/deny, notification DMs and automatic LOA role assignment |
| 💡 Suggestions | `/suggestion` posts to the suggestion channel; staff vote with ✅ Approve / ❌ Reject buttons |
| 🦴 Spawner prices | `/setspawnerprice` sets buying and selling prices per spawner kind; one wide board in the spawner prices channel updates itself, with Buy/Sell ticket buttons |
| 🎥 Videos & streams | `/upload video link:<url>` announces a new video and pings the Nemo role; `/golive` pings the server with the stream title; the bot also watches youtube.com/@RealNemino and announces when it goes live |
| 🎟️ Vouches | `:vouch @user` in a vouch channel, `Name (count)` nicknames (behind the staff rank, e.g. `ᴍᴏᴅ Name (count)`), a how-to panel that is reposted so it stays newest, `/vouch leaderboard` and owner-only `!vouchadd` |
| ⏳ Timeouts | `!to @user 10m [reason]` with hierarchy checks, a DM to the member and an entry in the moderation log |
| 🧹 Purge | `!purge 25` bulk-deletes messages — 50 per command for staff, up to 1000 for the owner and co-owner |
| 🛡️ AutoMod | Scam/phishing detection, invite and link blocking, ad filtering, anti-spam, mass-mention protection and dangerous-file blocking |
| 🍯 Honeypot | `!honeypot` turns a channel into a trap: anyone who types there is kicked, DMed a fresh invite and logged. Moderators and above are immune, and the panel counts every kick |
| 👋 Welcome card | A wide Components V2 card in the welcome channel for every new member: avatar, mention, member number and join time |
| 🔢 Member counter | A locked voice channel at the very top of the server, named `Members - <count>`, that updates as members join and leave |
| 🧑‍💼 Staff guide | `!staffguide` posts a categorized command guide for new and existing staff, with rules/workflow links |
| 🎨 Components V2 | All new bot messages use Discord Components V2 containers, sections and text displays; long cards are capped at Discord's 4000-character limit |
| 🏆 Scoreboard | `/scoreboard` switches between levels, messages and voice-time leaderboards; every ranked member, ten per page with back and next buttons |
| ⚙️ Config | Staff role, log channel, ticket category, transcript channel, LOA role, vouch channels and vouch admin role, all per server |

Everything is stored per server in `data/data.json`, so settings, tickets, strikes and applications survive restarts.

## Setup

### 1. Create the application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy the token (you only see it once).
3. **General Information** tab → copy the **Application ID**.
4. **Privileged intents:** enable both **Server Members Intent** (activity checks) and **Message Content Intent** (automod) under **Bot → Privileged Gateway Intents**, then save. This project’s app already has them enabled. Guild Messages, Guild Message Reactions and Direct Messages are non-privileged intents the bot enables itself. Application answers are read in DMs and do not require the guild Message Content intent.

### 2. Invite the bot

Replace `YOUR_CLIENT_ID` and open this URL:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099914669138&scope=bot%20applications.commands
```

The permission number covers: Kick Members (`/kick`), Manage Roles, **Manage Nicknames** (the `Name (count)` vouch names), Manage Channels, View Channels, Send Messages, Manage Messages, Moderate Members (automod timeouts), Embed Links, Attach Files, Read Message History, Add Reactions, Use External Emojis.

If the bot was invited before **Manage Nicknames** was added, you do not need a new invite: open **Server Settings → Roles → the bot's role** and switch **Manage Nicknames** on, then run `!vouchresync`.

### 3. Configure the project

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-id
GUILD_ID=your-server-id   # optional, but makes commands appear instantly
```

To get your server ID: Discord → User Settings → Advanced → Developer Mode on → right-click the server → Copy Server ID.

### 4. Register commands and start

```bash
npm run deploy   # registers the slash commands
npm start        # starts the bot
```

`npm run deploy` again whenever you change command names/options. With `GUILD_ID` set, updates are instant; without it, global commands can take up to an hour.

## In-server setup (as an admin)

Run these once in your server:

```text
/config set staff_role:@Staff log_channel:#bot-logs ticket_category:#Tickets transcript_channel:#ticket-transcripts loa_role:@LOA
```

Every channel setting has a link twin right next to its picker, so you can paste a copied channel link instead of scrolling the menu:

```text
/config set log_channel_link:https://discord.com/channels/123456789012345678/223456789012345678
/config set ticket_category_link:https://discord.com/channels/123456789012345678/323456789012345678
```

| Picker | Paste option |
| --- | --- |
| `log_channel` | `log_channel_link` |
| `ticket_category` | `ticket_category_link` |
| `transcript_channel` | `transcript_channel_link` |
| `application_review_channel` | `application_review_channel_link` |
| `vouch_channel` | `vouch_channel_link` |
| `staff_vouch_channel` | `staff_vouch_channel_link` |

`<#channel>` mentions and plain channel IDs work in the paste options too. The link must point at a channel in this server, a category setting refuses a normal channel (and the other way round), and passing both the picker and its link is refused with a message saying so.

1. **Tickets** — in your #create-a-ticket channel:
   ```text
   /ticket panel
   ```

2. **Applications** — the review channel and accept role are configured through `/config set`:
   ```text
   /config set application_review_channel:#staff-applications application_accept_role:@Trial Staff
   /application questions list
   /application questions add question:Why do you want to join the staff team?
   /application questions remove number:2
   /application panel            # posts the Apply button in the current channel
   /application toggle open:true
   ```
   Review messages have an **Open ticket** button; those tickets are created in the application ticket category (`1563497087411159190`). Keep that category visible to the bot with **Manage Channels**.

3. **Activity checks** — all `/activity` commands require **Manage Server**. You also need a staff role for the roster, an LOA role (the default LOA role is `<@&1539905285789982781>`), and the **Server Members Intent** enabled in the Developer Portal:
   ```text
   /config set staff_role:@Staff loa_role:@LOA
   /activity start duration:48h channel:#staff-chat
   /activity auto enabled:true interval:7d duration:48h channel:#staff-chat
   ```

4. **LOA requests** — run this once in the channel where the request panel should appear:
   ```text
   !loasetup
   ```
   `!loasetup` is a prefix command, not a slash command, and only staff can run it. Members click **Request LOA**, enter a duration and reason, and the request is posted to <#1563541405706485850>. Accepting gives the member <@&1539905285789982781> (or whatever `/config set loa_role:@role` is set to). Keep the bot's role above the LOA role or Discord will reject the assignment.

5. **Suggestions** — no setup is needed. Members use `/suggestion suggestion:<text>` and the embed is posted in <#1556519770998964275>. Staff vote with ✅ Approve / ❌ Reject buttons; votes update live and can be changed.

6. **AutoMod** — active automatically once **Message Content Intent** and **Moderate Members** are enabled. It blocks invites, scam/phishing links, unknown links from members, advertising, message floods, duplicate spam, mass mentions and dangerous attachments, then deletes the message and times out the offender. Admins bypass it; staff can post links without the link filter. Advertising, invites and custom links are allowed in <#1527957956933582969> and <#1527956094964600843> (including their threads).

7. **Staff guide** — run this in the staff channel to post the command guide for new staff:
   ```text
   !staffguide
   ```
   The guide covers tickets, applications, giveaways, strike checks, LOA, suggestions and general staff rules, with links to the staff rules and workflow channels. Admin-only systems — activity checks, promotions/demotions, strike add/remove, moderation and AutoMod — are intentionally left out. The same guide is linked from the application acceptance DM.

8. **Honeypot** — pick a channel your members can see (a compromised account mass-posting everywhere is what gets caught), then run this inside it:
   ```text
   !honeypot
   ```
   The bot needs **View Channel**, **Read Message History**, **Manage Messages** and **Kick Members** there, plus **Create Invite** somewhere public so the rejoin link keeps working. Moderators and above are exempt from the kick — their message is still removed and they are told privately — so staff can keep managing the channel.

9. **Emoji stealing** — no setup needed. Anyone with **Manage Expressions** can copy a custom emoji from any server into yours:
   ```text
   !steal <:cat:123456789012345678>
   ```
   Paste the emoji itself (not an image link) right after the command. The bot downloads it from Discord's CDN, adds it with a free name (a `_2` suffix if the name is taken), and shows a small card for **3 seconds** before removing it along with your command message. Animated emojis stay animated, unless they are over Discord's 256 KB limit, in which case the still frame is added. The bot needs **Manage Expressions**; it explains what is missing when something fails.

10. **Test it** — open a ticket, apply, start a giveaway, request LOA, post a suggestion, promote a test member, add a strike, run an activity check.

> **Role hierarchy matters.** Drag the bot's role above every role it should assign or remove (including the accepted-application and LOA roles), otherwise Discord rejects role changes. The bot explains this when it happens.

> **AutoMod limits:** no filter can guarantee 100% protection. This blocks common scams, invites, ads and spam before they reach the channel, but image-only scams, compromised staff accounts and brand-new attack patterns can still get through. Keep **Message Content Intent** and **Moderate Members** enabled and review the staff log channel.

## Commands

### Tickets
| Command | Who | Description |
| --- | --- | --- |
| `/ticket panel [category] [message]` | Staff | Posts the open-a-ticket button |
| `/ticket claim` | Staff | Claims the ticket |
| `/ticket add @user` / `/ticket remove @user` | Staff | Manage who can see the ticket |
| `/ticket close [reason]` | Staff or ticket owner | Saves a transcript, logs it, DMs the owner, deletes the channel |

Closing from the 🔒 button asks for an optional reason. Transcripts are written to `transcripts/` and uploaded to the transcript channel (or log channel) as a `.txt` file. Each upload is a plain message with a summary block above the file:

```text
📄 Transcript for ticket #0001 — 2 messages
```
```text
Ticket #0001
Opened by: 1061471321801895987
Created: 2026-10-24T10:45:32.445Z
Closed: 2026-10-24T10:59:55.550Z
Channel: #ticket-0001
============================================================
```

The same block is the header of the `.txt` file, so the message and the file match.

### Applications
| Command | Description |
| --- | --- |
| `/application panel [channel]` | Post the Apply button |
| `/application questions add question:<text>` | Add a question (up to 10) |
| `/application questions remove number:<n>` | Remove a question by number |
| `/application questions list` | Show the numbered questions |
| `/application toggle open:<true/false>` | Open/close applications |

The review channel and accept role are set with `/config set application_review_channel:#channel application_accept_role:@role`. Clicking **Apply** replies with “Check dms to continue!” and sends the questions to the applicant in a DM. The applicant has **60 minutes** to answer; typing **cancel** at any point cancels the application. If the applicant has DMs closed, the bot explains how to enable them. Applicants get one pending application at a time. A full `.txt` copy of every answer is attached to the review message, while the embed shows a readable preview.

Staff accept or deny with buttons on the application embed; denial requires a reason, and the applicant is DMed the outcome. A denied applicant has a **2-week cooldown** before they can apply again. Every review message also has an **Open ticket** button that creates a private ticket in the application ticket category (`1563497087411159190`) with the applicant and the staff member who clicked it. The ticket links back to the review message and supports `/ticket close` and transcripts like any other ticket.

### Giveaways
| Command | Description |
| --- | --- |
| `/giveaway create prize:<text> duration:<1d> claimtime:<24h> winners:<2>` | Posts a giveaway in the current channel; `winners` (1-20) draws that many distinct winners, each claiming their own prize ticket |

Members click **Enter Giveaway** to join (one entry per member). When the duration ends, the bot draws a random winner, pings them and adds a **Claim Prize** button. Clicking it opens a private ticket containing the winner, the host, and a forwarded copy of the winner announcement. The ticket is created in the `Giveaway Claim Tickets` category (`1556430315386445965`) and supports `/ticket close` transcripts like any other ticket. When the claim time runs out, the Claim Prize button is disabled (greyed out) and the winner message says the claim window has closed.

### Promotions and demotions (admin only)
`/promote` and `/demote` require **Manage Server**. Pick the exact role directly in the command; there is no separate rank list to maintain.

| Command | Description |
| --- | --- |
| `/promote user:@user role:@role [reason]` | Gives the member that role |
| `/demote user:@user role:@role [current_role:@role] [reason]` | Moves the member down to that role and removes their current higher role |

The role options are Discord role pickers, so selecting them does not send a notification to the role. Both commands check the role hierarchy, refuse to change a member above the bot, and DM the member. The promotion/demotion card is posted in <#1528259332876275742> (`🔀ꜱᴛᴀꜰꜰ-ᴍᴏᴠᴇᴍᴇɴᴛ`) as a Components V2 card: small-caps kicker, large heading, an accent colour (green for promotion, yellow for demotion), the member's avatar and a compact stat block. The member also gets a matching V2 card in DMs. `/demote` removes the member's highest manageable role above the target; use `current_role` if it picks the wrong one. Protection and LOA roles are ignored by the automatic detection.

**Server names carry the rank.** After a promotion or demotion the bot renames the member so their staff rank sits in small caps in front of their normal name — `ᴍᴏᴅ Slash`, or `ᴍᴏᴅ Slash (4)` when they have vouches. The rank is their highest role at or above the configured staff role; bot roles, the LOA tag, the kick-protection tag and integration-managed roles are skipped. A promotion swaps the prefix (`ᴍᴏᴅ` → `ꜱᴇɴɪᴏʀ ᴍᴏᴅ`), and dropping below staff removes it. The prefix and their own name are kept separate, so the rank changes and the name never gets restyled. If Discord refuses the rename, the confirmation tells you why (missing **Manage Nicknames**, bot role too low, or the server owner).

### Kick protection (admin only)
`/protect` requires **Manage Server**. The bot creates a no-permission **🛡️ ᴋɪᴄᴋ ᴘʀᴏᴛᴇᴄᴛᴇᴅ** role and keeps it just below its own highest role, above the staff roles. Non-admin staff cannot kick protected members with `/kick` or through the normal Discord member menu. Admins can still kick them via `/kick`.

| Command | Description |
| --- | --- |
| `/protect add user:@member` | Give a member kick protection |
| `/protect remove user:@member` | Remove a member's kick protection |
| `/protect list` | Show everyone who is protected |
| `/kick user:@member [reason]` | Staff with **Kick Members** can kick; protected members require an admin |

Protection is a role, so it also works outside the bot: the protected role sits above the staff roles, and Discord's role hierarchy stops non-admin staff from kicking its holders. The bot's role must stay above the protection role; `/protect` tells you if it needs moving.

### Strikes
Strikes are a prefix command, not a slash command. Every card is posted in **⚠️ꜱᴛᴀꜰꜰ-ꜱᴛʀɪᴋᴇꜱ** (`1528258786165260358`) — never in the channel the command was typed in. The command message is deleted so the channel stays clean.

| Command | Description |
| --- | --- |
| `!strike @user <reason>` | Admin only — issues a strike (`S-0001`, `S-0002`, …), posts the card in the staff strikes channel and DMs the member |
| `!strike list @user` | Staff — active strikes, severity summary and voided history |
| `!strikeremove @user <reason>` | Admin only — voids their most recent active strike without needing the ID |
| `!strike remove @user S-0001 [reason]` | Admin only — voids a specific strike without deleting the history |

### Activity checks (admin only)
All `/activity` commands require **Manage Server**.

| Command | Description |
| --- | --- |
| `/activity start duration:<e.g. 48h> [channel]` | Posts a check; staff confirm by reacting with ✅ |
| `/activity end` | Ends the running check early and posts the final counts |
| `/activity status` | Live counts, LOA role and automatic schedule |
| `/activity auto enabled:<true/false> [interval] [duration] [channel]` | Schedule recurring checks, e.g. every 7 days for 48 hours |

The card is deliberately wide and short: a heading with the time remaining in hours/days (e.g. “⏳ 23h left”), one instruction line, a single stat line (active staff · reacted · on LOA · time given) and a response-percentage bar. It does not show a raw deadline, who started the check or a not-reacted count. The accent turns green when everyone has replied and red once a check closes with missing staff. Starting a check pings the staff role once (`<@&role>`) instead of every member individually, so LOA staff receive it too and can ignore it; when 25% of the time remains only the members who have **not** reacted are pinged — one `<@user>` mention each, split across messages — with “we are still waiting on you !”, so people who already checked in get no notification and the staff role is never pinged again. Members with the LOA role are skipped entirely; LOA membership is checked when the check starts, so assign the role before running a check. Counts and the time-remaining line update as the check runs: each check-in is applied within about a second of the reaction, because the bot records reactions itself instead of re-reading Discord's reaction list, and the card is edited at most once every two seconds so a burst of check-ins can never hit Discord's edit rate limit. Durations accept `m`, `h`, `d` or `w` (minimum 1 minute; automatic intervals minimum 1 hour and must be longer than the check duration).

When a check closes with staff who never reacted, a **results card** is posted in the same channel: it pings the high-staff role once and lists every member who missed the check. The role comes from `/config set high_staff_role:@role`; if that is unset it uses the AutoMod alert role, and failing that any role whose name reads as “high staff” in any font. Only the role mention notifies — the member mentions are shown in full but silenced, so nobody is pinged twice. Very long lists continue on extra cards, and the role is only pinged on the first one.

### Leave of absence
| Command | Description |
| --- | --- |
| `!loasetup` | Staff only — posts the **Request LOA** panel in the current channel |

Members click **Request LOA**, then enter how long they need and why. The request is posted in <#1563541405706485850> with **Accept** and **Deny** buttons. Accepting assigns the LOA role (default <@&1539905285789982781>), DMs the member and logs the decision; denying asks for a reason and DMs it to the member. Only one pending request per member is allowed. LOA members are automatically skipped by activity checks.

### Suggestions
| Command | Description |
| --- | --- |
| `/suggestion suggestion:<text>` | Posts a suggestion embed in <#1556519770998964275> |

Each suggestion shows the text, the member who submitted it, and live vote counts. Staff click **✅ Approve** or **❌ Reject** to vote. Staff can switch sides or click the same button again to remove their vote. Members cannot vote, but anyone can submit a suggestion.

### Spawner prices
| Command | Who | Description |
| --- | --- | --- |
| `/setspawnerprice spawner:<type> type:Buying\|Selling price:<number>` | Manage Server | Sets one price on the board |
| `!spawnerprices` | Staff | Posts or refreshes the board in the current channel |
| **Buy Spawners** / **Sell Spawners** | Everyone | Opens a spawner ticket in <#1556430475898396862> |

The board lives in <#1528595505255288893> and is a single message that is edited in place, so prices never stack up as new messages. Prices are entered in millions as numbers only, with up to **2 decimals** — `13` is shown as **13M each**, `12.5` as **12.5M each** and `0.75` as **0.75M each**. Spawner rows always appear in this order: Skeleton, Creeper, Iron Golem, Zombified Piglin, Pig, Cow, and a spawner with no price yet is simply not listed (a side with no prices at all says so instead of showing empty rows).

Each row uses the server's custom emoji for that spawner when one exists (names are matched case-insensitively: `skeleton`, `creeper`, `irongolem`, `zombiepiglin`, `pig`, `cow`, and `Spawner_with_fire` for the title) and otherwise falls back to a plain emoji — the current server emojis are already picked up. Add or steal more with `!steal` and the board uses them on its next refresh; no code change needed.

Clicking a button opens a private ticket in the spawner category with the current prices listed for that side, `/ticket close` support and transcripts. The ticket pings the **spawner perms** role once so the people who run spawner deals see it straight away: `/config set spawner_perms_role:@role` picks it explicitly, and if that is unset the bot uses whichever role reads as “spawner perms” in any font. That role is also given access to the ticket channel, otherwise it could be pinged into a room it cannot open. If the server has no such role, the ticket still opens — just without a ping.

### Videos and streams
| Command | Who | Description |
| --- | --- | --- |
| `/upload video link:<url>` | Owner, Nemo role, Manage Server | Announces a new video in <#1527963264477302845> and pings the Nemo role |
| `/golive title:<text> [link]` | Owner, Nemo role, Manage Server | Pings the server in <#1527962279704789072> that Nemino is live |

The video card names `realnemino`, links the video and, for YouTube links, shows the video cover so the card stays wide. The stream card pings `@everyone` and shows the stream title and how long ago the stream started, with a **Watch stream** button when a link is given. Both cards link the YouTube channel and are Components V2 cards with the usual signature.

The role pinged for uploads is the role named `Nemino` (or `Nemo`), or the id in `UPLOAD_PING_ROLE_ID` when that is set in `.env`.

#### Automatic live announcements

The bot watches <https://www.youtube.com/@RealNemino> on its own: every 3 minutes it checks the channel's `/live` page, and the moment the channel is streaming it posts the 🔴 live card in <#1527962279704789072> and pings `@everyone` with the real stream title pulled from YouTube. Each live video is announced once — it will not repeat while the stream is running, and a new stream is announced separately.

Set `YOUTUBE_HANDLE` in `.env` to watch a different channel. Nothing is posted while the channel is offline; the bot logs the state changes (`[streams] @RealNemino is LIVE` / `offline`) so it is easy to see it working. `/golive` still exists as a manual announcement for platforms other than YouTube or when you want a custom title.

### Vouches
| Command | Who | Description |
| --- | --- | --- |
| `:vouch @user` | Everyone | Counts a vouch for the mentioned member |
| `/vouch leaderboard` | Everyone | Top 10 most vouched members |
| `!vouchadd @user 5` | Owner / co-owner | Adds vouches manually |
| `!vouchresync` | Admin | Re-applies every saved count to nicknames (use after fixing permissions) |
| `!vouchsetup` | Admin | Posts or refreshes the vouch panel |

A vouch message is read from any channel whose name contains “vouch” (`✅ᴠᴏᴜᴄʜᴇꜱ` and `🏅ꜱᴛᴀꜰꜰ-ᴠᴏᴜᴄʜᴇꜱ` are detected automatically), or from the channels set with `/config set vouch_channel:#channel staff_vouch_channel:#channel`. The message must start with `:vouch` or `vouch` and mention the member — nothing else is needed.

When a vouch is counted the bot:

1. Adds one vouch and updates the member's nickname to `Name (count)` — or `ᴍᴏᴅ Name (count)` for staff, keeping the rank prefix in front.
2. Posts a small confirmation that deletes itself after 3 seconds.
3. Deletes the previous panel and reposts it, so the how-to-vouch line is always at the bottom of the channel. Nothing is pinned.

The nickname step needs the bot's role to have **Manage Nicknames** and to sit above the member's highest role. When Discord refuses, the 3-second confirmation says why — missing **Manage Nicknames**, a role above the bot's, or the server owner (Discord never lets a bot rename the owner). Counts are always saved even when the rename fails, so fixing the permission and running `!vouchresync` puts every existing count onto the right nickname.

The panel is deliberately one plain message line — `Vouches must be in the format: vouch <@member>` — with no embed around it, so it reads exactly like the format other vouch bots use.

Self-vouches and vouches for bots are refused. `!vouchadd` works for the server owner, anyone whose role name contains “owner” (e.g. Co-Owner), and any role set with `/config set vouch_admin_role:@role`; staff without one of those cannot add vouches. The “owner” name match ignores the font, so restyled roles such as `👑 ᴄᴏ-ᴏᴡɴᴇʀ` still count. Manual additions are logged in the configured log channel.

### Levels and the scoreboard
| Command | Description |
| --- | --- |
| `/level rank [user]` | A member's level, rank, XP and progress bar |
| `/level top` | The XP leaderboard, ten members per page with **◀️ Back** / **▶️ Next** |
| `/scoreboard [type]` | Switch between the **Levels**, **Messages** and **Voice time** boards |

Every leaderboard (`/level top`, `/scoreboard` and `/vouch leaderboard`) uses the server's own **trophy** emoji when one exists, falling back to 🏆 if it is missing.
| `/level settings [enabled] [announce] [announce_channel] [xp_min] [xp_max] [cooldown]` | View or change XP earning (owner and co-owner only) |
| `/level setxp user:@member xp:<n>` | Set a member's total XP — owner and co-owner only |

Every message earns **15–25 XP** (random per message) with a **20-second cooldown**, so chatting normally levels someone while spam cannot. Bots, DMs and non-text channels are ignored. The curve is `5n² + 50n + 100` XP per level — 100 XP to level 1, 155 to level 2, 220 to level 3 — so the first levels come fast and later ones stretch.

Level-ups post a small card in the channel where they happened, or in the channel set with `/level settings announce_channel:#channel`; `announce:false` keeps them silent and the levels still count. XP is saved to `data/data.json` under `levels.users`, written at most once every 5 seconds instead of on every message, so a busy server does not hammer the disk.

### Scoreboard
The scoreboard is one card with three tabs — 📈 **ʟᴇᴠᴇʟꜱ**, 💬 **ᴍᴇꜱꜱᴀɢᴇꜱ** and 🔊 **ᴠᴏɪᴄᴇ** — plus **◀️ Back** and **▶️ Next** underneath. It always lists **every ranked member**, ten per page, so nobody is cut off after the top ten; the arrows grey out on the first and last page and each tab keeps its own page count. The card is ephemeral, so each person pages through their own copy without moving anybody else's — which is also what lets it show **their own place** under the list (`📍 Your rank · #47 · Level 3 · 1,200 XP`) whenever they are on a different page, or “not ranked on this board yet” before they have any activity. The line is hidden when their row is already visible on the page.

| Board | Counts | Saved as |
| --- | --- | --- |
| Levels | XP earned by chatting | `levels.users` |
| Messages | Every message sent, even with XP turned off | `activityStats.users[].messages` |
| Voice time | Seconds spent connected to voice | `activityStats.users[].voiceSeconds` |

Messages are counted per server for members only — bots, DMs and the honeypot are not counted. Voice time is stored as a session start, so hours only cost a write when someone leaves; moving between two channels is one continuous session, and the **AFK channel** and the `Members - <count>` counter channel never count. Sessions are reopened on startup for whoever is already connected (time while the bot itself is offline is not counted), and closing sessions on shutdown keeps the time earned up to that moment.

XP and message counts are separate, so the message board keeps working with `/level settings enabled:false`.

Slash commands register themselves on startup: if the code's command set differs from what Discord has, the bot updates it and logs `[commands] … registered`. `npm run deploy` still works, but is no longer required after an update. Set `GUILD_ID` so the update lands instantly instead of waiting for Discord's global cache.

Levels are counted by this bot only — nothing is read from another bot's database. To bring an old Arcane leaderboard across, set each number with `/level setxp`, which accepts total XP and reports the level it works out to.

### Timeouts
| Command | Description |
| --- | --- |
| `!to @user 10m [reason]` | Times the member out and posts it in the moderation log |

Times accept `10m`, `1h`, `2d` or `1w`; a bare number means minutes. The minimum is 1 minute and the maximum is Discord's 28-day limit. The moderator needs **Timeout Members**, role hierarchy is respected, and the member is DMed with the duration and reason. The log entry includes the member, moderator, duration, end time, channel and reason.

### Purge
| Command | Description |
| --- | --- |
| `!purge <amount>` | Deletes the last `<amount>` messages in the channel |

Requires **Manage Messages**. Staff are capped at **50** messages per command; the owner (Nemino) and co-owner roles are not, up to Discord's own ceiling of **1000** per purge. Messages are fetched newest-first in pages of 100 and deleted in batches of 100, so a purge can span several API calls instead of stopping at Discord's per-request limit. Discord refuses to *bulk*-delete messages older than 14 days, so those are deleted one at a time instead — a purge removes everything it was asked for, however old, and older messages simply take a little longer. The command message itself is removed, and the confirmation disappears after 5 seconds so it does not clutter the channel.

### AutoMod
| Protection | What happens |
| --- | --- |
| Invite links | Message deleted, 24-hour timeout |
| Scam / phishing text | Message deleted, 24-hour timeout |
| Unknown links from members | Message deleted (trusted media sites are allowed), 1-hour timeout |
| Advertising with a link | Message deleted, 1-hour timeout |
| Mass mentions / `@everyone` | Message deleted, 24-hour timeout |
| Message floods (more than 12 messages in 10 s) and repeated messages (more than 5 times in a minute) | Message deleted; a 10-minute timeout only if the member keeps spamming after that |
| Dangerous attachments (`.exe`, `.scr`, `.bat`, `.js`, `.msi`, `.apk`, …) | Message deleted, 24-hour timeout |

Spam handling is deliberately forgiving, because fast chatting or a burst of hype is not disruption: a member has to send more than 12 messages in 10 seconds, or the exact same message more than 5 times in a minute, before anything happens. A first burst only gets the offending messages removed — there is no time out at all. Spamming again in a separate burst within 10 minutes is what turns into a 10-minute timeout, and anyone flagged once drops back to zero after that window. Scams, invites, ads, mentions and dangerous files are handled exactly as before.

Admins bypass AutoMod completely. Staff can post links and mentions, but obvious scam text and dangerous attachments are still blocked. Actions are written to the configured log channel. Trusted domains include YouTube, Twitch, TikTok, Twitter/X, Instagram, Reddit, Spotify, Tenor, Giphy, Klipy, Imgur, Discord CDN, GitHub, Google, Wikipedia, Roblox, Steam and a few gaming sites. All other links from non-staff are removed, so add a domain to `ALLOWED_DOMAINS` in `src/lib/automod.js` if your community needs it.

When the deleted message contained a link AutoMod judged dangerous — an unknown domain, a shortener, an IP address, a lookalike domain, a Steam gift link or an invite — it posts a **Suspicious link** alert in the log channel and pings the alert role. That role is set with `/config set automod_alert_role:@High Staff` and falls back to the staff role if it is not set. The link is shown inside backticks so nobody can open it with a stray click. Floods and repeated messages do not trigger the ping: only links do.

The **market** (<#1527957956933582969>) and **staff market** (<#1527956094964600843>) channels are advertising areas: members may post ads, server invites and any normal link there. Scam phrases, shortened/lookalike/IP links, dangerous attachments, mass mentions, floods and repeated spam are still blocked in those channels.

> No filter can guarantee 100% protection. AutoMod catches common scams, invites, ads and spam, but it cannot inspect image-only scams or stop a compromised staff account. Staff should still review reports and the log channel.

### Honeypot (admin only)
| Command | Description |
| --- | --- |
| `!honeypot` | Turns the current channel into a honeypot and posts the warning panel there |
| `!honeypot https://discord.gg/xxxx` | Same, but uses that invite in the kick DM |
| `!honeypot off` | Disables the honeypot and removes its panel |

Run `!honeypot` inside the channel you want to trap. The panel states **DO NOT TALK IN HERE**: any message from a normal member deletes their message, kicks them and DMs them an invite back — worded for both cases, a slip of the finger and a genuinely compromised account that has to secure itself first. The bot reuses a never-expiring invite or creates one in a public channel, so the link in the DM keeps working.

**Moderators and above are immune.** Immunity is decided by permission (**Moderate Members**, **Kick Members**, **Ban Members**, **Manage Server** or **Administrator**) or by a role name that reads as mod level (`ᴍᴏᴅ`, `ꜱᴇɴɪᴏʀ ᴍᴏᴅ`, `ᴀᴅᴍɪɴ`, `ᴍᴀɴᴀɢᴇʀ`, `ᴄᴏ-ᴏᴡɴᴇʀ`), matched in any font. When one of them types there, their message is deleted and they get a private note explaining they are immune — a DM, or a short-lived channel note if their DMs are closed. Helpers and plain staff are **not** immune.

The panel shows **how many people the honeypot has kicked**, and the count is updated after every successful kick. Every trigger is written to the moderation log with the message, DM status, kick result, the reason a kick was refused (missing **Kick Members**, role too high) and the running total. If the channel is deleted and re-created, the next message in a channel with *honeypot* in its name takes over automatically, so the trap cannot sit there doing nothing on a dead channel id.

### Welcome card and member counter

Both run automatically — there is nothing to type.

- **Welcome card:** when someone joins, the bot posts a single wide card in <#1528229937893609492> that pings them and shows their avatar, mention, tag, member number, join time, account age and user ID, plus links to the rules and general channels. Set `WELCOME_CHANNEL_ID` in `.env` (or `welcomeChannelId` in `data/data.json`) to use a different channel; otherwise the bot falls back to the first `welcome` channel it can find. Bot accounts are skipped.
- **Member counter:** the bot creates a voice channel named `Members - <count>` at the very top of the server on first start. `@everyone` cannot connect to it, so it is read-only. Renames follow joins and leaves (debounced, and spaced 5 minutes apart because Discord only allows 2 renames per 10 minutes per channel), with a 10-minute refresh as a safety net. The name template lives in `memberCountTemplate` (`{count}` is replaced); the channel id is stored as `memberCountChannelId`. Only the server in `GUILD_ID` gets a counter channel.

### Bot status

The profile status (set on login in `src/lib/presence.js`) alternates every 60 seconds between `Watching made by seraphum` and the literal line `watching over <count> members`, where the count is the member total of the server in `GUILD_ID` (re-read on each swap, so it does not go stale).

The credit line is a normal **Watching** activity, so Discord adds the verb for it. The member line is sent as a **custom status** instead, because a watching activity named `watching over …` would display as "Watching watching over …". A custom status prints its text exactly, so the phrase always reads `watching over 747 members`. If a client rejects the custom status the code falls back to a watching activity named `over <count> members`, which Discord renders as `Watching over … members`. One swap a minute stays well inside Discord's presence rate limit.

### Staff guide
| Command | Description |
| --- | --- |
| `!staffguide` | Staff only — posts the categorized staff command guide in the current channel |

### Staff role font
| Command | Description |
| --- | --- |
| `!stafffont` | Renames every role at or above the staff role into small caps (Manage Server) |
| `!stafffont readable` | Same, but keeps the plain name in brackets: `ꜱᴛᴀꜰꜰ (Staff)` |
| `!stafffont @role` | Restyles just that one role |
| `!stafffont readable @role` | One role, with the plain name kept |
| `!pingrole staff` / `!pr staff` | Pings a fancy-named role when you type normal letters (staff) |
| `!roleicons` | Preview and apply staff role icons (Manage Server) |

Role names are converted with the same font as the channels, so `Staff` becomes `ꜱᴛᴀꜰꜰ` and `👑 Co-Owner` becomes `👑 ᴄᴏ-ᴏᴡɴᴇʀ`. Emoji, numbers and punctuation are kept, and roles already in the font are left alone (running it twice changes nothing). @everyone and bot/integration roles are never touched. A role at or above the bot's own role cannot be renamed — the reply names each one and says to move the bot role higher, then run the command again.

### Staff role icons
| Command | Description |
| --- | --- |
| `!roleicons` | Shows what each staff role would get, with **Apply icons** and **Cancel** buttons |

Roles are matched by name — the font, emoji and punctuation are ignored — so `ꜱᴛᴀᴀꜰ`, `Staff Team` and `Staff` all land on the same rung. Most specific first, so `Trial Mod` never falls through to `Mod` and `Co-Owner` never falls through to `Owner`.

| Rung | Icon | Server emoji name it looks for |
| --- | --- | --- |
| Co-Owner | 💎 | `coowner`, `co_owner` |
| Owner | 👑 | `owner`, `crown` |
| Trial | 🌱 | `trial`, `seedling` |
| Senior | 🎯 | `senior`, `target` |
| Head | ⚔️ | `head`, `swords` |
| Admin | 🛡️ | `admin`, `shield` |
| Moderator | 🔰 | `mod`, `moderator` |
| Helper | 🤝 | `helper`, `handshake` |
| Staff | ⭐ | `staff`, `star` |

The set ships with **custom-made PNG art** in `assets/role-icons/` — one 256×256 icon per rung, drawn by `npm run icons` (`scripts/make-role-icons.js`), so there are no third-party assets. Apply order is: the bundled icon, then your own server emoji art, then the plain emoji.

Discord role icons accept a unicode emoji or an uploaded image — a custom emoji cannot be picked as one. That is why the bot uploads a PNG rather than pointing at an emoji: press **Apply icons** and it uploads these files as each role's icon. If you would rather use your own art, upload emoji named `admin`, `mod`, `owner`… and delete the matching PNG, or replace the file with your own artwork at the same size. Icons are only applied after you press **Apply icons** on the preview, and roles at or above the bot's own role are listed instead of being attempted.

**Pinging a restyled role.** Small-caps letters are different Unicode characters, so typing `@staff` will not find `ꜱᴛᴀꜰꜰ` in the mention menu. There are two ways around it:

- `!pingrole staff` (or `!pr staff`) posts the real mention for you. Matching ignores the font, spaces, hyphens and emoji, so `!pr staff`, `!pr co owner` and `!pr ꜱᴛᴀꜰꜰ` all work, and a unique prefix like `!pr mode` is enough. Ambiguous names get a list to pick from. Staff only, and the role is the only thing pinged.
- `!stafffont readable` keeps the fun font and appends the plain name, so `ꜱᴛᴀᴛꜰ (Staff)` still autocompletes when you type `@staff`. Run plain `!stafffont` to drop the brackets again.

The guide covers only what staff need day to day: tickets, applications, giveaways, `!strike list`, LOA review, suggestions, general commands and the golden rules. Admin-only commands and systems — `/config`, application question management, ticket-panel setup, all `/activity` commands, `/promote`, `/demote`, `!strike` issuing and removal, `/protect`, `/kick`, moderation and AutoMod — are excluded. When an application is accepted, the acceptance DM includes quick links to the staff rules and staff workflow channels.

### General
| Command | Description |
| --- | --- |
| `/help` | Command overview |
| `/ping` | Latency check |
| `/config view` / `/config set ...` | View or change server settings (Manage Server only) |
| `/config set <name>_link:<url>` | Set a channel setting by pasting a channel link |
| `/vouch leaderboard` | Top 10 most vouched members |
| `!to @user 10m [reason]` | Timeout a member (Timeout Members) |
| `!purge 25` | Bulk-delete messages (staff cap 50, owner/co-owner 1000) |
| `!vouchadd @user 5` | Add vouches (owner / co-owner) |
| `!vouchresync` | Re-apply vouch counts to nicknames (admin) |
| `!pingrole staff` / `!pr staff` | Ping a fancy-named role using normal letters (staff) |
| `!vouchsetup` | Post the vouch panel (admin) |
| `!stafffont [@role]` | Rename the staff roles into small caps (Manage Server) |

## Project layout

```
src/
  index.js              bot startup, command loading, interaction router
  deploy-commands.js    slash command registration
  store.js              JSON persistence
  lib/helpers.js        embeds, staff checks, hierarchy helpers, logging
  lib/vouch.js          :vouch counting, nickname counts, pinned panel, leaderboard
  lib/staffname.js      staff rank prefix in member nicknames, applied on promotion
  lib/timeout.js        `!to @user <time>` timeout command and moderation log
  lib/purge.js          `!purge <amount>` bulk delete with staff and owner caps
  lib/roles.js          owner / co-owner role check shared by purge and levels
  lib/v2.js             converts embeds/content into Components V2 display components
  lib/protection.js     kick-protection role, admin bypass and kick checks
  lib/activity.js       activity check lifecycle, reactions, reminders, scheduler
  lib/automod.js        scam/ad/link/spam detection and enforcement
  lib/loa.js            `!loasetup` panel, LOA requests, review buttons and role assignment
  lib/staffguide.js     `!staffguide` embed with staff commands and when to use them
  lib/smallcaps.js      small-caps conversion for channel names (including new tickets)
  lib/strike.js         `!strike` prefix command and staff-strikes cards
  lib/honeypot.js       `!honeypot` panel and kick-on-message trap
  lib/welcome.js        new-member welcome card
  lib/membercount.js    locked `Members - <count>` voice channel and its updates
  lib/scoreboard.js     `/scoreboard` boards, message and voice-time tracking
  commands/
    ticket.js           panel, ticket lifecycle, transcripts
    application.js      panel, questions, DM application flow, review buttons
    giveaway.js         giveaway create, entries, winner draw, claim tickets
    activity.js         activity check commands
    suggestion.js       suggestion embeds and staff voting
    staff.js            promote and demote by role
    protect.js          add, remove and list kick-protected members
    kick.js             kick command that enforces kick protection
    config.js           server settings
    general.js          help, ping
scripts/validate.js     offline checks (npm run check)
data/data.json          created at runtime, git-ignored
transcripts/            ticket transcripts, git-ignored
```

## Development

```bash
npm run check   # validates command JSON, handlers and the data store without a token
```

All embeds are created through `embed()` in `src/lib/helpers.js`, which adds the small `made by seraphum` footer signature and **no timestamp** — Discord already shows when a message was sent. Pass `timestamp: true` to the helper for the rare card that records a moment. The cards stay deliberately lean: members are shown by mention instead of `name#tag` plus ID, and stats that repeat another line (a missing count next to the reacted count, a member number in both the subtitle and the body) appear only once. At send time, `src/lib/v2.js` converts those embeds and plain text into Discord **Components V2** containers. The V2 text limit is 4000 characters, so unusually long cards are truncated; application reviews still include the full answer file. Messages posted before the update stay in the classic embed style until they are reposted — rerun panel commands such as `/ticket panel` or `/application panel` to post a V2 version.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Slash commands missing | Run `npm run deploy`; with global commands wait up to an hour, or set `GUILD_ID` |
| "Missing permissions" on staff commands | Give the user the staff role, or **Manage Server** |
| Bot can't change roles | Bot role must be above the role being assigned or removed (Server Settings → Roles) |
| Promotion embed did not post | Check <#1528259332876275742> still exists and the bot can **View Channel** and **Send Messages** there |
| `:vouch @user` does nothing | The channel name must contain “vouch”, or set it with `/config set vouch_channel:#channel`; the message must mention a member |
| Nicknames are not updating | The bot's role needs **Manage Nicknames** and must be above the member's highest role; server owners cannot be renamed. Fix the permission, then run `!vouchresync` |
| A `_link` option says no channel found | The link must belong to this server and the bot must be able to see that channel |
| A `_link` option says “not a channel link” | Copy it with right-click → **Copy Channel Link**; `<#channel>` and bare IDs work too |
| `!stafffont` leaves top roles alone | Those roles sit at or above the bot's own role; drag the bot role above them and run it again |
| `@staff` does not autocomplete | The role is in the small-caps font; use `!pr staff`, or run `!stafffont readable` to keep a plain name in brackets |
| `!pingrole` says several roles match | Use the full role name — matching ignores the font, so `!pr trial mod` works |
| The vouch panel is not at the bottom | It is reposted after every vouch. If the channel goes quiet after a refresh it stays put until the next vouch; run `!vouchsetup` to move it down manually |
| `!to` is refused | You need **Timeout Members**, the member must be below your highest role, and the bot role must be above theirs |
| Old messages still look like classic embeds | Messages sent before the Components V2 update cannot be converted in place; repost the panel or message to get the new V2 layout |
| Protection role is above the bot | Drag the bot's role above **🛡️ ᴋɪᴄᴋ ᴘʀᴏᴛᴇᴄᴛᴇᴅ** in Server Settings → Roles, then run `/protect add` again |
| `/kick` says I need Kick Members | Re-invite the bot with the updated invite link above; **Kick Members** is now included |
| Ticket channel not created | Bot needs **Manage Channels** and access to the ticket category |
| No transcript uploaded | Set `/config set transcript_channel:#channel` (or a log channel) |
| Application button says not set up | Run `/config set application_review_channel:#channel` |
| Applicant says they have to wait | Denied applications have a 2-week cooldown; the bot shows the exact date in the DM and when they click Apply |
| Application ticket not created | Check the application ticket category (`1563497087411159190`) still exists and the bot can **Manage Channels** there |
| Application questions do not appear | The applicant needs to click **Apply** again; the bot lists a new question in DMs after each answer |
| Activity check says no staff | Set `/config set staff_role:@role`; LOA members do not count |
| The bot did not add the ✅ reaction | Grant it **Add Reactions** in the check channel (re-invite with the link above) |
| Activity reminders do not ping | Give the bot **Read Message History** in the check channel and avoid manually deleting the check message |
| `/activity start` says the member list is blocked | Enable **Server Members Intent** in the Developer Portal → Bot → Privileged Gateway Intents, then restart the bot |
| Applicant did not receive the DM | The applicant must allow DMs from server members; the bot tells them when DMs are closed |
| Giveaway claim ticket not created | Check the bot can **Manage Channels** in the Giveaway Claim Tickets category |
| AutoMod does nothing | Enable **Message Content Intent** in the Developer Portal, and give the bot **Manage Messages** and **Moderate Members** |
| AutoMod removed a normal link | Non-staff links must use a trusted domain, or be posted in <#1527957956933582969> / <#1527956094964600843>; add the domain to `ALLOWED_DOMAINS` in `src/lib/automod.js` and restart |
| AutoMod timeout failed | Give the bot **Moderate Members** and drag its role above the member it is moderating |
| `!loasetup` says the LOA channel is missing | Check <#1563541405706485850> still exists and the bot can view and send messages there |
| Accepting LOA did not add the role | Drag the bot's role above the LOA role, or check `/config set loa_role:@role` |
| Suggestion channel missing | Check <#1556519770998964275> still exists and the bot can send messages and embeds there |
| `!staffguide` does nothing | It is a prefix command, not a slash command; type it as a staff member in a channel where the bot can send embeds |
| Acceptance DM has no quick-start links | Make sure the staff rules (`1528260370106417292`) and staff workflow (`1563549593755586610`) channels still exist in the server |
