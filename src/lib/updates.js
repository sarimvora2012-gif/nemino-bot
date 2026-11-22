'use strict';

/**
 * Release notes and the two-step announcement flow.
 *
 * Adding a release means adding one entry to RELEASES: the newest entry at the
 * top is the one the bot announces. On startup the bot drops that note in the
 * review channel, pinging the Co Owner role, and anyone who can see that
 * channel can post it to the update channel or skip it.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { COLORS, errorEmbed, infoEmbed } = require('./helpers');
const { icon } = require('./emojis');
const { isCoOwnerRole } = require('./roles');
const { toSmallCaps } = require('./smallcaps');
const v2 = require('./v2');

// Where the approved note goes, and where it waits for review first.
const UPDATE_CHANNEL_ID = '1528299418657230878';
const REVIEW_CHANNEL_ID = '1573870512122101780';

/** Newest first. Only the top entry is announced; older ones are history. */
const RELEASES = [
  {
    version: 'v4',
    features: [
      {
        name: 'Red theme',
        detail:
          'Every card, bar and button now uses one red accent instead of mixed purple, green and amber.',
      },
      {
        name: 'Matching panels',
        detail:
          'The ticket, application, giveaway and suggestion panels use the same card style as the rest of the bot.',
      },
    ],
  },
  {
    version: 'v3',
    features: [
      {
        name: 'Spawner pricing',
        detail:
          'Buy tickets now quote the higher price and sell tickets the lower, so a purchase never shows the cheaper side.',
      },
      {
        name: 'Update notes',
        detail:
          "Every release posts a what's-new card in the review channel, and staff choose whether it goes out to the server.",
      },
    ],
  },
  {
    version: 'v2',
    features: [
      {
        name: 'Custom emoji pack',
        detail:
          'All 29 uploaded emoji carry the cards and headings, with a plain glyph wherever one is missing.',
      },
      {
        name: 'Drawn progress bars',
        detail:
          'Rank, level-up and activity cards draw the green progress bar as an image instead of a block of text.',
      },
    ],
  },
  {
    version: 'v1',
    features: [
      {
        name: 'Tickets',
        detail:
          'A button panel opens private ticket channels with claim, add and remove, and close with a saved transcript.',
      },
      {
        name: 'Applications',
        detail:
          'Custom questions answered by DM, with staff accept or deny and a two-week reapply cooldown.',
      },
      {
        name: 'Activity checks',
        detail:
          'Scheduled staff checks with reminders, LOA exemptions and a list of who is still missing.',
      },
    ],
  },
];

function latestVersion() {
  return RELEASES[0]?.version ?? null;
}

function releaseFor(version) {
  return RELEASES.find((release) => release.version === version) ?? null;
}

/** The Co Owner role, whatever font the staff font command last gave it. */
function coOwnerRole(guild) {
  return guild?.roles?.cache?.find((role) => isCoOwnerRole(role, guild)) ?? null;
}

/**
 * The note itself: the feature names are the title, the version is a big
 * heading right underneath, and every feature gets its own bullet.
 */
function updateCard(guild, release, { note = null, buttons = [] } = {}) {
  const features = Array.isArray(release?.features) ? release.features : [];
  const title = features.map((feature) => feature.name).join(' · ');
  const bullets = features
    .map((feature) => `- **${feature.name}** — ${feature.detail}`)
    .join('\n');

  return v2.card({
    accent: COLORS.success,
    kicker: `${icon(guild, 'spark')} ${toSmallCaps('bot update')}`,
    title: title || release?.version || 'Bot update',
    description: [`## ${release?.version ?? 'new'}`, bullets].join('\n'),
    footer: note,
    buttons,
  });
}

