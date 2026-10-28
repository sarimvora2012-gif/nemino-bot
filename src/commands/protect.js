'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  COLORS,
} = require('../lib/helpers');
const { isProtected, ensureProtectionRole, PROTECTION_ROLE_NAME } = require('../lib/protection');

const data = [
  new SlashCommandBuilder()
    .setName('protect')
    .setDescription('Choose members who can only be kicked by admins')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Give a member kick protection')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Member who only admins may kick').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a member’s kick protection')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Member to remove protection from').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show every protected member')),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [
        errorEmbed('You need **Manage Server** to manage kick protection.', 'Missing permissions'),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    let role = settings.kickProtectionRoleId
      ? guild.roles.cache.get(settings.kickProtectionRoleId)
      : null;
    if (!role) role = guild.roles.cache.find((candidate) => candidate.name === PROTECTION_ROLE_NAME) ?? null;

    const ids = new Set(settings.protectedUsers ?? []);
    if (role) {
      for (const id of role.members.keys()) ids.add(id);
    }
    const lines = [...ids].map((id) => {
      const cached = guild.members.cache.get(id);
      return cached ? `• ${cached}` : `• <@${id}>`;
    });
    await interaction.reply({
      embeds: [
        embed({
          title: '🛡️ Kick protection',
          description: lines.length
            ? lines.join('\n')
            : '_No members are protected yet._',
          color: lines.length ? COLORS.success : COLORS.neutral,
          footer: 'Admins can still kick protected members · use /protect add to protect someone',
        }),
      ],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const user = interaction.options.getUser('user');
  const member = await guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({
      embeds: [errorEmbed('That user is not a member of this server.')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  let role;
  try {
    role = await ensureProtectionRole(guild, settings, store);
  } catch (err) {
    await interaction.reply({
      embeds: [errorEmbed(err.message, 'Could not set up kick protection')],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const protectedNow = isProtected(member, role.id);
  if (!Array.isArray(settings.protectedUsers)) settings.protectedUsers = [];

  if (sub === 'add') {
    if (protectedNow) {
      if (!settings.protectedUsers.includes(member.id)) {
        settings.protectedUsers.push(member.id);
        store.save();
      }
      await interaction.reply({
        embeds: [errorEmbed(`${member} is already protected.`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    try {
      await member.roles.add(role, `Kick protection added by ${interaction.user.tag}`);
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed(`I could not give ${member} the protection role: ${err.message}`)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (!settings.protectedUsers.includes(member.id)) {
      settings.protectedUsers.push(member.id);
      store.save();
    }
    await interaction.reply({
      embeds: [
        successEmbed(
          '🛡️ Kick protection added',
          `${member} can now only be kicked by admins. Non-admin staff will be blocked.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!protectedNow) {
    settings.protectedUsers = settings.protectedUsers.filter((id) => id !== member.id);
    store.save();
    await interaction.reply({
      embeds: [errorEmbed(`${member} does not have kick protection.`)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  try {
    await member.roles.remove(role, `Kick protection removed by ${interaction.user.tag}`);
  } catch (err) {
    await interaction.reply({
      embeds: [errorEmbed(`I could not remove ${member}'s protection role: ${err.message}`)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  settings.protectedUsers = settings.protectedUsers.filter((id) => id !== member.id);
  store.save();

  await interaction.reply({
    embeds: [successEmbed('Kick protection removed', `${member} can be kicked normally again.`)],
    allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute };
