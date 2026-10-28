'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
  embed,
  errorEmbed,
  canManageRole,
  safeDM,
  COLORS,
} = require('../lib/helpers');
const v2 = require('../lib/v2');
const { toSmallCaps } = require('../lib/smallcaps');

const SILENT_MENTIONS = { parse: [], users: [], roles: [] };
const STAFF_MOVEMENT_CHANNEL_ID = '1528259332876275742';

const data = [
  new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Give a member a role (select the role directly)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to promote').setRequired(true),
    )
    .addRoleOption((opt) =>
      opt
        .setName('role')
        .setDescription('Role to give — selecting it here never notifies the role')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason, shown in the log and the DM').setMaxLength(500),
    ),

  new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a member to a role (select the role they move down to)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to demote').setRequired(true),
    )
    .addRoleOption((opt) =>
      opt
        .setName('role')
        .setDescription('The role they are demoted to — selecting it never notifies the role')
        .setRequired(true),
    )
    .addRoleOption((opt) =>
      opt
        .setName('current_role')
        .setDescription('Role to remove (auto-detected from their highest role above the target)'),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason, shown in the log and the DM').setMaxLength(500),
    ),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const command = interaction.commandName;
  const isPromote = command === 'promote';

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'You need **Manage Server** to use promotion and demotion commands.',
          'Missing permissions',
        ),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user');
  const targetRole = interaction.options.getRole('role');
  const requestedFromRole = interaction.options.getRole('current_role');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  if (targetUser.bot) {
    await interaction.reply({
      embeds: [errorEmbed('Bots cannot be promoted or demoted.')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  const member = await guild.members.fetch({ user: targetUser.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed('That user is not a member of this server.')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  const botPosition = guild.members.me.roles.highest.position;
  if (member.roles.highest.position >= botPosition) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `${member} has a role above mine, so I cannot change their roles. Move my bot role higher.`,
          'Role hierarchy problem',
        ),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  if (!targetRole || !canManageRole(guild, targetRole)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `I cannot manage ${targetRole ?? 'that role'}. It may be deleted or above my highest role.`,
          'Role hierarchy problem',
        ),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  const hasTargetRole = member.roles.cache.has(targetRole.id);

  if (isPromote) {
    if (hasTargetRole) {
      await interaction.reply({
        embeds: [errorEmbed(`${member} already has ${targetRole}.`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      });
      return;
    }

    try {
      await member.roles.add(targetRole, `Promoted by ${interaction.user.tag}: ${reason}`);
    } catch (err) {
      console.error('[promote] Role update failed:', err);
      await interaction.reply({
        embeds: [errorEmbed(`I could not update ${member}'s roles: ${err.message}`, 'Role update failed')],
        flags: MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      });
      return;
    }

    await finish(interaction, {
      guild,
      settings,
      member,
      targetRole,
      fromRole: null,
      reason,
      action: 'Promoted',
      color: COLORS.success,
    });
    return;
  }

  // ---- demote --------------------------------------------------------------
  const specialRoleIds = new Set(
    [settings.kickProtectionRoleId, settings.activity?.loaRoleId].filter(Boolean),
  );
  if (specialRoleIds.has(targetRole.id)) {
    await interaction.reply({
      embeds: [errorEmbed('That role is managed by another system and cannot be used for a demotion.')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }
  if (hasTargetRole) {
    await interaction.reply({
      embeds: [errorEmbed(`${member} already has ${targetRole}.`)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }
  if (!requestedFromRole && targetRole.position >= member.roles.highest.position) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `${targetRole} is not below ${member}'s current highest role. Use \`/promote\` to give it to them.`,
          'That would be a promotion',
        ),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  let fromRole = requestedFromRole;
  if (fromRole) {
    if (specialRoleIds.has(fromRole.id)) {
      await interaction.reply({
        embeds: [errorEmbed(`${fromRole} is managed by another system and cannot be removed here.`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      });
      return;
    }
    if (!member.roles.cache.has(fromRole.id)) {
      await interaction.reply({
        embeds: [errorEmbed(`${member} does not have ${fromRole}.`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      });
      return;
    }
    if (!canManageRole(guild, fromRole)) {
      await interaction.reply({
        embeds: [errorEmbed(`I cannot remove ${fromRole}. It may be above my highest role.`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      });
      return;
    }
  } else {
    // Auto-detect the highest manageable role above the target, ignoring
    // systems roles and the base staff role.
    const ignored = new Set([
      targetRole.id,
      guild.id,
      settings.staffRoleId,
      settings.kickProtectionRoleId,
      settings.activity?.loaRoleId,
    ]);
    fromRole =
      [...member.roles.cache.values()]
        .filter(
          (role) =>
            !ignored.has(role.id) &&
            !role.managed &&
            role.position > targetRole.position &&
            role.position < botPosition,
        )
        .sort((a, b) => b.position - a.position)[0] ?? null;

    if (!fromRole) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            `I could not find a higher role to remove. Use \`current_role:@role\` to pick the role they are demoted from, or use \`/promote\` to give ${targetRole}.`,
            'No higher role found',
          ),
        ],
        flags: MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      });
      return;
    }
  }

  if (fromRole.position <= targetRole.position) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `${fromRole} is not higher than ${targetRole}. Use \`/promote\` to give them ${targetRole}.`,
          'That would be a promotion',
        ),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  let targetAdded = false;
  try {
    await member.roles.add(targetRole, `Demoted by ${interaction.user.tag}: ${reason}`);
    targetAdded = true;
    await member.roles.remove(fromRole, `Demoted by ${interaction.user.tag}: ${reason}`);
  } catch (err) {
    console.error('[demote] Role update failed:', err);
    if (targetAdded) {
      await member.roles.remove(targetRole, 'Rollback after failed demotion').catch(() => {});
    }
    await interaction.reply({
      embeds: [errorEmbed(`I could not update ${member}'s roles: ${err.message}`, 'Role update failed')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
    return;
  }

  await finish(interaction, {
    guild,
    settings,
    member,
    targetRole,
    fromRole,
    reason,
    action: 'Demoted',
    color: COLORS.warning,
  });
}

async function finish(interaction, {
  guild,
  settings,
  member,
  targetRole,
  fromRole,
  reason,
  action,
  color,
}) {
  const isPromote = action === 'Promoted';
  const card = movementCard({
    guild,
    member,
    targetRole,
    fromRole,
    moderator: interaction.user,
    reason,
    action,
    color,
  });

  try {
    const channel =
      guild.channels.cache.get(STAFF_MOVEMENT_CHANNEL_ID) ??
      (await guild.channels.fetch(STAFF_MOVEMENT_CHANNEL_ID).catch(() => null));

    if (!channel?.isTextBased()) {
      throw new Error(`Staff movement channel <#${STAFF_MOVEMENT_CHANNEL_ID}> was not found.`);
    }

    await channel.send({ ...card, allowedMentions: SILENT_MENTIONS });
    await interaction.reply({
      content: `${isPromote ? '🎉' : '📉'} ${action} ${member.user.tag} to ${targetRole.name}. Posted in <#${STAFF_MOVEMENT_CHANNEL_ID}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: SILENT_MENTIONS,
    });
  } catch (err) {
    console.error('[staff] Failed to post staff movement card:', err);
    const logChannel = settings.logChannelId
      ? guild.channels.cache.get(settings.logChannelId)
      : null;
    if (logChannel?.isTextBased()) {
      await logChannel.send(card).catch(() => {});
    }
    await interaction
      .reply({
        components: card.components,
        flags: card.flags | MessageFlags.Ephemeral,
        allowedMentions: SILENT_MENTIONS,
      })
      .catch(() =>
        interaction.reply({
          content: `⚠️ ${action} ${member.user.tag}, but I could not post the card in <#${STAFF_MOVEMENT_CHANNEL_ID}>. ${err.message}`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: SILENT_MENTIONS,
        }),
      );
  }

  await safeDM(member.user, memberDM({ guild, targetRole, moderator: interaction.user, reason, action, color }));
}

/** The public staff movement card posted in the movement channel. */
function movementCard({ guild, member, targetRole, fromRole, moderator, reason, action, color }) {
  const isPromote = action === 'Promoted';
  return v2.card({
    accent: color,
    kicker: toSmallCaps('staff movement'),
    title: isPromote ? '🎉 PROMOTION' : '📉 DEMOTION',
    subtitle: isPromote ? '✨ Another step up the ladder' : '🔄 Role updated by the staff team',
    quote: isPromote
      ? `> 🎊 **${member}** has been promoted to **${targetRole}**!`
      : `> 📉 **${member}** has been demoted to **${targetRole}**.`,
    stats: [
      { emoji: '👤', label: 'Member', value: `${member}` },
      {
        emoji: isPromote ? '🏅' : '🔄',
        label: isPromote ? 'New role' : 'Role change',
        value: isPromote ? `${targetRole}` : `${fromRole} → ${targetRole}`,
      },
      { emoji: '🛡️', label: 'Moderator', value: `${moderator}` },
      { emoji: '📝', label: 'Reason', value: reason },
    ],
    footer: isPromote ? 'Congratulations, keep it up 💪' : 'Staff movement record',
    thumbnail: member.user.displayAvatarURL({ size: 256 }),
  });
}

/** The DM the promoted or demoted member receives. */
function memberDM({ guild, targetRole, moderator, reason, action, color }) {
  const isPromote = action === 'Promoted';
  return v2.card({
    accent: color,
    kicker: toSmallCaps(guild.name),
    title: isPromote ? '🎉 YOU WERE PROMOTED' : '📉 YOU WERE DEMOTED',
    subtitle: isPromote ? 'The team noticed your work' : 'Your role has been updated',
    quote: isPromote
      ? `> 🎊 Welcome to **${targetRole.name}**!`
      : `> 🔄 You are now **${targetRole.name}**.`,
    stats: [
      { emoji: '🏅', label: isPromote ? 'Role added' : 'New role', value: targetRole.name },
      { emoji: '🛡️', label: 'By', value: moderator.tag },
      { emoji: '📝', label: 'Reason', value: reason },
    ],
    footer: isPromote ? 'Keep up the great work 🌟' : 'Reach out to a lead if you have questions',
    thumbnail: guild.iconURL({ size: 256 }) ?? undefined,
  });
}

module.exports = { data, execute, STAFF_MOVEMENT_CHANNEL_ID, memberDM, movementCard };
