'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { embed, errorEmbed, COLORS, canManageRole } = require('./helpers');
const { fontKey } = require('./smallcaps');

const PREFIX = '!roleicons';

/**
 * The staff ladder, most specific first. A role is matched by keyword, so
 * `ᴛʀɪᴀʟ ᴍᴏᴅ` lands on Trial before Moderator and `ᴄᴏ-ᴏᴡɴᴇʀ` lands on
 * Co-Owner before Owner. `badges` are server emoji names that override the
 * plain emoji when the server has that art uploaded.
 */
const LEVELS = [
  {
    id: 'coowner',
    label: 'Co-Owner',
    emoji: '💎',
    names: ['co-owner', 'co owner', 'coowner', 'vice owner', 'deputy owner'],
    badges: ['coowner', 'co_owner'],
  },
  {
    id: 'owner',
    label: 'Owner',
    emoji: '👑',
    names: ['owner', 'founder'],
    badges: ['owner', 'crown'],
  },
  {
    id: 'trial',
    label: 'Trial',
    emoji: '🌱',
    names: ['trial', 'trainee', 'intern', 'probation'],
    badges: ['trial', 'seedling'],
  },
  {
    id: 'senior',
    label: 'Senior',
    emoji: '🎯',
    names: ['senior', 'head mod', 'lead mod'],
    badges: ['senior', 'target'],
  },
  {
    id: 'head',
    label: 'Head',
    emoji: '⚔️',
    names: ['head', 'lead', 'manager', 'chief', 'supervisor'],
    badges: ['head', 'swords'],
  },
  {
    id: 'admin',
    label: 'Admin',
    emoji: '🛡️',
    names: ['admin', 'administrator'],
    badges: ['admin', 'shield'],
  },
  {
    id: 'mod',
    label: 'Moderator',
    emoji: '🔰',
    names: ['mod', 'moderator'],
    badges: ['mod', 'moderator'],
  },
  {
    id: 'helper',
    label: 'Helper',
    emoji: '🤝',
    names: ['helper', 'support', 'assistant'],
    badges: ['helper', 'handshake'],
  },
  {
    id: 'staff',
    label: 'Staff',
    emoji: '⭐',
    names: ['staff', 'team', 'crew'],
    badges: ['staff', 'star'],
  },
];

/** The level a role name matches, or null. Font, emoji and punctuation are ignored. */
function levelForRole(roleName) {
  const key = fontKey(roleName);
  if (!key) return null;
  for (const level of LEVELS) {
    if (level.names.some((name) => key.includes(fontKey(name)))) return level;
  }
  return null;
}

/** A server emoji whose name matches one of the level's badge names. */
function badgeEmoji(guild, level) {
  const cache = guild?.emojis?.cache;
  if (!cache) return null;
  for (const name of level.badges) {
    const wanted = fontKey(name);
    const found = cache.find((emoji) => fontKey(emoji.name) === wanted);
    if (found) return found;
  }
  return null;
}

/** Works out what each staff-level role would get, without touching anything. */
function buildPlan(guild, settings) {
  const staffRole = settings?.staffRoleId ? guild.roles.cache.get(settings.staffRoleId) : null;
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .filter((role) => !role.managed)
    .filter((role) => !staffRole || role.position >= staffRole.position)
    .sort((a, b) => b.position - a.position);

  const planned = [];
  const skipped = [];
  const blocked = [];

  for (const role of roles) {
    const level = levelForRole(role.name);
    if (!level) {
      skipped.push(role);
      continue;
    }
    if (!canManageRole(guild, role)) {
      blocked.push({ role, level });
      continue;
    }
    planned.push({ role, level, emoji: badgeEmoji(guild, level) });
  }

  return { planned, skipped, blocked, staffRole };
}

