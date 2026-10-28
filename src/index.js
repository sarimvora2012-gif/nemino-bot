'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Always read the env file that sits next to package.json, no matter which
// working directory the hosting panel starts the process from. `.env`,
// `wispbyte.env` and `env` are all accepted.
const env = require('./lib/env');
env.loadEnv();
const {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  ActivityType,
  Partials,
} = require('discord.js');
const { Store } = require('./store');
const { errorEmbed } = require('./lib/helpers');
const activity = require('./lib/activity');
const automod = require('./lib/automod');
const honeypot = require('./lib/honeypot');
const loa = require('./lib/loa');
const membercount = require('./lib/membercount');
const rolefont = require('./lib/rolefont');
const roleicons = require('./lib/roleicons');
const roleping = require('./lib/roleping');
const spawnerBoard = require('./lib/spawners');
const staffguide = require('./lib/staffguide');
const steal = require('./lib/steal');
const streams = require('./lib/streams');
const strike = require('./lib/strike');
const timeout = require('./lib/timeout');
const vouch = require('./lib/vouch');
const welcome = require('./lib/welcome');
const v2 = require('./lib/v2');

const root = path.join(__dirname, '..');
const store = new Store(path.join(root, 'data', 'data.json'));

const modules = {};
const commands = new Map();

function loadCommands() {
  const dir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const mod = require(path.join(dir, file));
    const name = path.basename(file, '.js');
    modules[name] = mod;
    for (const builder of mod.data) {
      commands.set(builder.name, mod);
    }
  }
}

/** Button and modal custom IDs are namespaced: `ticket:close:123`, `apply:accept:A-0001`. */
const componentModules = {
  ticket: () => modules.ticket,
  apply: () => modules.application,
  giveaway: () => modules.giveaway,
  suggestion: () => modules.suggestion,
  loa: () => loa,
  spawner: () => spawnerBoard,
  roleicons: () => roleicons,
};

function getComponentModule(customId) {
  const prefix = String(customId).split(':')[0];
  return componentModules[prefix]?.() ?? null;
}

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error(
    [
      'DISCORD_TOKEN is missing.',
      '',
      'Create a file named .env (or wispbyte.env) next to package.json, containing:',
      '  DISCORD_TOKEN=your-bot-token',
      '  CLIENT_ID=your-application-id',
      '  GUILD_ID=your-server-id',
      '',
      `Project folder: ${env.ROOT}`,
      `Files there: ${env.rootListing()}`,
      `Env-like files there: ${env.envCandidates() || 'none'}`,
      '',
      'Upload the file into the folder listed above, then restart the server.',
    ].join('\n'),
  );
  process.exit(1);
}

loadCommands();
v2.install();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});
const context = { client, store, commands };

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setActivity('tickets & applications', { type: ActivityType.Watching });
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`   Serving ${readyClient.guilds.cache.size} server(s) · ${commands.size} commands loaded`);
  console.log('   Tip: run "npm run deploy" after changing commands.');
  activity.startScheduler(context);
  modules.giveaway?.startScheduler(context);
  membercount.start(context);
  streams.start(context);
  modules.ticket
    ?.sweepClosedTickets(context)
    .catch((err) => console.error('[ticket] Cleanup failed:', err));
});

client.on(Events.GuildMemberAdd, (member) => {
  welcome
    .handleMemberAdd(member, context)
    .catch((err) => console.error('[welcome] Handler failed:', err));
  membercount.queueUpdate(context, member.guild);
});

client.on(Events.GuildMemberRemove, (member) => {
  membercount.queueUpdate(context, member.guild);
});

