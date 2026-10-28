'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { embed, successEmbed, errorEmbed, COLORS } = require('../lib/helpers');
const spawners = require('../lib/spawners');

const data = [
  new SlashCommandBuilder()
    .setName('setspawnerprice')
    .setDescription('Set what a spawner buys or sells for')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('spawner')
        .setDescription('Which spawner')
        .setRequired(true)
        .addChoices(
          ...spawners.SPAWNER_TYPES.map((type) => ({ name: type.label, value: type.key })),
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Buying price or selling price')
        .setRequired(true)
        .addChoices({ name: 'Buying', value: 'buy' }, { name: 'Selling', value: 'sell' }),
    )
    .addNumberOption((opt) =>
      opt
        .setName('price')
        .setDescription('Price in millions, up to 2 decimals — 13, 12.5 or 0.75')
        .setRequired(true)
        .setMinValue(spawners.MIN_PRICE)
        .setMaxValue(spawners.MAX_PRICE),
    ),
];

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const settings = store.guild(guild.id);

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [errorEmbed('You need **Manage Server** to change spawner prices.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const key = interaction.options.getString('spawner');
  const mode = interaction.options.getString('type');
  const price = interaction.options.getNumber('price');
  const type = spawners.spawnerByKey(key);
  const parsed = spawners.validatePrice(price);

  if (!type || !parsed.ok) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          parsed.ok ? 'That spawner or price type is not valid.' : parsed.message,
          'Invalid price',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const formatted = spawners.applyPrice(settings, key, mode, parsed.value);
  if (!formatted) {
    await interaction.reply({
      embeds: [errorEmbed('That price could not be saved.', 'Invalid price')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  store.save();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Keep the public board in sync: edit the saved panel, or post a fresh one.
  const refreshed = await spawners.refreshPanel(interaction.client, guild, settings).catch(() => false);
  let posted = null;
  if (!refreshed) {
    const channel =
      guild.channels.cache.get(spawners.PRICES_CHANNEL_ID) ??
      (await guild.channels.fetch(spawners.PRICES_CHANNEL_ID).catch(() => null));
    if (channel?.isTextBased()) {
      posted = await spawners
        .ensurePanel(guild, settings, store, channel)
        .catch((err) => {
          console.error('[spawners] Could not post the board:', err);
          return null;
        });
    }
  }

  const label = mode === 'buy' ? 'Buying' : 'Selling';
  await interaction.editReply({
    embeds: [
      successEmbed(
        'Spawner price updated',
        [
          `${spawners.spawnerEmoji(guild, type)} **${type.label}** · ${label} price is now **${formatted} each**`,
          '',
          posted
            ? `The board is live in ${posted.channel}.`
            : refreshed
              ? 'The prices board was updated.'
              : `I could not reach <#${spawners.PRICES_CHANNEL_ID}>. Give me **Send Messages** there and run \`!spawnerprices\` in it.`,
        ].join('\n'),
      ),
    ],
  });
}

module.exports = { data, execute };