/** `:name:` as a real emoji tag, so the preview shows the art instead of an object. */
function emojiTag(emoji) {
  if (!emoji) return '';
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function planLines({ planned, skipped, blocked }) {
  const fields = [];

  fields.push({
    name: `🖼️ Icons to apply (${planned.length})`,
    value:
      planned
        .map(({ role, level, emoji }) =>
          emoji
            ? `${level.emoji} **${role.name}** → ${emojiTag(emoji)} *(\`${emoji.name}\` art)*`
            : `${level.emoji} **${role.name}** → ${level.emoji} *(${level.label})*`,
        )
        .join('\n') || '> none',
  });

  if (skipped.length) {
    fields.push({
      name: `⏭️ No level matched (${skipped.length})`,
      value: skipped.map((role) => `**${role.name}**`).join(' · ').slice(0, 1024),
    });
  }

  if (blocked.length) {
    fields.push({
      name: `⚠️ Above my role (${blocked.length})`,
      value: blocked
        .map(({ role }) => `**${role.name}** — move my bot role above it`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  return fields;
}

function previewCard(guild, plan) {
  return embed({
    title: '🎨 Staff role icons',
    description: [
      'These are the icons I would set on your staff roles.',
      'Your own server emoji art is used when an emoji with a matching name exists, otherwise the plain emoji is set.',
      '',
      '*Nothing has been changed yet.*',
    ].join('\n'),
    color: COLORS.brand,
    fields: planLines(plan),
    footer: guild.name,
  });
}

function previewComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('roleicons:apply')
        .setLabel('Apply icons')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('roleicons:cancel')
        .setLabel('Cancel')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * Sets one role icon: the server emoji's image when it exists, else the plain
 * emoji. Returns the method used so the report can say what happened.
 */
async function applyIcon({ role, level, emoji }) {
  if (emoji) {
    const url = emoji.imageURL({ extension: 'png', size: 128 });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not download \`${emoji.name}\``);
    const buffer = Buffer.from(await response.arrayBuffer());
    await role.setIcon(buffer, 'Staff role icon');
    return `custom art \`${emoji.name}\``;
  }
  await role.setUnicodeEmoji(level.emoji);
  return `emoji ${level.emoji}`;
}

async function applyPlan(plan) {
  const done = [];
  const failed = [];

  for (const entry of plan.planned) {
    try {
      const method = await applyIcon(entry);
      done.push({ ...entry, method });
    } catch (err) {
      failed.push({ ...entry, reason: err.message });
    }
  }

  return { done, failed };
}

function resultCard(guild, { done, failed }) {
  const fields = [];
  if (done.length) {
    fields.push({
      name: `✅ Applied (${done.length})`,
      value: done
        .map(({ role, method }) => `**${role.name}** · ${method}`)
        .join('\n')
        .slice(0, 1024),
    });
  }
  if (failed.length) {
    fields.push({
      name: `⚠️ Could not set (${failed.length})`,
      value: failed
        .map(({ role, reason }) => `**${role.name}** — ${reason}`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  return embed({
    title: '🎨 Staff role icons',
    description: done.length
      ? 'Icons set. Re-run `!roleicons` any time you upload new emoji art.'
      : 'Nothing was changed.',
    color: failed.length ? COLORS.warning : COLORS.success,
    fields,
    footer: guild.name,
  });
}

async function handleMessage(message, { store }) {
  const content = String(message.content ?? '').trim();
  if (content.toLowerCase() !== PREFIX) return;

  const guild = message.guild;
  if (!guild) return;
  const reply = (payload) => message.reply({ ...payload, allowedMentions: { parse: [] } });

  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await reply({
      embeds: [errorEmbed('You need **Manage Server** to set role icons.', 'Missing permissions')],
    });
    return;
  }

  const settings = store.guild(guild.id);
  const plan = buildPlan(guild, settings);

  if (!plan.planned.length && !plan.blocked.length) {
    await reply({
      embeds: [
        errorEmbed(
          [
            'No staff role name matched a level.',
            '',
            'Name roles like `Owner`, `Co-Owner`, `Admin`, `Head Admin`, `Senior Mod`, `Moderator`, `Trial Mod`, `Helper` or `Staff`, or set the staff floor with `/config set staff_role:@role`.',
          ].join('\n'),
          'Nothing to icon',
        ),
      ],
    });
    return;
  }

  await reply({
    embeds: [previewCard(guild, plan)],
    components: previewComponents(),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleButton(interaction, { store }) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('You need **Manage Server** to set role icons.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.customId === 'roleicons:cancel') {
    await interaction.update({ embeds: [errorEmbed('Cancelled — nothing was changed.', 'Role icons')], components: [] });
    return;
  }

  await interaction.deferUpdate();
  const guild = interaction.guild;
  const plan = buildPlan(guild, store.guild(guild.id));
  const result = await applyPlan(plan);
  await interaction.editReply({ embeds: [resultCard(guild, result)], components: [] });
}

module.exports = {
  LEVELS,
  PREFIX,
  applyIcon,
  applyPlan,
  badgeEmoji,
  buildPlan,
  emojiTag,
  handleButton,
  handleMessage,
  levelForRole,
};
