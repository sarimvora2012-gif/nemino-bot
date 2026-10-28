'use strict';

const { embed, errorEmbed, isStaff, COLORS } = require('./helpers');

const PREFIX = '!staffguide';
const STAFF_RULES_CHANNEL_ID = '1528260370106417292';
const STAFF_WORKFLOW_CHANNEL_ID = '1563549593755586610';
const STAFF_CHAT_CHANNEL_ID = '1528236359708573827';
const LOA_REQUEST_CHANNEL_ID = '1563541405706485850';
const SUGGESTION_CHANNEL_ID = '1556519770998964275';

function guideEmbed(settings) {
  const reviewChannel = settings.applications?.reviewChannelId
    ? `<#${settings.applications.reviewChannelId}>`
    : 'the application review channel';
  const rulesUrl = `https://discord.com/channels/${settings.guildId ?? '@me'}/${STAFF_RULES_CHANNEL_ID}`;

  return embed({
    title: '🧑‍💼 Staff guide — everything you need',
    description: [
      `Welcome to the team! Start with the [staff rules](${rulesUrl}) and the [staff workflow](https://discord.com/channels/${settings.guildId ?? '@me'}/${STAFF_WORKFLOW_CHANNEL_ID}).`,
      '',
      'Use this guide as your command cheat sheet. Run `!staffguide` anytime to bring it back.',
      '',
      '> Setup and admin commands are not listed here. Ask an admin if you need one.',
    ].join('\n'),
    color: COLORS.brand,
    fields: [
      {
        name: '🎫 Tickets',
        value: [
          '`/ticket claim` — Claim a ticket when you are ready to handle it. Do not claim several at once.',
          '`/ticket add @user` — Bring in another member who can help.',
          '`/ticket remove @user` — Remove someone who no longer needs access.',
          '`/ticket close reason:<text>` — Close after the issue is solved. A transcript is saved automatically.',
          '**When:** claim first, reply clearly, and close only when the issue is resolved or the owner asks.',
        ].join('\n'),
      },
      {
        name: '📝 Applications',
        value: [
          `Review applications in ${reviewChannel}.`,
          '✅ **Accept** — only when the applicant meets the requirements.',
          '❌ **Deny** — always give a clear reason. The applicant gets a 2-week cooldown.',
          '🎫 **Open ticket** — use this to ask the applicant something privately.',
          '**When:** read every answer, check their history, and never discuss an applicant in public. Ask another staff member before accepting or denying a friend.',
        ].join('\n'),
      },
      {
        name: '🎁 Giveaways',
        value: [
          '`/giveaway create prize:<text> duration:<1d> claimtime:<24h>` — Host a giveaway.',
          '**When:** only after approval, in the correct giveaway channel. Do not end early or choose a winner manually. The bot draws the winner and opens the claim ticket.',
        ].join('\n'),
      },
      {
        name: '⚠️ Strikes',
        value: [
          '`!strike list @user` — Check active and voided strikes first.',
          'Only admins can add or remove strikes. Ask an admin if a strike is needed.',
          '**When:** use it to understand a member’s history, keep reasons factual, and never argue about strikes in public. The card lands in <#1528258786165260358>, not in the channel you typed in.',
        ].join('\n'),
      },
      {
        name: '🌴 Leave of absence',
        value: [
          `Review LOA requests in <#${LOA_REQUEST_CHANNEL_ID}>.`,
          '✅ **Accept** — gives the member the LOA role and skips activity checks.',
          '❌ **Deny** — explain why; the member is DMed the reason.',
          '**When:** check the dates and reason. Accept valid requests and never approve your own request.',
        ].join('\n'),
      },
      {
        name: '💡 Suggestions',
        value: [
          '`/suggestion suggestion:<text>` — Submit your own idea.',
          `✅ **Approve** / ❌ **Reject** — Vote on suggestions in <#${SUGGESTION_CHANNEL_ID}> with the buttons.`,
          '**When:** vote based on what is best for the server, not who posted it. You can change your vote.',
        ].join('\n'),
      },
      {
        name: '🧭 General',
        value: [
          '`/help` — Show every command.',
          '`/ping` — Check whether the bot is online.',
          `Ask in <#${STAFF_CHAT_CHANNEL_ID}> if you are unsure about anything.`,
        ].join('\n'),
      },
      {
        name: '📌 Golden rules',
        value: [
          '1. Read the staff rules before acting.',
          '2. Ask before a major action: bans, mass deletions or rank changes.',
          '3. Never share ticket or application contents.',
          '4. Log a clear reason for every action.',
          '5. Be respectful in public and staff channels.',
        ].join('\n'),
      },
    ],
  });
}

async function handleMessage(message, { store }) {
  if (!message.guild || message.author?.bot) return;
  if (message.content.trim().toLowerCase() !== PREFIX) return;

  const settings = store.guild(message.guild.id);
  if (!isStaff(message.member, settings)) {
    await message
      .reply({
        embeds: [errorEmbed('Only staff can use the staff guide.', 'Missing permissions')],
      })
      .catch(() => {});
    return;
  }

  try {
    await message.channel.send({
      embeds: [guideEmbed({ ...settings, guildId: message.guild.id })],
    });
  } catch (err) {
    console.error('[staffguide] Failed to post guide:', err);
    await message
      .reply({
        embeds: [errorEmbed('I could not post the staff guide in this channel.')],
      })
      .catch(() => {});
    return;
  }

  await message.delete().catch(() => {});
}

module.exports = {
  PREFIX,
  STAFF_RULES_CHANNEL_ID,
  STAFF_WORKFLOW_CHANNEL_ID,
  guideEmbed,
  handleMessage,
};
