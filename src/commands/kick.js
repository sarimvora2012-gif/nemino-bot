'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  sendLog,
  safeDM,
  COLORS,
} = require('../lib/helpers');
const { evaluateKick, isProtected } = require('../lib/protection');

const data = [
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member (protected members can only be kicked by admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to kick').setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Reason, shown in the log and the DM')
        .setMaxLength(500),
    ),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') ?? 'No reason provided';

  const target = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!target) {
    await interaction.reply({
      embeds: [errorEmbed('That user is not a member of this server.')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const actor = interaction.member;
  const bot = guild.members.me;
  const check = evaluateKick({
    actor,
    target,
    bot,
    guild,
    protectionRoleId: settings.kickProtectionRoleId,
  });

  if (!check.ok) {
    await interaction.reply({
      embeds: [errorEmbed(check.message, check.protected ? 'Kick protection' : 'Cannot kick')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const protectedMember = isProtected(target, settings.kickProtectionRoleId);

  await safeDM(target.user, {
    embeds: [
      embed({
        title: `You were kicked from ${guild.name}`,
        description: [`**Reason:** ${reason}`, `**By:** ${interaction.user.tag}`].join('\n'),
        color: COLORS.danger,
      }),
    ],
  });

  try {
    await target.kick(`${interaction.user.tag}: ${reason}`);
  } catch (err) {
    await interaction.reply({
      embeds: [errorEmbed(`I could not kick ${target}: ${err.message}`, 'Kick failed')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const result = embed({
    title: '👢 Member kicked',
    color: COLORS.warning,
    fields: [
      { name: 'Member', value: `${user}`, inline: true },
      { name: 'Moderator', value: `${interaction.user}`, inline: true },
      { name: 'Reason', value: reason },
      ...(protectedMember
        ? [{ name: 'Kick protection', value: '🛡️ Protected — admin bypass', inline: true }]
        : []),
    ],
    thumbnail: user.displayAvatarURL(),
  });

  await interaction.reply({ embeds: [result], allowedMentions: { parse: [] } });
  await sendLog(guild, settings, [result]);
}

module.exports = { data, execute };
