'use strict';

const { SlashCommandBuilder, version: djsVersion, MessageFlags } = require('discord.js');
const { embed, infoEmbed, COLORS } = require('../lib/helpers');

const data = [
  new SlashCommandBuilder().setName('help').setDescription('Show everything this bot can do'),
  new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is alive'),
];

async function execute(interaction, { client }) {
  if (interaction.commandName === 'ping') {
    const response = await interaction.reply({ content: 'Pinging…', withResponse: true });
    const sent = response.resource?.message;
    const roundtrip = sent ? sent.createdTimestamp - interaction.createdTimestamp : 0;
    await interaction.editReply({
      embeds: [
        infoEmbed(
          'Pong!',
          `**Roundtrip:** ${roundtrip}ms\n**WebSocket:** ${Math.round(client.ws.ping)}ms`,
        ),
      ],
    });
    return;
  }

  const help = embed({
    title: 'Server bot commands',
    description: 'Tickets, applications, giveaways, activity checks, LOA, suggestions, automod, promotions and strikes. Staff commands require the configured staff role or **Manage Server**.',
    color: COLORS.brand,
    fields: [
      {
        name: '🎫 Tickets',
        value: [
          '`/ticket panel` — post the open-a-ticket button',
          '`/ticket claim` — claim the current ticket',
          '`/ticket add @user` — let someone else see the ticket',
          '`/ticket remove @user` — remove their access',
          '`/ticket close [reason]` — close and save a transcript',
        ].join('\n'),
      },
      {
        name: '📝 Applications',
        value: [
          '`/application panel` — post the Apply button',
          '`/application questions add question:<text>` — add a question',
          '`/application questions remove number:<n>` — remove a question',
          '`/application questions list` — show all questions',
          '`/application toggle open:true|false` — open or close applications',
          'Applicants answer in DMs within 60 minutes and can type `cancel`',
          'Denied applicants wait 2 weeks before applying again',
          'Staff can click **Open ticket** on a review to talk with the applicant',
          'Review channel and accept role: `/config set`',
        ].join('\n'),
      },
      {
        name: '🎁 Giveaways',
        value: [
          '`/giveaway create prize:<text> duration:<1d> claimtime:<24h>` — start a giveaway',
          'Members click **Enter Giveaway** to join',
          'At the end the winner gets a **Claim Prize** button',
          'Claiming opens a private ticket with the winner and the host',
          'The claim button greys out when the claim time runs out',
        ].join('\n'),
      },
      {
        name: '✅ Activity checks (admin only)',
        value: [
          '**Manage Server required for every `/activity` command.**',
          '`/activity start duration:48h [channel]` — post a check now',
          '`/activity end` — end the running check early',
          '`/activity status` — current check and schedule',
          '`/activity auto enabled:true interval:7d duration:48h channel:#staff` — schedule checks',
          'When a check closes, the high staff role is pinged with everyone who missed it',
          'Requires **Server Members Intent** in the Developer Portal',
        ].join('\n'),
      },
      {
        name: '🌴 Leave of absence',
        value: [
          '`!loasetup` — post the Request LOA panel (staff only)',
          'Members click **Request LOA** and give a duration and reason',
          'Requests are sent to the LOA request channel for review',
          'Accepting gives the LOA role and skips activity checks',
        ].join('\n'),
      },
      {
        name: '🎟️ Vouches',
        value: [
          'Post `:vouch @user` in a vouch channel',
          'Each vouch is counted once and their nickname becomes `Name (count)`',
          'A pinned panel always stays at the bottom of the vouch channel',
          '`/vouch leaderboard` — most vouched members',
          '`!vouchadd @user 5` — add vouches manually (owner and co-owner only)',
          '`!vouchresync` — re-apply every count to nicknames (admin)',
          '`!vouchsetup` — post the pinned vouch panel (admin)',
        ].join('\n'),
      },
      {
        name: '📈 Levels',
        value: [
          '`/level rank [user]` — level, rank, XP and progress',
          '`/level top` — every member’s XP, ten per page',
          '`/scoreboard [type]` — switch between Levels, Messages and Voice time',
          '`/rank [user]` — one card with someone’s level, messages and voice points',
          'Use ◀️ Back and ▶️ Next under a leaderboard to see everyone',
          '🔊 Voice earns 1 point per 15 minutes, and only while 3+ people are in the channel',
          '`/level settings` — XP per message, cooldown, announce channel (owner and co-owner only)',
          '`/level setxp user:@member xp:<n>` — set total XP (owner and co-owner only)',
        ].join('\n'),
      },
      {
        name: '💡 Suggestions',
        value: [
          '`/suggestion suggestion:<text>` — post a suggestion',
          'Suggestions are sent to the suggestion channel',
          'Staff vote with ✅ Approve and ❌ Reject buttons',
          'Staff can change or remove their vote',
        ].join('\n'),
      },
      {
        name: '🦴 Spawner prices',
        value: [
          '`/setspawnerprice spawner:<type> type:<Buying|Selling> price:<13.5>` — spawner perms role only',
          'Decimals are allowed, up to 2 places — `13`, `12.5`, `0.75`',
          'Types: Skeleton, Creeper, Iron Golem, Zombified Piglin, Pig, Cow',
          'The board in <#1528595505255288893> updates itself after every change',
          'Spawners without a price are simply not shown',
          '`!spawnerprices` — post or refresh the board in the current channel',
          '**Buy Spawners** and **Sell Spawners** open a ticket',
        ].join('\n'),
      },
      {
        name: '🎥 Videos & streams',
        value: [
          '`/upload video link:<url>` — announces a new video in <#1527963264477302845> and pings the Nemo role',
          '`/golive title:<text> [link]` — pings the server in <#1527962279704789072> with your stream title',
          'Streams are only announced when someone runs `/golive` — nothing is posted automatically',
          'Owner, the Nemo role and **Manage Server** can post these',
        ].join('\n'),
      },
      {
        name: '🛡️ AutoMod',
        value: [
          'Blocks server invites, scam and phishing links',
          'Blocks unapproved links and advertising from members',
          'Stops spam floods, repeated messages and mass mentions',
          'Deletes dangerous files and times out the offender',
          'Admins bypass it; staff can post links',
        ].join('\n'),
      },
      {
        name: '⏳ Timeouts',
        value: [
          '`!to @user 10m [reason]` — time a member out',
          'Times accept `10m`, `1h`, `2d` or `1w` (max 28 days)',
          'Requires **Timeout Members**; the action is posted in the moderation log',
        ].join('\n'),
      },
      {
        name: '🧹 Purge',
        value: [
          '`!purge 25` — delete the last 25 messages',
          'Staff can remove up to **50** per command',
          'Owner and co-owner can purge up to **1000**',
          'Messages older than 14 days are removed one by one, so they take a little longer',
        ].join('\n'),
      },
      {
        name: '📈 Promotions & demotions (admin only)',
        value: [
          '**Manage Server required for `/promote` and `/demote`.**',
          '`/promote user:@user role:@role [reason]` — give that role',
          '`/demote user:@user role:@role [current_role:@role] [reason]` — move them down to that role',
          '`/demote` auto-detects the higher role to remove; set `current_role` if it picks wrong',
          'Pick roles in the role options; selecting them never sends a notification',
          'The result embed is posted in <#1528259332876275742>',
        ].join('\n'),
      },
      {
        name: '🛡️ Kick protection (admin only)',
        value: [
          '**Manage Server required for `/protect`.**',
          '`/protect add user:@member` — only admins can kick that member',
          '`/protect remove user:@member` — remove their protection',
          '`/protect list` — show every protected member',
          '`/kick user:@member [reason]` — staff kick that respects protection',
        ].join('\n'),
      },
      {
        name: '⚠️ Strikes',
        value: [
          '`!strike list @user` — see active and voided strikes (staff)',
          '`!strike @user reason` — issue a strike (admin only)',
          '`!strikeremove @user reason` — void their latest active strike (admin only)',
          '`!strike remove @user S-0001 [reason]` — void a specific strike (admin only)',
          'The strike card is posted in <#1528258786165260358>, never in the channel you typed in',
        ].join('\n'),
      },
      {
        name: '⚙️ Setup',
        value: [
          '`!honeypot` — turn the current channel into a kick-on-message honeypot (admin only)',
          'Moderators and above are immune — their message is removed and they are told privately',
          '`!honeypot off` — disable the honeypot',
          '`!staffguide` — post the full staff command guide (staff only)',
          '`/config view` — show current settings',
          '`/config set` — staff role, log channel, ticket category, transcript channel, LOA role',
          '`/config set log_channel_link:<channel link>` — every channel setting has a `_link` twin you can paste into',
          'Application review channel and accept role also live in `/config set`',
          '`!stafffont [@role]` — rename the staff roles into small caps (admin only)',
          '`!stafffont readable` — keeps `ꜱᴛᴀꜰꜰ (Staff)` so typing `@staff` still works',
          '`!staffname` — rebuild every staff name now; role changes do this automatically (admin only)',
          '`!pingrole staff` / `!pr staff` — ping a fancy-named role with normal letters (staff)',
          '`!roleicons` — preview and apply a staff role icon per rank (admin only)',
          '',
          `-# discord.js ${djsVersion}`,
        ].join('\n'),
      },
    ],
  });

  await interaction.reply({ embeds: [help], flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