client.on(Events.MessageCreate, (message) => {
  if (message.author?.bot) return;

  if (message.channel?.isDMBased()) {
    modules.application
      ?.handleDirectMessage(message, context)
      .catch((err) => console.error('[application] DM handler failed:', err));
    return;
  }

  if (!message.guild) return;

  loa
    .handleMessage(message, context)
    .catch((err) => console.error('[loa] Message handler failed:', err));
  staffguide
    .handleMessage(message, context)
    .catch((err) => console.error('[staffguide] Message handler failed:', err));
  timeout
    .handleMessage(message, context)
    .catch((err) => console.error('[timeout] Message handler failed:', err));
  strike
    .handleMessage(message, context)
    .catch((err) => console.error('[strike] Message handler failed:', err));
  steal
    .handleMessage(message, context)
    .catch((err) => console.error('[steal] Message handler failed:', err));
  spawnerBoard
    .handleMessage(message, context)
    .catch((err) => console.error('[spawners] Message handler failed:', err));
  honeypot
    .handleMessage(message, context)
    .catch((err) => console.error('[honeypot] Message handler failed:', err));
  vouch
    .handleMessage(message, context)
    .catch((err) => console.error('[vouch] Message handler failed:', err));
  rolefont
    .handleMessage(message, context)
    .catch((err) => console.error('[rolefont] Message handler failed:', err));
  roleping
    .handleMessage(message, context)
    .catch((err) => console.error('[roleping] Message handler failed:', err));
  roleicons
    .handleMessage(message, context)
    .catch((err) => console.error('[roleicons] Message handler failed:', err));
  automod
    .handleMessage(message, context)
    .catch((err) => console.error('[automod] Message handler failed:', err));
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (
    !newMessage.partial &&
    !oldMessage.partial &&
    oldMessage.content === newMessage.content &&
    oldMessage.attachments.size === newMessage.attachments.size
  ) {
    return;
  }

  const message = newMessage.partial
    ? await newMessage.fetch().catch(() => null)
    : newMessage;
  if (!message) return;

  automod
    .handleMessage(message, context, { trackSpam: false })
    .catch((err) => console.error('[automod] Edit handler failed:', err));
});

client.on(Events.MessageReactionAdd, (reaction, user) => {
  activity.handleReaction(context, reaction, user, 'add');
});

client.on(Events.MessageReactionRemove, (reaction, user) => {
  activity.handleReaction(context, reaction, user, 'remove');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const mod = commands.get(interaction.commandName);
      if (!mod) return;
      await mod.execute(interaction, context);
      return;
    }

    if (interaction.isAutocomplete()) {
      const mod = commands.get(interaction.commandName);
      if (!mod?.autocomplete) return;
      await mod.autocomplete(interaction, context);
      return;
    }

    if (
      interaction.isButton() ||
      interaction.isModalSubmit() ||
      interaction.isStringSelectMenu()
    ) {
      const mod = getComponentModule(interaction.customId);
      const handler = interaction.isButton()
        ? mod?.handleButton
        : interaction.isModalSubmit()
          ? mod?.handleModal
          : mod?.handleSelect;
      if (!handler) return;
      await handler(interaction, context);
    }
  } catch (err) {
    console.error(`[interaction] ${interaction.type} ${interaction.customId ?? interaction.commandName} failed:`);
    console.error(err);

    const payload = {
      embeds: [
        errorEmbed(
          'An unexpected error occurred while handling that. The details were written to the bot console.',
          'Command failed',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ embeds: payload.embeds });
      } else if (interaction.replied) {
        await interaction.followUp(payload);
      } else if (interaction.isRepliable()) {
        await interaction.reply(payload);
      }
    } catch {
      // Interaction tokens expire after 15 minutes; nothing left to do.
    }
  }
});

for (const event of ['error', 'warn']) {
  client.on(event, (info) => console[event === 'error' ? 'error' : 'warn'](`[client ${event}]`, info));
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down…`);
  activity.stopScheduler();
  modules.giveaway?.stopScheduler();
  membercount.stop();
  streams.stop();
  await client.destroy().catch(() => {});
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.login(token).catch((err) => {
  console.error('❌ Could not log in to Discord:', err.message);
  console.error('   Check that DISCORD_TOKEN in .env is the current bot token.');
  process.exit(1);
});