/** Post or skip, decided by whoever can see the review channel. */
function reviewComponents(version = latestVersion()) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`update:post:${version}`)
      .setLabel('Post update')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`update:skip:${version}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Anyone who can view the review channel may publish or skip the note. */
function canReview(channel, member) {
  if (!member) return false;
  const permissions = channel?.permissionsFor?.(member);
  if (!permissions) return true;
  return permissions.has(PermissionFlagsBits.ViewChannel);
}

function draftPayload(guild, release) {
  const role = coOwnerRole(guild);
  return {
    ...updateCard(guild, release, { buttons: [reviewComponents(release.version)] }),
    content: role
      ? `${icon(guild, 'spark')} <@&${role.id}> a new bot update is ready — post it or skip it.`
      : 'A new bot update is ready — post it or skip it.',
    allowedMentions: { parse: [], roles: role ? [role.id] : [] },
  };
}

async function resolveChannel(guild, id) {
  const cached = guild?.channels?.cache?.get(id);
  if (cached) return cached;
  return guild?.channels?.fetch?.(id).catch(() => null) ?? null;
}

/**
 * Posts the newest release in the review channel once per server. The version
 * is marked as seen only after the draft exists, so a missing permission is
 * retried on the next restart instead of losing the note.
 */
async function announceOnStartup(client, store) {
  const release = releaseFor(latestVersion());
  if (!release) return [];

  const posted = [];
  for (const guild of client.guilds.cache.values()) {
    const settings = store.guild(guild.id);
    if (settings.updates?.lastVersion === release.version) continue;

    const channel = await resolveChannel(guild, REVIEW_CHANNEL_ID);
    if (!channel?.isTextBased()) {
      console.warn(
        `[updates] Could not reach <#${REVIEW_CHANNEL_ID}> in ${guild.name}; the ${release.version} note will be retried on the next restart.`,
      );
      continue;
    }

    const message = await channel.send(draftPayload(guild, release)).catch((err) => {
      console.error('[updates] Could not post the update draft:', err.message);
      return null;
    });
    if (!message) continue;

    settings.updates.lastVersion = release.version;
    settings.updates.pendingVersion = release.version;
    settings.updates.draftChannelId = channel.id;
    settings.updates.draftMessageId = message.id;
    store.save();
    posted.push({ guildId: guild.id, version: release.version, messageId: message.id });
    console.log(`[updates] ${release.version} is waiting for review in ${guild.name}.`);
  }
  return posted;
}

async function handleButton(interaction, { store }) {
  const [prefix, action, version] = String(interaction.customId).split(':');
  if (prefix !== 'update' || (action !== 'post' && action !== 'skip')) return;

  const release = releaseFor(version);
  if (!release) return;

  if (!canReview(interaction.channel, interaction.member)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'Only staff who can see this channel can post or skip a bot update.',
          'Missing permissions',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = store.guild(interaction.guild.id);
  if (settings.updates?.pendingVersion !== release.version) {
    await interaction.reply({
      embeds: [infoEmbed('Already handled', 'This update was already posted or skipped.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let note;
  if (action === 'post') {
    const channel = await resolveChannel(interaction.guild, UPDATE_CHANNEL_ID);
    if (!channel?.isTextBased()) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `I cannot reach <#${UPDATE_CHANNEL_ID}>. Give me **View Channel** and **Send Messages** there.`,
            'Update channel unreachable',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const message = await channel
      .send({ ...updateCard(interaction.guild, release), allowedMentions: { parse: [] } })
      .catch((err) => {
        console.error('[updates] Could not post the announcement:', err.message);
        return null;
      });
    if (!message) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'Discord refused the message. Check my permissions in that channel.',
            'Could not post the update',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    note = `Posted to <#${UPDATE_CHANNEL_ID}> by <@${interaction.user.id}>`;
  } else {
    note = `Skipped by <@${interaction.user.id}> — not posted`;
  }

  settings.updates.pendingVersion = null;
  store.save();

  // The draft keeps the note but loses its buttons, so nobody posts it twice.
  await interaction.update({
    ...updateCard(interaction.guild, release, { note }),
    content: '',
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  RELEASES,
  REVIEW_CHANNEL_ID,
  UPDATE_CHANNEL_ID,
  announceOnStartup,
  canReview,
  coOwnerRole,
  draftPayload,
  handleButton,
  latestVersion,
  releaseFor,
  reviewComponents,
  updateCard,
};
