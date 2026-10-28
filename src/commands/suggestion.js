'use strict';

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const {
  embed,
  successEmbed,
  errorEmbed,
  isStaff,
  COLORS,
  truncate,
} = require('../lib/helpers');

const SUGGESTION_CHANNEL_ID = '1556519770998964275';

const data = [
  new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Send a suggestion to the suggestion channel')
    .addStringOption((opt) =>
      opt
        .setName('suggestion')
        .setDescription('Your suggestion')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(1500),
    ),
];

function voteCounts(suggestion) {
  return {
    up: suggestion.upVotes?.length ?? 0,
    down: suggestion.downVotes?.length ?? 0,
  };
}

function suggestionEmbed(suggestion) {
  const { up, down } = voteCounts(suggestion);
  return embed({
    title: '💡 Suggestion',
    description: truncate(suggestion.content, 3500),
    color: COLORS.brand,
    fields: [
      { name: 'Submitted by', value: `<@${suggestion.authorId}> (${suggestion.authorTag})`, inline: true },
      { name: 'Votes', value: `✅ **${up}** approve\n❌ **${down}** reject`, inline: true },
    ],
    footer: `${suggestion.id} · Staff vote using the buttons below`,
  });
}

function voteRow(suggestion) {
  const { up, down } = voteCounts(suggestion);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion:up:${suggestion.id}`)
      .setLabel(`Approve (${up})`)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`suggestion:down:${suggestion.id}`)
      .setLabel(`Reject (${down})`)
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );
}

async function execute(interaction, { store }) {
  const guild = interaction.guild;
  const content = interaction.options.getString('suggestion').trim();

  if (!content) {
    await interaction.reply({
      embeds: [errorEmbed('Please write a suggestion before sending it.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel =
    guild.channels.cache.get(SUGGESTION_CHANNEL_ID) ??
    (await guild.channels.fetch(SUGGESTION_CHANNEL_ID).catch(() => null));
  if (!channel?.isTextBased()) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          `I cannot find the suggestion channel (<#${SUGGESTION_CHANNEL_ID}>). Please contact a staff member.`,
          'Suggestion channel missing',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const number = store.nextCounter(guild.id, 'suggestion');
  const suggestion = {
    id: `SUG-${String(number).padStart(4, '0')}`,
    guildId: guild.id,
    authorId: interaction.user.id,
    authorTag: interaction.user.tag,
    content,
    upVotes: [],
    downVotes: [],
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  store.addSuggestion(suggestion);

  const message = await channel
    .send({
      embeds: [suggestionEmbed(suggestion)],
      components: [voteRow(suggestion)],
    })
    .catch((err) => {
      console.error('[suggestion] Failed to post suggestion:', err);
      return null;
    });

  if (!message) {
    store.updateSuggestion(suggestion.id, { status: 'failed' });
    await interaction.editReply({
      embeds: [errorEmbed('I could not post your suggestion. Please contact a staff member.')],
    });
    return;
  }

  store.updateSuggestion(suggestion.id, { channelId: channel.id, messageId: message.id });

  await interaction.editReply({
    embeds: [
      successEmbed(
        'Suggestion sent',
        `Your suggestion is now in ${channel}.\n[Jump to it](${message.url})`,
      ),
    ],
  });
}

async function handleButton(interaction, { store }) {
  const [, action, suggestionId] = interaction.customId.split(':');
  if (action !== 'up' && action !== 'down') return;

  const suggestion = store.suggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({
      embeds: [errorEmbed('That suggestion could not be found.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = store.guild(interaction.guild.id);
  if (!isStaff(interaction.member, settings)) {
    await interaction.reply({
      embeds: [errorEmbed('Only staff can vote on suggestions.', 'Missing permissions')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const upVotes = new Set(suggestion.upVotes ?? []);
  const downVotes = new Set(suggestion.downVotes ?? []);
  const userId = interaction.user.id;

  if (action === 'up') {
    if (upVotes.has(userId)) {
      upVotes.delete(userId);
    } else {
      upVotes.add(userId);
      downVotes.delete(userId);
    }
  } else if (downVotes.has(userId)) {
    downVotes.delete(userId);
  } else {
    downVotes.add(userId);
    upVotes.delete(userId);
  }

  const updated = store.updateSuggestion(suggestion.id, {
    upVotes: [...upVotes],
    downVotes: [...downVotes],
  });

  await interaction.update({
    embeds: [suggestionEmbed(updated)],
    components: [voteRow(updated)],
  });

  const hasVote =
    action === 'up' ? upVotes.has(userId) : downVotes.has(userId);
  await interaction
    .followUp({
      content: hasVote
        ? action === 'up'
          ? '✅ Your approval vote was recorded.'
          : '❌ Your rejection vote was recorded.'
        : 'Your vote was removed.',
      flags: MessageFlags.Ephemeral,
    })
    .catch(() => {});
}

module.exports = {
  data,
  execute,
  handleButton,
  SUGGESTION_CHANNEL_ID,
  suggestionEmbed,
  voteRow,
};
