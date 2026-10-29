'use strict';

/**
 * Offline checks that do not need a Discord token:
 *  - every command module loads and produces valid slash command JSON
 *  - command names are unique
 *  - component modules expose the handlers the router expects
 *  - the JSON store persists and reads back correctly
 *
 * Run with: npm run check
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const commandDir = path.join(root, 'src', 'commands');

let failures = 0;
/** Async tests report once they settle, just before the summary is printed. */
const pendingTests = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingTests.push(
        result.then(
          () => console.log(`  ✓ ${name}`),
          (err) => {
            failures += 1;
            console.error(`  ✗ ${name}`);
            console.error(`    ${err.message}`);
          },
        ),
      );
      return;
    }
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('\nCommands');
const modules = {};
const names = new Set();
const jsonByName = new Map();

for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith('.js')).sort()) {
  const key = path.basename(file, '.js');
  const mod = require(path.join(commandDir, file));
  modules[key] = mod;

  test(`${file} exports data/execute`, () => {
    assert.ok(Array.isArray(mod.data) && mod.data.length > 0, 'data must be a non-empty array');
    assert.equal(typeof mod.execute, 'function', 'execute must be a function');
  });

  for (const builder of mod.data) {
    const json = builder.toJSON();
    test(`/${json.name} has valid JSON`, () => {
      assert.ok(json.name && /^[\w-]{1,32}$/.test(json.name), 'invalid command name');
      assert.ok(typeof json.description === 'string' && json.description.length > 0, 'missing description');
      assert.ok(json.description.length <= 100, 'description too long');
      assert.ok(!names.has(json.name), 'duplicate command name');
    });
    names.add(json.name);
    jsonByName.set(json.name, json);
  }
}

console.log('\nComponent routing');
test('ticket module handles buttons and modals', () => {
  assert.equal(typeof modules.ticket.handleButton, 'function');
  assert.equal(typeof modules.ticket.handleModal, 'function');
});
test('application module handles buttons, modals and DMs', () => {
  assert.equal(typeof modules.application.handleButton, 'function');
  assert.equal(typeof modules.application.handleModal, 'function');
  assert.equal(typeof modules.application.handleDirectMessage, 'function');
});
test('application review messages offer an Open ticket button', () => {
  const [row] = modules.application.reviewComponents('A-0001');
  const buttons = row.toJSON().components;
  assert.ok(
    buttons.some((button) => button.custom_id === 'apply:ticket:A-0001'),
    'review row should include apply:ticket',
  );
  const [finalRow] = modules.application.reviewComponents('A-0001', { pending: false });
  assert.deepEqual(
    finalRow.toJSON().components.map((button) => button.custom_id),
    ['apply:ticket:A-0001'],
  );
});
test('giveaway module handles buttons', () => {
  assert.equal(typeof modules.giveaway.handleButton, 'function');
});
test('suggestion module handles buttons', () => {
  assert.equal(typeof modules.suggestion.handleButton, 'function');
  const row = modules.suggestion.voteRow({
    id: 'SUG-0001',
    upVotes: ['a'],
    downVotes: [],
  });
  assert.deepEqual(
    row.toJSON().components.map((button) => button.custom_id),
    ['suggestion:up:SUG-0001', 'suggestion:down:SUG-0001'],
  );
});
const loa = require('../src/lib/loa');
const staffguide = require('../src/lib/staffguide');
test('staff guide is categorized and covers staff commands', () => {
  assert.equal(staffguide.PREFIX, '!staffguide');
  assert.equal(typeof staffguide.handleMessage, 'function');
  const guide = staffguide.guideEmbed({
    guildId: '123',
    applications: { reviewChannelId: '456' },
  }).data;
  assert.equal(guide.fields.length, 8);
  const text = guide.fields.map((field) => `${field.name}\n${field.value}`).join('\n');
  for (const command of [
    '/ticket claim',
    '/ticket close',
    '/giveaway create',
    '!strike list',
    '/suggestion',
  ]) {
    assert.ok(text.includes(command), `guide should mention ${command}`);
  }
  for (const adminCommand of [
    '/config',
    '/application questions',
    '/application toggle',
    '/ticket panel',
    '/activity',
    '/promote',
    '/demote',
    '!strike @',
    '!strike remove',
    '/protect',
    '/kick',
  ]) {
    assert.ok(!text.includes(adminCommand), `guide should not mention ${adminCommand}`);
  }
  assert.ok(!text.toLowerCase().includes('automod'), 'guide should not mention AutoMod');
  assert.ok(guide.fields.every((field) => field.value.length <= 1024));
  const total =
    guide.title.length +
    guide.description.length +
    guide.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  assert.ok(total <= 6000, `guide is ${total} characters`);
});
test('LOA module handles the prefix, buttons and modals', () => {
  assert.equal(typeof loa.handleMessage, 'function');
  assert.equal(typeof loa.handleButton, 'function');
  assert.equal(typeof loa.handleModal, 'function');
  const [row] = loa.requestComponents({ id: 'L-0001', status: 'pending' });
  assert.deepEqual(
    row.toJSON().components.map((button) => button.custom_id),
    ['loa:accept:L-0001', 'loa:deny:L-0001'],
  );
  const [finalRow] = loa.requestComponents({ id: 'L-0001', status: 'accepted' });
  assert.ok(finalRow.toJSON().components.every((button) => button.disabled));
});
test('the rank ladder command is removed', () => {
  assert.equal(jsonByName.has('ranks'), false);
});
test('promotion and demotion embeds target the staff movement channel', () => {
  assert.equal(modules.staff.STAFF_MOVEMENT_CHANNEL_ID, '1528259332876275742');
});
test('promote and demote require a user and a role', () => {
  for (const name of ['promote', 'demote']) {
    const options = jsonByName.get(name).options;
    const required = options.filter((option) => option.required).map((option) => option.name).sort();
    assert.deepEqual(required, ['role', 'user'], `${name} should require user and role`);
    const roleOption = options.find((option) => option.name === 'role');
    assert.equal(roleOption.type, 8, `${name} role option should be a role picker`);
    assert.ok(!options.some((option) => option.name === 'rank'), `${name} should not have a rank option`);
  }
  const demote = jsonByName.get('demote');
  const currentRole = demote.options.find((option) => option.name === 'current_role');
  assert.ok(currentRole, 'demote should offer current_role');
  assert.equal(currentRole.type, 8);
  assert.equal(currentRole.required, false);
});

console.log('\nOption shape');
const strike = require('../src/lib/strike');
test('strikes are a !strike prefix command, not a slash command', () => {
  assert.equal(jsonByName.has('strike'), false, '/strike should be unregistered');
  assert.equal(strike.PREFIX, '!strike');
  assert.equal(strike.STRIKES_CHANNEL_ID, '1528258786165260358');
  assert.equal(typeof strike.handleMessage, 'function');
});
test('!strike parses the issue, list and remove forms', () => {
  const add = strike.parseStrikeCommand('!strike <@123> leaked dms to a member');
  assert.equal(add.action, 'add');
  assert.equal(add.reason, 'leaked dms to a member');
  const list = strike.parseStrikeCommand('!strike list <@123>');
  assert.equal(list.action, 'list');
  assert.deepEqual(list.words, []);
  const remove = strike.parseStrikeCommand('!strike remove <@123> s-3 appeal accepted');
  assert.equal(remove.action, 'remove');
  assert.deepEqual(remove.words, ['s-3', 'appeal', 'accepted']);
  assert.equal(strike.parseStrikeCommand('!strikes <@123> hi'), null);
});
test('!strikeremove parses the member and reason', () => {
  const parsed = strike.parseStrikeCommand('!strikeremove <@123> appeal accepted');
  assert.equal(parsed.action, 'remove-latest');
  assert.equal(parsed.reason, 'appeal accepted');
  assert.equal(strike.REMOVE_PREFIX, '!strikeremove');
  assert.equal(strike.parseStrikeCommand('!strikeremove <@123>').reason, '');
});
const honeypot = require('../src/lib/honeypot');
test('!honeypot parses setup, invite and off', () => {
  assert.equal(honeypot.PREFIX, '!honeypot');
  assert.deepEqual(honeypot.parseHoneypotCommand('!honeypot'), { action: 'setup', invite: null });
  assert.deepEqual(honeypot.parseHoneypotCommand('!honeypot off'), { action: 'off' });
  assert.deepEqual(honeypot.parseHoneypotCommand('!honeypot https://discord.gg/abc123'), {
    action: 'setup',
    invite: 'https://discord.gg/abc123',
  });
  assert.equal(honeypot.parseHoneypotCommand('!honeypots'), null);
});
test('honeypot panel tells members not to talk there', () => {
  const card = honeypot.panelCard();
  const text = card.components[0]
    .toJSON()
    .components.map((component) => component.content ?? '')
    .join('\n');
  assert.ok(text.includes('DO NOT TALK IN HERE'));
  assert.ok(/kicks you from the server/i.test(text));
  assert.ok(/DMs you an invite/i.test(text));
});
test('honeypot panel shows how many people it has kicked', () => {
  const text = (card) =>
    card.components[0]
      .toJSON()
      .components.map((component) => component.content ?? '')
      .join('\n');
  assert.match(text(honeypot.panelCard(7)), /Kicked\*\* · 7/);
  assert.match(text(honeypot.panelCard(0)), /Kicked\*\* · 0/);
  assert.match(text(honeypot.panelCard()), /immune/);
});
// Required here because this block runs before the later discord.js destructure.
const HONEY_FLAGS = require('discord.js').PermissionFlagsBits;
function hpMember({ id = 'm1', roleNames = [], perms = [] } = {}) {
  return {
    id,
    permissions: { has: (flag) => perms.includes(flag) },
    roles: {
      cache: { some: (predicate) => roleNames.some((name) => predicate({ id: name, name })) },
      highest: { position: 1 },
    },
  };
}
test('moderator level is immune regardless of the role font', () => {
  const guild = { id: 'g1', ownerId: 'owner' };
  for (const name of ['ᴍᴏᴅ', 'ꜱᴇɴɪᴏʀ ᴍᴏᴅ', 'ᴛʀɪᴀʟ ᴍᴏᴅ', 'ᴀᴅᴍɪɴ', 'ᴄᴏ-ᴏᴡɴᴇʀ', 'ᴍᴀɴᴀɢᴇʀ', 'Moderator']) {
    assert.equal(
      honeypot.isModOrAbove(hpMember({ roleNames: [name] }), guild),
      true,
      `${name} should be immune`,
    );
  }
  for (const name of ['ꜱᴛᴀꜰꜰ', 'ʜᴇʟᴘᴇʀ', 'ᴛʀɪᴀʟ ʜᴇʟᴘᴇʀ', 'ᴍᴇᴍʙᴇʀ', 'Level 25 Elite']) {
    assert.equal(
      honeypot.isModOrAbove(hpMember({ roleNames: [name] }), guild),
      false,
      `${name} should not be immune`,
    );
  }
  assert.equal(honeypot.isModOrAbove(hpMember({ id: 'owner' }), guild), true, 'the owner is immune');
  assert.equal(
    honeypot.isModOrAbove(hpMember({ perms: [HONEY_FLAGS.ModerateMembers] }), guild),
    true,
    'moderation powers count even without a matching role name',
  );
  assert.equal(
    honeypot.isModOrAbove(hpMember({ perms: [HONEY_FLAGS.ManageMessages] }), guild),
    false,
    'Manage Messages alone does not make someone a moderator',
  );
});
const HONEYPOT_CHANNEL = '🍯ʜᴏɴᴇʏᴘᴏᴛ';
const honeypotRig = ({
  roleNames = [],
  perms = [],
  botPosition = 10,
  targetPosition = 1,
  allowKick = true,
} = {}) => {
  const dms = [];
  const deleted = [];
  const kicks = [];
  const settings = {
    logChannelId: null,
    honeypot: {
      channelId: 'hp',
      channelName: HONEYPOT_CHANNEL,
      messageId: 'panel',
      inviteUrl: 'https://discord.gg/abc',
      kicks: 0,
      lastKickAt: null,
    },
  };
  const member = {
    id: 'u1',
    user: {
      username: 'tester',
      displayAvatarURL: () => 'https://cdn.example/avatar.png',
      send: async (payload) => {
        dms.push(payload);
      },
    },
    permissions: { has: (flag) => perms.includes(flag) },
    roles: {
      cache: { some: (predicate) => roleNames.some((name) => predicate({ id: name, name })) },
      highest: { position: targetPosition },
    },
    kick: async () => {
      if (!allowKick) throw new Error('Missing Permissions');
      kicks.push('u1');
    },
  };
  const channel = {
    id: 'hp',
    name: HONEYPOT_CHANNEL,
    isTextBased: () => true,
    toString: () => '<#hp>',
    messages: { fetch: async () => ({ edit: async () => {} }) },
    send: async () => ({ id: 'panel', delete: async () => {} }),
  };
  const guild = {
    id: 'g1',
    name: 'Test Server',
    ownerId: 'owner',
    channels: { cache: { get: (id) => (id === 'hp' ? channel : null), find: () => null } },
    members: {
      fetch: async () => member,
      me: {
        permissions: { has: (flag) => flag === HONEY_FLAGS.KickMembers },
        roles: { highest: { position: botPosition } },
      },
    },
    invites: { fetch: async () => new Map(), create: async () => ({ url: 'https://discord.gg/x' }) },
  };
  channel.guild = guild;
  const message = {
    id: 'm1',
    content: 'totally free nitro, click here',
    guild,
    channel,
    member,
    author: member.user,
    delete: async () => {
      deleted.push('m1');
    },
  };
  const store = { guild: () => settings, save: () => {} };
  return { message, store, settings, dms, deleted, kicks, guild, member, channel };
};
test('a message in the honeypot kicks the member and raises the count', async () => {
  const rig = honeypotRig();
  await honeypot.handleMessage(rig.message, { store: rig.store });
  assert.equal(rig.kicks.length, 1, 'the member is kicked');
  assert.equal(rig.deleted.length, 1, 'their message is removed');
  assert.equal(rig.dms.length, 1, 'they get the rejoin DM');
  assert.match(JSON.stringify(rig.dms[0]), /DO NOT TALK IN HERE/);
  assert.equal(rig.settings.honeypot.kicks, 1);
  assert.ok(rig.settings.honeypot.lastKickAt > 0);
});
test('moderators who type in the honeypot are not kicked', async () => {
  const rig = honeypotRig({ roleNames: ['ᴍᴏᴅ'], targetPosition: 2 });
  await honeypot.handleMessage(rig.message, { store: rig.store });
  assert.equal(rig.kicks.length, 0, 'no kick for a moderator');
  assert.equal(rig.deleted.length, 1, 'their message is still removed');
  assert.equal(rig.dms.length, 1, 'they are told privately');
  assert.match(JSON.stringify(rig.dms[0]), /immune/i);
  assert.equal(rig.settings.honeypot.kicks, 0, 'nothing is counted');
});
test('a blocked kick is reported but not counted', async () => {
  const rig = honeypotRig({ targetPosition: 50 });
  await honeypot.handleMessage(rig.message, { store: rig.store });
  assert.equal(rig.kicks.length, 0);
  assert.equal(rig.settings.honeypot.kicks, 0);
  assert.match(honeypot.kickBlocker(rig.guild, rig.member) ?? '', /top role/i);
});
test('a failed kick from Discord is not counted', async () => {
  const rig = honeypotRig({ allowKick: false });
  await honeypot.handleMessage(rig.message, { store: rig.store });
  assert.equal(rig.settings.honeypot.kicks, 0);
});
test('messages outside the honeypot channel are ignored', async () => {
  const rig = honeypotRig();
  const other = { ...rig.channel, id: 'general', name: '💬ɢᴇɴᴇʀᴀʟ' };
  await honeypot.handleMessage({ ...rig.message, channel: other }, { store: rig.store });
  assert.equal(rig.kicks.length, 0);
  assert.equal(rig.deleted.length, 0);
});
test('a re-created honeypot channel is adopted automatically', () => {
  const settings = { honeypot: { channelId: 'deleted', messageId: null, kicks: 3 } };
  const guild = { channels: { cache: { get: () => null } } };
  const replacement = { id: 'new', name: HONEYPOT_CHANNEL, guild };
  assert.equal(honeypot.isArmedChannel(settings, replacement), true);
  const other = { id: 'x', name: '💬ɢᴇɴᴇʀᴀʟ', guild };
  assert.equal(honeypot.isArmedChannel(settings, other), false, 'only honeypot-named channels take over');
  const live = { channels: { cache: { get: (id) => (id === 'deleted' ? {} : null) } } };
  assert.equal(
    honeypot.isArmedChannel(settings, { id: 'second', name: HONEYPOT_CHANNEL, guild: live }),
    false,
    'a working armed channel is not hijacked by a second one',
  );
  assert.equal(
    honeypot.isArmedChannel({ honeypot: { channelId: null } }, replacement),
    false,
    'a disabled honeypot stays disabled',
  );
});
test('a lost panel id reuses the panel already in the channel', async () => {
  const messages = new Map([
    ['a', { id: 'a', author: { id: 'bot' }, components: [] }],
    ['b', { id: 'b', author: { id: 'bot' }, components: [{}], edit: async () => {} }],
  ]);
  const channel = {
    isTextBased: () => true,
    client: { user: { id: 'bot' } },
    messages: { fetch: async (arg) => (typeof arg === 'object' ? messages : null) },
    send: async () => {
      throw new Error('a second panel should not be posted');
    },
  };
  const settings = { honeypot: { channelId: 'hp', messageId: 'gone', kicks: 2 } };
  assert.equal((await honeypot.ensurePanel(channel, settings, { save: () => {} })).id, 'b');
  assert.equal(settings.honeypot.messageId, 'b');
});
const steal = require('../src/lib/steal');
test('!steal reads custom emojis, animated emojis and CDN links', () => {
  assert.equal(steal.PREFIX, '!steal');
  assert.equal(steal.SHOW_MS, 3000, 'the confirmation stays for 3 seconds');
  assert.deepEqual(steal.parseStealCommand('!steal <:cat:123456789012345678>'), {
    action: 'steal',
    emoji: { animated: false, name: 'cat', id: '123456789012345678' },
  });
  assert.deepEqual(steal.parseStealCommand('!steal <a:party:987654321098765432>'), {
    action: 'steal',
    emoji: { animated: true, name: 'party', id: '987654321098765432' },
  });
  assert.equal(
    steal.parseStealCommand('!steal https://cdn.discordapp.com/emojis/123456789012345678.gif').emoji
      .animated,
    true,
  );
  assert.equal(steal.parseStealCommand('!steal').action, 'usage');
  assert.equal(steal.parseStealCommand('!steal').empty, true);
  assert.equal(steal.parseStealCommand('!steal 😀').action, 'usage', 'standard emojis cannot be stolen');
  assert.equal(steal.parseStealCommand('!stealing <:cat:123456789012345678>'), null);
  assert.equal(steal.parseStealCommand('hello'), null);
});
test('stolen emoji names are valid and unique', () => {
  assert.equal(steal.safeName('Cool Cat!'), 'Cool_Cat');
  assert.equal(steal.safeName('a'), 'a_');
  assert.equal(steal.safeName(''), 'stolen');
  assert.equal(steal.safeName('x'.repeat(60)).length, 32);
  assert.equal(steal.uniqueName('cat', new Set(['cat'])), 'cat_2');
  assert.equal(steal.uniqueName('cat', new Set(['cat', 'cat_2'])), 'cat_3');
  assert.equal(steal.uniqueName('cat', new Set(['dog'])), 'cat');
  assert.ok(steal.uniqueName('y'.repeat(32), new Set(['y'.repeat(32)])).length <= 32);
});
test('strike IDs are normalised', () => {
  assert.equal(strike.normalizeStrikeId('S-0007'), 'S-0007');
  assert.equal(strike.normalizeStrikeId('7'), 'S-0007');
  assert.equal(strike.normalizeStrikeId('s-12'), 'S-0012');
  assert.equal(strike.normalizeStrikeId('oops'), null);
});
test('/ticket has all subcommands', () => {
  const names = jsonByName.get('ticket').options.map((option) => option.name).sort();
  assert.deepEqual(names, ['add', 'claim', 'close', 'panel', 'remove']);
});
test('/application has panel, toggle and a questions group', () => {
  const app = jsonByName.get('application');
  const subs = app.options.filter((option) => option.type === 1).map((option) => option.name).sort();
  const groups = app.options.filter((option) => option.type === 2).map((option) => option.name);
  assert.deepEqual(subs, ['panel', 'toggle']);
  assert.deepEqual(groups, ['questions']);
  const questions = app.options.find((option) => option.type === 2);
  assert.deepEqual(
    questions.options.map((option) => option.name).sort(),
    ['add', 'list', 'remove'],
  );
});
test('/activity has start, end, status and auto', () => {
  const names = jsonByName.get('activity').options.map((option) => option.name).sort();
  assert.deepEqual(names, ['auto', 'end', 'start', 'status']);
});
test('/giveaway create requires prize, duration and claimtime', () => {
  const giveaway = jsonByName.get('giveaway');
  const create = giveaway.options.find((option) => option.name === 'create');
  const required = create.options
    .filter((option) => option.required)
    .map((option) => option.name)
    .sort();
  assert.deepEqual(required, ['claimtime', 'duration', 'prize']);
});
test('admin-only commands declare Manage Server defaults', () => {
  for (const name of ['activity', 'promote', 'demote', 'protect']) {
    assert.equal(jsonByName.get(name).default_member_permissions, '32', name);
  }
});
test('/kick requires Kick Members and has a user and reason', () => {
  const kick = jsonByName.get('kick');
  assert.equal(kick.default_member_permissions, '2');
  const names = kick.options.map((option) => option.name).sort();
  assert.deepEqual(names, ['reason', 'user']);
});
test('/suggestion requires the suggestion text', () => {
  const suggestion = jsonByName.get('suggestion');
  assert.equal(suggestion.options.length, 1);
  assert.equal(suggestion.options[0].name, 'suggestion');
  assert.equal(suggestion.options[0].required, true);
});

console.log('\nAutomod');
const automod = require('../src/lib/automod');
test('normal conversation is not flagged', () => {
  const result = automod.analyze({ content: 'good morning everyone, how are you?' });
  assert.equal(result.flagged, false);
});
test('free Nitro scam messages are high severity', () => {
  const result = automod.analyze({ content: 'free nitro! claim it at https://example.com/claim' });
  assert.equal(result.flagged, true);
  assert.equal(result.severity, 'high');
  assert.ok(result.reasons.some((reason) => reason.includes('Nitro')));
});
test('invite links are blocked, including obfuscated ones', () => {
  assert.equal(automod.analyze({ content: 'join https://discord.gg/abc123' }).severity, 'high');
  assert.equal(automod.analyze({ content: 'join discord dot gg/abc123' }).severity, 'high');
});
test('unknown links from members are blocked', () => {
  const result = automod.analyze({ content: 'see https://example.com/page' });
  assert.equal(result.flagged, true);
  assert.equal(result.severity, 'medium');
});
test('trusted media links are allowed', () => {
  const result = automod.analyze({ content: 'watch https://www.youtube.com/watch?v=abc' });
  assert.equal(result.flagged, false);
});
test('GIF hosts such as klipy are not suspicious', () => {
  for (const content of [
    'https://klipy.com/gifs/funny-cat',
    'https://www.klipy.com/gifs/dancing-robot-123',
    'look at this https://klipy.com/view/abc',
  ]) {
    assert.equal(automod.analyze({ content }).flagged, false, content);
  }
  assert.ok(automod.ALLOWED_DOMAINS.has('klipy.com'));
});
test('only link reasons trigger the high staff alert', () => {
  assert.equal(automod.isSuspiciousLinkReason('unapproved link (evil.example)'), true);
  assert.equal(automod.isSuspiciousLinkReason('shortened link (bit.ly)'), true);
  assert.equal(automod.isSuspiciousLinkReason('server invite link'), true);
  assert.equal(automod.isSuspiciousLinkReason('message flood (20 messages in 10s)'), false);
  assert.equal(automod.isSuspiciousLinkReason('dangerous attachment (.exe)'), false);
});
test('the suspicious link alert pings the high staff role', () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (payload) => sent.push(payload) };
  const guild = { channels: { cache: new Map([['log-1', channel]]) } };
  const message = {
    id: 'm1',
    guild,
    author: { tag: 'scammer#0001', toString: () => 'scammer#0001' },
    channel: { toString: () => '#general' },
    content: 'free nitro https://evil.example/claim',
  };
  automod.sendLinkAlert(
    message,
    { logChannelId: 'log-1', automodAlertRoleId: 'role-high', staffRoleId: 'role-staff' },
    {
      linkReasons: ['unapproved link (evil.example)'],
      links: [{ raw: 'https://evil.example/claim' }],
      action: 'message deleted',
    },
  );
  assert.equal(sent.length, 1);
  assert.ok(sent[0].content.startsWith('<@&role-high>'), 'the high staff role is pinged');
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: ['role-high'] });
  const links = sent[0].embeds[0].toJSON().fields.find((field) => field.name.includes('Links'));
  assert.ok(links.value.includes('`https://evil.example/claim`'), 'links are not clickable');
});
test('staff may post unknown links but not scam text', () => {
  assert.equal(automod.analyze({ content: 'https://example.com', isStaff: true }).flagged, false);
  assert.equal(
    automod.analyze({ content: 'free nitro https://example.com', isStaff: true }).severity,
    'high',
  );
});
test('casual chatting is not treated as spam', () => {
  const limits = automod.SPAM_LIMITS;
  assert.ok(limits.BURST_LIMIT >= 10, 'a flood has to be sustained');
  assert.ok(limits.BURST_WINDOW_MS >= 10_000, 'the burst window is a little longer');
  assert.ok(limits.DUPLICATE_LIMIT >= 5, 'repeating a message a few times is fine');
  assert.ok(limits.DUPLICATE_WINDOW_MS >= 60_000, 'repeats are measured over a minute');
  assert.equal(limits.SPAM_ESCALATION_LIMIT, 2, 'the first spam flag only removes the message');
  assert.equal(limits.SPAM_ESCALATED_TIMEOUT_MS, 10 * 60 * 1000);
});

test('admins bypass automod', () => {
  const result = automod.analyze({ content: 'free nitro https://discord.gg/abc', isAdmin: true });
  assert.equal(result.flagged, false);
});
test('dangerous attachments and mass mentions are blocked', () => {
  assert.equal(
    automod.analyze({ content: 'download this', attachmentNames: ['virus.exe'] }).severity,
    'high',
  );
  assert.equal(automod.analyze({ content: 'hello', mentionCount: 8 }).severity, 'high');
});
test('advertising with a link is blocked', () => {
  const result = automod.analyze({ content: 'join my server https://youtube.com/watch?v=1' });
  assert.equal(result.flagged, true);
  assert.ok(result.reasons.some((reason) => reason.startsWith('advertising')));
});
test('advertising is allowed in the market channels', () => {
  assert.ok(automod.MARKET_CHANNEL_IDS.has('1527957956933582969'));
  assert.ok(automod.MARKET_CHANNEL_IDS.has('1527956094964600843'));
  assert.equal(automod.isMarketChannel({ id: '1527957956933582969' }), true);
  assert.equal(automod.isMarketChannel({ id: '1527956094964600843' }), true);
  assert.equal(automod.isMarketChannel({ id: 'thread-1', parentId: '1527957956933582969' }), true);
  assert.equal(automod.isMarketChannel({ id: 'other-channel' }), false);

  const ad = 'check out my shop, selling cheap graphics https://example.com/shop';
  assert.equal(automod.analyze({ content: ad }).flagged, true);
  assert.equal(automod.analyze({ content: ad, allowAdvertising: true }).flagged, false);
  assert.equal(
    automod.analyze({ content: 'join my server https://discord.gg/abc123', allowAdvertising: true })
      .flagged,
    false,
  );
});
test('market channels still block scams, dangerous files and mass mentions', () => {
  assert.equal(
    automod.analyze({ content: 'free nitro https://example.com', allowAdvertising: true }).severity,
    'high',
  );
  assert.equal(
    automod.analyze({ content: 'free stuff', attachmentNames: ['virus.exe'], allowAdvertising: true })
      .severity,
    'high',
  );
  assert.equal(
    automod.analyze({ content: 'look at this', mentionCount: 8, allowAdvertising: true }).severity,
    'high',
  );
});

console.log('\nKick protection');
const { PermissionFlagsBits } = require('discord.js');
const protection = require('../src/lib/protection');
function fakeMember({ id, admin = false, canKick = true, position = 1, protectedRoleId = null }) {
  return {
    id,
    permissions: {
      has: (flag) =>
        flag === PermissionFlagsBits.ManageGuild
          ? admin
          : flag === PermissionFlagsBits.KickMembers
            ? canKick
            : false,
    },
    roles: {
      cache: { has: (roleId) => roleId === protectedRoleId },
      highest: { position },
    },
  };
}
test('non-admin staff cannot kick a protected member', () => {
  const guild = { ownerId: 'owner' };
  const actor = fakeMember({ id: 'staff', position: 5 });
  const target = fakeMember({ id: 'target', position: 6, protectedRoleId: 'protect-role' });
  const bot = fakeMember({ id: 'bot', position: 10 });
  const result = protection.evaluateKick({
    actor,
    target,
    bot,
    guild,
    protectionRoleId: 'protect-role',
  });
  assert.equal(result.ok, false);
  assert.equal(result.protected, true);
  assert.match(result.message, /kick protection/i);
});
test('admins can kick a protected member', () => {
  const guild = { ownerId: 'owner' };
  const actor = fakeMember({ id: 'admin', admin: true, position: 2 });
  const target = fakeMember({ id: 'target', position: 6, protectedRoleId: 'protect-role' });
  const bot = fakeMember({ id: 'bot', position: 10 });
  const result = protection.evaluateKick({
    actor,
    target,
    bot,
    guild,
    protectionRoleId: 'protect-role',
  });
  assert.equal(result.ok, true);
  assert.equal(result.protected, true);
});
test('the server owner and the bot cannot be kicked', () => {
  const guild = { ownerId: 'owner' };
  const admin = fakeMember({ id: 'admin', admin: true, position: 2 });
  const bot = fakeMember({ id: 'bot', position: 10 });
  assert.equal(
    protection.evaluateKick({
      actor: admin,
      target: fakeMember({ id: 'owner', position: 1 }),
      bot,
      guild,
      protectionRoleId: null,
    }).ok,
    false,
  );
  assert.equal(
    protection.evaluateKick({
      actor: admin,
      target: fakeMember({ id: 'bot', position: 1 }),
      bot,
      guild,
      protectionRoleId: null,
    }).ok,
    false,
  );
});
test('a bot role below the target cannot kick', () => {
  const guild = { ownerId: 'owner' };
  const actor = fakeMember({ id: 'admin', admin: true, position: 12 });
  const target = fakeMember({ id: 'target', position: 11 });
  const bot = fakeMember({ id: 'bot', position: 10 });
  assert.equal(
    protection.evaluateKick({ actor, target, bot, guild, protectionRoleId: null }).ok,
    false,
  );
});
test('staff without Kick Members cannot use /kick', () => {
  const guild = { ownerId: 'owner' };
  const actor = fakeMember({ id: 'staff', canKick: false, position: 5 });
  const target = fakeMember({ id: 'target', position: 2 });
  const bot = fakeMember({ id: 'bot', position: 10 });
  assert.equal(
    protection.evaluateKick({ actor, target, bot, guild, protectionRoleId: null }).ok,
    false,
  );
});

console.log('\nText helpers');
const { embed, EMBED_SIGNATURE } = require('../src/lib/helpers');
const { toSmallCaps } = require('../src/lib/smallcaps');
const {
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const v2 = require('../src/lib/v2');
test('every embed carries the seraphum signature', () => {
  assert.equal(EMBED_SIGNATURE, 'made by seraphum');
  assert.equal(embed({ title: 'test' }).data.footer.text, EMBED_SIGNATURE);
  assert.equal(
    embed({ title: 'test', footer: 'Existing footer' }).data.footer.text,
    `Existing footer · ${EMBED_SIGNATURE}`,
  );
  assert.equal(
    embed({ title: 'test', footer: EMBED_SIGNATURE }).data.footer.text,
    EMBED_SIGNATURE,
  );
});
test('small caps converts normal and fancy Unicode names', () => {
  assert.equal(toSmallCaps('ticket'), 'ᴛɪᴄᴋᴇᴛ');
  assert.equal(toSmallCaps('🚷𝖲𝖳𝖠𝖥𝖥-𝖱𝖴𝖫𝖤𝖲'), '🚷ꜱᴛᴀꜰꜰ-ʀᴜʟᴇꜱ');
  assert.equal(toSmallCaps('General-Tickets-123'), 'ɢᴇɴᴇʀᴀʟ-ᴛɪᴄᴋᴇᴛꜱ-123');
});
test('small caps respects Discord channel name limits', () => {
  assert.equal([...toSmallCaps('a'.repeat(150))].length, 100);
});

console.log('\nComponents V2');
test('classic embeds convert to a V2 container', () => {
  const payload = v2.convertPayload({
    embeds: [
      embed({
        title: 'V2 test',
        description: 'Converted card',
        fields: [{ name: 'Field', value: 'Value' }],
      }),
    ],
  });
  assert.ok(payload.flags & MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.content, undefined);
  assert.ok(payload.components.some((component) => component.constructor.name === 'ContainerBuilder'));
});
test('content, buttons and files survive V2 conversion', () => {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('v2:test').setLabel('Test').setStyle(ButtonStyle.Primary),
  );
  const payload = v2.convertPayload({
    content: 'Hello',
    embeds: [embed({ title: 'V2 test' })],
    components: [row],
    files: [new AttachmentBuilder(Buffer.from('test'), { name: 'test.txt' })],
  });
  const types = payload.components.map((component) => component.constructor.name);
  assert.ok(types.includes('TextDisplayBuilder'));
  assert.ok(types.includes('ActionRowBuilder'));
  assert.ok(types.includes('FileBuilder'));
});
test('V2 text stays under the 4000 character limit', () => {
  const payload = v2.convertPayload({
    embeds: [
      embed({
        title: 'Long card',
        description: 'A'.repeat(3000),
        fields: [{ name: 'Long field', value: 'B'.repeat(900) }],
      }),
    ],
  });
  const texts = [];
  const walk = (components) => {
    for (const component of components) {
      const data = component.data ?? component;
      if (data.content) texts.push(data.content);
      const children = component.components ?? data.components;
      if (children) walk(children);
    }
  };
  walk(payload.components);
  assert.ok(texts.reduce((total, text) => total + text.length, 0) <= 4000);
});
test('plain text messages stay classic so mentions ping normally', () => {
  const payload = { content: '<@123> an activity check has started' };
  assert.equal(v2.convertPayload(payload), payload);
  const reminder = { content: '⏰ <@123> we are still waiting on you !' };
  assert.equal(v2.convertPayload(reminder), reminder);
});
test('already-V2 payloads are left alone', () => {
  const payload = { components: [], flags: MessageFlags.IsComponentsV2 };
  assert.equal(v2.convertPayload(payload), payload);
});
test('embed-only V2 cards do not ping mentions', () => {
  const payload = v2.convertPayload({ embeds: [embed({ title: 'Card', description: '<@123>' })] });
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  const withContent = v2.convertPayload({
    content: '<@123> hello',
    embeds: [embed({ title: 'Card' })],
  });
  assert.equal(withContent.allowedMentions, undefined);
});
test('classic embed messages are detected for safe editing', () => {
  assert.equal(
    v2.isClassicEmbedMessage({ embeds: [{}], flags: { has: () => false } }),
    true,
  );
  assert.equal(
    v2.isClassicEmbedMessage({ embeds: [{}], flags: { has: () => true } }),
    false,
  );
  assert.equal(v2.isClassicEmbedMessage({ embeds: [], flags: { has: () => false } }), false);
  assert.equal(v2.isV2Message({ flags: { has: () => true } }), true);
  assert.equal(v2.isV2Message({ flags: { has: () => false } }), false);
  assert.equal(v2.isV2Message(undefined), false);
});
test('inline embed fields collapse into compact lines', () => {
  const payload = v2.convertPayload({
    embeds: [
      embed({
        title: 'Stats',
        fields: [
          { name: 'Staff', value: '12', inline: true },
          { name: 'Reacted', value: '8', inline: true },
          { name: 'Reason', value: 'Good work' },
        ],
      }),
    ],
  });
  const json = JSON.stringify(payload.components.map((component) => component.toJSON()));
  assert.ok(json.includes('**Staff** · 12'));
  assert.ok(json.includes('**Reacted** · 8'));
  assert.ok(json.includes('**Reason**\\nGood work'));
});

console.log('\nActivity helpers');
const activity = require('../src/lib/activity');
test('duration parser handles minutes, hours and days', () => {
  assert.equal(activity.parseDuration('30m'), 1800);
  assert.equal(activity.parseDuration('12h'), 43200);
  assert.equal(activity.parseDuration('3d'), 259200);
  assert.equal(activity.formatDuration(172800), '2d');
});
test('duration parser rejects bad or tiny values', () => {
  assert.throws(() => activity.parseDuration('24'));
  assert.throws(() => activity.parseDuration('30s'));
  assert.throws(() => activity.parseDuration('abc'));
});
test('giveaway timers accept seconds with no one-minute floor', () => {
  assert.equal(activity.parseDuration('30s', { minSeconds: 1 }), 30);
  assert.equal(activity.parseDuration('1s', { minSeconds: 1 }), 1);
  assert.equal(activity.parseDuration('90s', { minSeconds: 1 }), 90);
  assert.equal(activity.parseDuration('30m', { minSeconds: 1 }), 1800);
  assert.throws(() => activity.parseDuration('0s', { minSeconds: 1 }));
  assert.equal(activity.formatDuration(45), '45s');
  assert.equal(activity.formatDuration(90), '1m');
  assert.equal(activity.formatDuration(90, { seconds: true }), '1m 30s');
  assert.equal(activity.formatDuration(172800), '2d');
});
const activityCardText = (payload) => {
  const texts = [];
  const visit = (components) => {
    for (const component of components) {
      const data = component.data ?? component;
      if (data.content) texts.push(data.content);
      const children = component.components ?? data.components;
      if (children) visit(children);
    }
  };
  visit(payload.components[0].components);
  return texts.join('\n');
};

test('activity check builds a wide Components V2 card', () => {
  const payload = activity.buildEmbed(
    { iconURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
    {
      requiredIds: ['a', 'b'],
      loaIds: ['c'],
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      durationSeconds: 3600,
      startedBy: { tag: 'admin#0001' },
      auto: false,
    },
    new Set(['a']),
  );
  assert.ok(payload.flags & MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds, undefined);
  const container = payload.components[0];
  assert.equal(container.constructor.name, 'ContainerBuilder');

  const all = activityCardText(payload);
  assert.ok(all.includes('📊'));
  assert.ok(all.includes('50%'));
  assert.ok(all.includes('1 of 2 checked in'), 'the progress bar carries the staff count');
  assert.ok(!all.includes('👥'), 'no duplicate active-staff line');
  assert.ok(all.includes('🌴'));
  assert.ok(all.includes('made by seraphum'));
  assert.ok(all.includes('left'));
  assert.equal(all.match(/left/g).length, 1, 'time left should appear once');
  assert.ok(!all.includes('Started by'), 'the card should not show who started it');
  assert.ok(!all.includes('Not reacted'), 'the card should not show a not-reacted stat');
  assert.ok(!/<t:\d+:/.test(all), 'the card should not show raw timestamps');
  assert.ok(!all.includes('Not Reacted'));
  assert.ok(container.components.some((c) => c.constructor.name === 'SectionBuilder'));
  assert.ok(all.split('\n').length <= 9, `the card should stay wide, got ${all.split('\n').length} lines`);
});
test('remaining time reads as hours and days left', () => {
  assert.equal(activity.timeLeft(null), '—');
  assert.equal(activity.timeLeft(Date.now() + 125_000), '2m');
  assert.equal(activity.timeLeft(Date.now() + 3_605_000), '1h');
  assert.equal(activity.timeLeft(Date.now() + 2 * 86_400_000 + 5_000), '2d');
  assert.equal(activity.timeLeft(Date.now() + 25 * 3_600_000 + 5_000), '1d 1h');
  assert.equal(activity.timeLeft(Date.now() - 1_000), '0s');
});
test('starting a check pings the staff role in one message', () => {
  assert.equal(typeof activity.pingStaffStarted, 'function');
  assert.equal(typeof activity.pingStaff, 'function');
  assert.equal(activity.staffMention('role-9', ['user-1', 'user-2']), '<@&role-9>');
  assert.equal(activity.staffMention(null, ['user-1', 'user-2']), '<@user-1> <@user-2>');
  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'activity.js'), 'utf8');
  assert.ok(source.includes('await pingStaffStarted(channel, check.requiredIds, settings.staffRoleId)'));
  assert.ok(
    source.includes('await pingMissing(channel, missing)'),
    'the reminder pings the missing members, never the staff role',
  );
  assert.ok(
    !/pingMissing\([^)]*staffRoleId/.test(source),
    'the staff role is not passed to the reminder',
  );
  assert.ok(source.includes('An activity check has started!'));
  assert.ok(source.includes('we are still waiting on you !'));
});
test('the 25% reminder pings only the members who have not reacted', async () => {
  const sent = [];
  const channel = {
    send: async (payload) => {
      sent.push(payload.content);
      return {};
    },
  };
  await activity.pingMissing(channel, ['111', '222']);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('<@111>') && sent[0].includes('<@222>'));
  assert.ok(!sent[0].includes('<@&'), 'the staff role is not mentioned');
  assert.match(sent[0], /we are still waiting on you !/);

  sent.length = 0;
  await activity.pingMissing(channel, Array.from({ length: 300 }, (_, index) => `${index + 1}`));
  assert.ok(sent.length > 1, 'a long list is split across messages');
  assert.ok(sent.every((content) => content.length < 2000 && !content.includes('<@&')));
});

test('activity results resolve the high staff role', () => {
  const roles = new Map([
    ['staff', { id: 'staff', name: 'ꜱᴛᴀꜰꜰ' }],
    ['high', { id: 'high', name: 'ʜɪɢʜ ꜱᴛᴀꜰꜰ' }],
    ['alert', { id: 'alert', name: 'ᴀʟᴇʀᴛꜱ' }],
  ]);
  const guild = {
    id: 'g1',
    roles: {
      cache: {
        get: (id) => roles.get(id) ?? null,
        find: (predicate) => [...roles.values()].find(predicate),
      },
    },
  };
  assert.equal(activity.highStaffRoleFor(guild, { highStaffRoleId: 'high' }).id, 'high');
  assert.equal(
    activity.highStaffRoleFor(guild, { automodAlertRoleId: 'alert' }).id,
    'alert',
    'the AutoMod alert role is the fallback',
  );
  assert.equal(
    activity.highStaffRoleFor(guild, {}).id,
    'high',
    'a high-staff role is found by name in any font',
  );
  assert.equal(
    activity.highStaffRoleFor({ id: 'g2', roles: { cache: { get: () => null, find: () => undefined } } }, {}),
    null,
  );
});
test('the results card pings high staff and lists who missed the check', async () => {
  const sent = [];
  const channel = {
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return {};
    },
  };
  const guild = {
    id: 'g1',
    iconURL: () => null,
    roles: { cache: { get: () => ({ id: 'high' }), find: () => null } },
  };
  const settings = { highStaffRoleId: 'high' };
  const cardText = (payload) =>
    payload.components[0]
      .toJSON()
      .components.map((component) => component.content ?? '')
      .join('\n');

  const count = await activity.postResults(
    channel,
    guild,
    settings,
    { requiredIds: ['1', '2', '3'], loaIds: ['9'] },
    ['2', '3'],
  );
  assert.equal(count, 1);
  const text = cardText(sent[0]);
  assert.ok(text.includes('<@&high>'), 'the high staff role is mentioned');
  assert.ok(text.includes('<@2>') && text.includes('<@3>'), 'every missed member is listed');
  assert.ok(!text.includes('<@1>'), 'members who reacted are not listed');
  assert.deepEqual(
    sent[0].allowedMentions,
    { parse: [], roles: ['high'] },
    'only the role may notify, the member mentions are silent',
  );

  sent.length = 0;
  const many = Array.from({ length: 250 }, (_, index) => `10${index}`);
  const chunks = await activity.postResults(
    channel,
    guild,
    settings,
    { requiredIds: many, loaIds: [] },
    many,
  );
  assert.ok(chunks > 1, 'a long list is split across cards');
  assert.deepEqual(sent[1].allowedMentions, { parse: [] }, 'only the first card pings the role');
  assert.ok(sent.every((payload) => cardText(payload).length < 4000));

  sent.length = 0;
  assert.equal(
    await activity.postResults(channel, guild, settings, { requiredIds: ['1'], loaIds: [] }, []),
    0,
    'nothing is posted when everyone reacted',
  );
  assert.equal(sent.length, 0);

  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'activity.js'), 'utf8');
  assert.ok(source.includes('await postResults(channel, guild, settings, check, missing)'));
});
test('check-ins are tracked from the gateway, not polled from Discord', () => {
  const guildId = 'g1';
  let saves = 0;
  const check = {
    messageId: 'm1',
    channelId: 'c1',
    requiredIds: ['u1', 'u2'],
    loaIds: [],
    reactedIds: [],
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    durationSeconds: 300,
  };
  const ctx = {
    store: {
      data: { guilds: { [guildId]: { activity: { current: check } } } },
      guild: (id) => ctx.store.data.guilds[id],
      save: () => {
        saves += 1;
      },
    },
    client: { guilds: { cache: new Map() } },
  };
  const reaction = { message: { id: 'm1', guildId }, emoji: { name: '✅' } };

  activity.handleReaction(ctx, reaction, { id: 'u1', bot: false }, 'add');
  assert.deepEqual(check.reactedIds, ['u1'], 'the check-in is recorded immediately');
  assert.equal(saves, 1, 'and persisted without a Discord round trip');

  activity.handleReaction(ctx, reaction, { id: 'u1', bot: false }, 'remove');
  assert.deepEqual(check.reactedIds, [], 'removing the reaction clears the check-in');

  activity.handleReaction(ctx, reaction, { id: 'stranger', bot: false }, 'add');
  assert.deepEqual(check.reactedIds, [], 'non-staff reactions are ignored');

  activity.stopScheduler();
});

console.log('\nStore');
const { Store } = require('../src/store');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-store-'));
const file = path.join(tmpDir, 'data.json');
let store = new Store(file);

test('defaults are created per guild', () => {
  const guild = store.guild('123');
  assert.equal(guild.kickProtectionRoleId, null);
  assert.deepEqual(guild.protectedUsers, []);
  assert.equal('ranks' in guild, false);
  assert.equal(guild.applications.questions.length, 5);
  assert.equal(guild.counters.ticket, 0);
  assert.equal(guild.counters.giveaway, 0);
  assert.equal(guild.counters.loa, 0);
  assert.equal(guild.counters.suggestion, 0);
  assert.equal(guild.activity.enabled, false);
  assert.equal(guild.activity.loaRoleId, '1539905285789982781');
  assert.deepEqual(guild.vouches, {});
  assert.deepEqual(guild.vouchPanels, {});
  assert.equal(guild.vouchChannelId, null);
  assert.equal(guild.vouchAdminRoleId, null);
  assert.deepEqual(guild.honeypot, {
    channelId: null,
    channelName: null,
    messageId: null,
    inviteUrl: null,
    kicks: 0,
    lastKickAt: null,
  });
});
test('activity checks persist', () => {
  const guild = store.guild('123');
  guild.activity.enabled = true;
  guild.activity.current = { messageId: 'm1', channelId: 'c1', endsAt: new Date().toISOString() };
  store.save();
  store = new Store(file);
  const reloaded = store.guild('123');
  assert.equal(reloaded.activity.enabled, true);
  assert.equal(reloaded.activity.current.messageId, 'm1');
});

test('level defaults apply and the old 60s cooldown migrates once', () => {
  const fresh = store.guild('fresh');
  assert.equal(fresh.levels.enabled, true);
  assert.equal(fresh.levels.cooldownSeconds, 20, 'new servers get the 20s cooldown');
  assert.equal(fresh.levels.xpMin, 15);
  assert.equal(fresh.levels.xpMax, 25);
  assert.deepEqual(fresh.levels.users, {});

  const legacy = store.guild('legacy');
  legacy.levels.cooldownSeconds = 60;
  delete legacy.levels.cooldownChecked;
  store.save();

  const reopened = new Store(file);
  assert.equal(reopened.guild('legacy').levels.cooldownSeconds, 20, 'the old default is migrated');

  const chosen = reopened.guild('legacy');
  chosen.levels.cooldownSeconds = 60;
  chosen.levels.cooldownChecked = true;
  reopened.save();
  const again = new Store(file);
  assert.equal(again.guild('legacy').levels.cooldownSeconds, 60, 'an explicit 60 is respected afterwards');
});

test('counters increment and persist', () => {
  assert.equal(store.nextCounter('123', 'ticket'), 1);
  assert.equal(store.nextCounter('123', 'ticket'), 2);
  assert.equal(store.nextCounter('123', 'strike'), 1);
  store = new Store(file);
  assert.equal(store.guild('123').counters.ticket, 2);
});

test('tickets can be found, closed and removed', () => {
  store.addTicket('chan-1', {
    guildId: '123',
    userId: 'user-1',
    number: 1,
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  assert.equal(store.openTicketFor('123', 'user-1'), 'chan-1');
  const ticket = store.ticket('chan-1');
  ticket.status = 'closed';
  store.addTicket('chan-1', ticket);
  assert.equal(store.openTicketFor('123', 'user-1'), null);
  store.removeTicket('chan-1');
  assert.equal(store.ticket('chan-1'), null);
});

test('strikes are stored and voided', () => {
  store.addStrike('123', 'user-1', {
    id: 'S-0001',
    reason: 'test',
    severity: 'Minor',
    moderatorId: 'mod-1',
    createdAt: new Date().toISOString(),
    active: true,
  });
  assert.equal(store.strikes('123', 'user-1').length, 1);
  store.updateStrike('123', 'user-1', 'S-0001', { active: false });
  assert.equal(store.strikes('123', 'user-1')[0].active, false);

  store = new Store(file);
  assert.equal(store.strikes('123', 'user-1')[0].active, false);
});

test('applications are stored with pending lookup', () => {
  store.addApplication({
    id: 'A-0001',
    guildId: '123',
    userId: 'user-2',
    username: 'user#0001',
    answers: [{ question: 'Why?', answer: 'Because' }],
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  assert.equal(store.pendingApplicationFor('123', 'user-2').id, 'A-0001');
  store.updateApplication('A-0001', { status: 'accepted' });
  assert.equal(store.pendingApplicationFor('123', 'user-2'), null);
});

test('denied applications enforce a 2-week cooldown', () => {
  const now = Date.now();
  store.addApplication({
    id: 'A-0002',
    guildId: '123',
    userId: 'user-3',
    username: 'denied#0001',
    answers: [],
    status: 'denied',
    createdAt: new Date(now).toISOString(),
    reviewedAt: new Date(now).toISOString(),
    reapplyAt: new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(store.latestDeniedApplicationFor('123', 'user-3').id, 'A-0002');
  const cooldown = modules.application.denialCooldown(store, '123', 'user-3');
  assert.ok(cooldown, 'recent denial should block a new application');
  assert.ok(cooldown.until > now);
});

test('application tickets are looked up by application', () => {
  store.addTicket('chan-2', {
    guildId: '123',
    userId: 'user-3',
    number: 2,
    status: 'open',
    applicationId: 'A-0002',
  });
  assert.equal(store.ticketForApplication('123', 'A-0002'), 'chan-2');
  const ticket = store.ticket('chan-2');
  ticket.status = 'closed';
  store.addTicket('chan-2', ticket);
  assert.equal(store.ticketForApplication('123', 'A-0002'), null);
  store.removeTicket('chan-2');
});

test('LOA requests persist and only one can be pending', () => {
  store.addLoaRequest({
    id: 'L-0001',
    guildId: '123',
    userId: 'user-4',
    username: 'loa#0001',
    duration: '1 week',
    reason: 'vacation',
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  assert.equal(store.pendingLoaRequestFor('123', 'user-4').id, 'L-0001');
  store.updateLoaRequest('L-0001', { status: 'accepted' });
  assert.equal(store.pendingLoaRequestFor('123', 'user-4'), null);
  store = new Store(file);
  assert.equal(store.loaRequest('L-0001').status, 'accepted');
});

test('suggestions persist with staff votes', () => {
  store.addSuggestion({
    id: 'SUG-0001',
    guildId: '123',
    authorId: 'user-5',
    authorTag: 'member#0001',
    content: 'Add a movie night',
    upVotes: ['staff-1'],
    downVotes: [],
    status: 'open',
    createdAt: new Date().toISOString(),
  });
  store.updateSuggestion('SUG-0001', { downVotes: ['staff-2'] });
  store = new Store(file);
  assert.deepEqual(store.suggestion('SUG-0001').upVotes, ['staff-1']);
  assert.deepEqual(store.suggestion('SUG-0001').downVotes, ['staff-2']);
  assert.equal(store.suggestionsForGuild('123').length, 1);
});

test('giveaways persist with entries and winners', () => {
  store.addGiveaway({
    id: 'G-0001',
    guildId: '123',
    channelId: 'chan-1',
    messageId: 'msg-1',
    hostId: 'host-1',
    hostTag: 'host#0001',
    prize: 'Nitro',
    entries: ['user-1'],
    status: 'ended',
    winnerId: 'user-1',
    claimSeconds: 3600,
    endsAt: new Date().toISOString(),
    claimEndsAt: new Date().toISOString(),
  });
  store = new Store(file);
  const giveaway = store.giveaway('G-0001');
  assert.equal(giveaway.prize, 'Nitro');
  assert.deepEqual(giveaway.entries, ['user-1']);
  assert.equal(store.giveawaysForGuild('123').length, 1);
});
const giveawayModule = require('../src/commands/giveaway');
test('the winner message is one ping line plus the claim button', () => {
  const payload = giveawayModule.endedPayload({
    id: 'G-0001',
    prize: 'Nitro',
    winnerId: 'user-1',
    entries: ['user-1', 'user-2'],
    claimEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.equal(
    payload.content,
    '🎉 Congrats <@user-1>! You won **Nitro**. Press **Claim Prize** below.',
  );
  assert.equal(payload.components.length, 1, 'only the claim button row');
  const button = payload.components[0].toJSON().components[0];
  assert.equal(button.label, 'Claim Prize');
  assert.notEqual(button.disabled, true);
  assert.deepEqual(payload.allowedMentions.users, ['user-1']);

  const claimed = giveawayModule.endedPayload({
    id: 'G-0001',
    prize: 'Nitro',
    winnerId: 'user-1',
    claimedAt: new Date().toISOString(),
    ticketChannelId: 'chan-9',
  });
  assert.ok(claimed.content.includes('claimed the **Nitro** prize'));
  assert.ok(claimed.content.includes('<#chan-9>'));
  assert.equal(claimed.components[0].toJSON().components[0].disabled, true);

  const empty = giveawayModule.endedPayload({ id: 'G-0002', prize: 'Nitro', winnerId: null, entries: [] });
  assert.ok(empty.content.includes('no entries'));
  assert.deepEqual(empty.components, []);
});

test('giveaways can draw several distinct winners', () => {
  const winners = giveawayModule.drawWinners(['a', 'b', 'c', 'd'], 3);
  assert.equal(new Set(winners).size, 3, 'winners are distinct');
  assert.equal(giveawayModule.drawWinners(['a'], 5).length, 1, 'never more winners than entries');
  assert.deepEqual(giveawayModule.drawWinners([], 2), []);
  assert.equal(giveawayModule.drawWinners(['a', 'b'], 0).length, 1, 'at least one winner');
});

test('each winner claims their own prize and the button tracks the count', () => {
  const now = new Date().toISOString();
  const base = {
    id: 'G-0003',
    prize: 'Nitro',
    winnerCount: 2,
    winnerIds: ['user-1', 'user-2'],
    entries: ['user-1', 'user-2'],
    claimEndsAt: new Date(Date.now() + 60_000).toISOString(),
  };

  const open = giveawayModule.endedPayload({ ...base, claims: {} });
  assert.ok(open.content.includes('<@user-1>') && open.content.includes('<@user-2>'));
  assert.deepEqual(open.allowedMentions.users, ['user-1', 'user-2']);
  assert.equal(open.components.length, 1, 'all winners share one message and one button row');
  assert.equal(open.components[0].components.length, 1, 'exactly one claim button');
  assert.equal(open.components[0].toJSON().components[0].label, 'Claim Prize');
  assert.notEqual(open.components[0].toJSON().components[0].disabled, true);

  const half = giveawayModule.endedPayload({
    ...base,
    claims: { 'user-1': { claimedAt: now, ticketChannelId: 'chan-1' } },
  });
  assert.ok(half.content.includes('Still waiting on: <@user-2>'));
  assert.equal(half.components[0].components.length, 1, 'the same single button serves every winner');
  assert.equal(half.components[0].toJSON().components[0].label, 'Claim Prize');
  assert.notEqual(half.components[0].toJSON().components[0].disabled, true);
  assert.deepEqual(giveawayModule.unclaimedWinners({ ...base, claims: { 'user-1': { claimedAt: now } } }), [
    'user-2',
  ]);

  const done = giveawayModule.endedPayload({
    ...base,
    claims: {
      'user-1': { claimedAt: now, ticketChannelId: 'chan-1' },
      'user-2': { claimedAt: now, ticketChannelId: 'chan-2' },
    },
  });
  assert.ok(done.content.includes('<#chan-1>') && done.content.includes('<#chan-2>'));
  assert.equal(done.components[0].toJSON().components[0].disabled, true);
  assert.equal(giveawayModule.unclaimedWinners({ ...base, claims: {} }).length, 2);
});

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('\nVouches & timeouts');
const vouch = require('../src/lib/vouch');
const timeout = require('../src/lib/timeout');

const fakeMessage = (content, member = null) => ({
  content,
  mentions: { members: { first: () => member } },
});

test('a :vouch line with a mention is detected', () => {
  assert.equal(vouch.parseVouch(fakeMessage(':vouch <@1>', { id: '1' }))?.id, '1');
  assert.equal(vouch.parseVouch(fakeMessage('vouch <@1>', { id: '1' }))?.id, '1');
  assert.equal(vouch.parseVouch(fakeMessage(':vouch <@1>', { id: '1' }))?.id, '1');
  assert.equal(
    vouch.parseVouch(fakeMessage(':vouch <@1> extra words', { id: '1' }))?.id,
    '1',
    'anything after the mention is ignored',
  );
});
test('ordinary chat is not mistaken for a vouch', () => {
  assert.equal(vouch.parseVouch(fakeMessage('hello everyone', { id: '1' })), null);
  assert.equal(vouch.parseVouch(fakeMessage('I vouch for this', { id: '1' })), null);
  assert.equal(vouch.parseVouch(fakeMessage(':vouch nobody')), null);
});
test('vouch channels are detected by id or name', () => {
  const channel = (name, id = `id-${name}`) => ({ name, id, isTextBased: () => true });
  assert.equal(vouch.isVouchChannel(channel('💜ᴠᴏᴜᴄʜᴇꜱ'), { vouchChannelId: null }), true);
  assert.equal(vouch.isVouchChannel(channel('staff-vouches'), { vouchChannelId: null }), true);
  assert.equal(vouch.isVouchChannel(channel('general'), { vouchChannelId: '42' }), false);
  assert.equal(
    vouch.isVouchChannel(channel('general', '42'), { vouchChannelId: '42' }),
    true,
    'an explicitly configured channel always works',
  );
  assert.equal(
    vouch.isVouchChannel(channel('general', '99'), { staffVouchChannelId: '99' }),
    true,
    'the staff vouch channel is configured separately',
  );
});
const staffname = require('../src/lib/staffname');
function nameRig() {
  const roles = [
    { id: 'elite', name: 'Level 25 Elite', position: 16 },
    { id: 'staff', name: 'ꜱᴛᴀꜰꜰ', position: 28 },
    { id: 'helper', name: 'ʜᴇʟᴘᴇʀ', position: 30 },
    { id: 'mod', name: 'ᴍᴏᴅ', position: 34 },
    { id: 'senior', name: 'ꜱᴇɴɪᴏʀ ᴍᴏᴅ', position: 35 },
    { id: 'admin', name: 'ᴀᴅᴍɪɴ', position: 36 },
    { id: 'bots', name: 'ʙᴏᴛꜱ', position: 37 },
    { id: 'managed', name: 'ᴍᴀɴᴀɢᴇʀ', position: 38, managed: true },
    { id: 'loa', name: 'ʟᴏᴀ', position: 39 },
  ];
  const cache = new Map(roles.map((role) => [role.id, role]));
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    roles: { cache },
    members: {
      me: { permissions: { has: () => true }, roles: { highest: { position: 50 } } },
    },
  };
  const settings = { staffRoleId: 'staff', activity: { loaRoleId: 'loa' } };
  const member = (roleIds, displayName) => {
    const held = roleIds.map((id) => cache.get(id)).filter(Boolean);
    const built = {
      id: 'u1',
      displayName,
      user: { username: 'glacial' },
      guild,
      roles: {
        cache: { has: (id) => roleIds.includes(id), values: () => held,
        },
        highest: { position: Math.max(0, ...held.map((role) => role.position)) },
      },
      setNickname: async (name) => {
        built.renamed = name;
      },
    };
    return built;
  };
  return { guild, settings, member };
}
test('staff names show their rank in small caps before their normal name', () => {
  const { guild, settings, member } = nameRig();
  assert.equal(
    staffname.nicknameFor(member(['staff', 'mod'], 'Slash'), settings, guild),
    'ᴍᴏᴅ Slash',
  );
  assert.equal(
    staffname.nicknameFor(member(['staff', 'helper'], 'Slash'), settings, guild),
    'ʜᴇʟᴘᴇʀ Slash',
    'the highest held rank wins',
  );
  assert.equal(
    staffname.nicknameFor(member(['staff'], 'Slash'), settings, guild),
    'ꜱᴛᴀꜰꜰ Slash',
  );
});
test('the vouch count survives a rank prefix', () => {
  const { guild, settings, member } = nameRig();
  assert.equal(
    staffname.nicknameFor(member(['staff', 'mod'], 'Slash (4)'), settings, guild),
    'ᴍᴏᴅ Slash (4)',
  );
  // Running it again must not stack prefixes.
  assert.equal(
    staffname.nicknameFor(member(['staff', 'mod'], 'ᴍᴏᴅ Slash (4)'), settings, guild),
    'ᴍᴏᴅ Slash (4)',
  );
});
test('a promotion replaces the old rank, a demotion removes it', () => {
  const { guild, settings, member } = nameRig();
  assert.equal(
    staffname.nicknameFor(member(['staff', 'senior'], 'ᴍᴏᴅ Slash'), settings, guild),
    'ꜱᴇɴɪᴏʀ ᴍᴏᴅ Slash',
    'a promotion swaps the prefix',
  );
  assert.equal(
    staffname.nicknameFor(member(['elite'], 'ᴍᴏᴅ Slash'), settings, guild),
    'Slash',
    'losing the staff role strips the prefix',
  );
  assert.equal(
    staffname.nicknameFor(member(['elite'], 'Slash'), settings, guild),
    null,
    'a plain member is never renamed',
  );
});
test('LOA, bot and managed roles are never used as a rank', () => {
  const { guild, settings, member } = nameRig();
  assert.equal(
    staffname.nicknameFor(member(['staff', 'mod', 'loa'], 'Slash'), settings, guild),
    'ᴍᴏᴅ Slash',
    'the LOA tag is skipped',
  );
  assert.equal(
    staffname.nicknameFor(member(['staff', 'mod', 'bots', 'managed'], 'Slash'), settings, guild),
    'ᴍᴏᴅ Slash',
    'bot and managed roles are skipped',
  );
});
test('a long name is trimmed to the nickname limit', () => {
  const { guild, settings, member } = nameRig();
  const long = staffname.nicknameFor(
    member(['staff', 'mod'], 'a-very-long-display-name-here (7)'),
    settings,
    guild,
  );
  assert.ok(long.length <= 32, `${long} is ${long.length} characters`);
  assert.ok(long.startsWith('ᴍᴏᴅ '));
  assert.ok(long.endsWith('(7)'));
});
test('syncNickname renames the member once and reports it', async () => {
  const { guild, settings, member } = nameRig();
  const person = member(['staff', 'mod'], 'Slash');
  const result = await staffname.syncNickname(person, settings, guild);
  assert.equal(result.changed, true);
  assert.equal(person.renamed, 'ᴍᴏᴅ Slash');

  const again = member(['staff', 'mod'], 'ᴍᴏᴅ Slash');
  const second = await staffname.syncNickname(again, settings, guild);
  assert.equal(second.changed, false, 'no API call when the name is already right');
  assert.equal(again.renamed, undefined);
});
test('nicknames follow the Name (count) template', () => {
  assert.equal(vouch.withCount('Slash', 4), 'Slash (4)');
  assert.equal(vouch.withCount('Slash (3)', 4), 'Slash (4)');
  assert.equal(vouch.withCount('x'.repeat(40), 12).length, 32);
});
test('only owner and co-owner roles can add vouches', () => {
  const member = (list, id = '2') => ({
    id,
    roles: {
      cache: {
        has: (roleId) => list.some((role) => role.id === roleId),
        some: (predicate) => list.some(predicate),
      },
    },
  });
  assert.equal(
    vouch.canManageVouches(member([]), { ownerId: '2' }, {}),
    true,
    'the server owner can always add vouches',
  );
  assert.equal(
    vouch.canManageVouches(member([{ id: '9', name: '👑 Co-Owner' }]), { ownerId: '1' }, {}),
    true,
  );
  assert.equal(
    vouch.canManageVouches(member([{ id: '9', name: '👑 ᴄᴏ-ᴏᴡɴᴇʀ' }]), { ownerId: '1' }, {}),
    true,
    '!stafffont must not break owner detection',
  );
  assert.equal(
    vouch.canManageVouches(member([{ id: '9', name: 'Moderator' }]), { ownerId: '1' }, {}),
    false,
  );
  assert.equal(
    vouch.canManageVouches(member([{ id: '7', name: 'Staff' }]), { ownerId: '1' }, { vouchAdminRoleId: '7' }),
    true,
    'a configured vouch admin role also works',
  );
});
test('leaderboard orders the most vouched first', () => {
  const entries = vouch.leaderboardEntries({ vouches: { a: 3, b: 9, c: 0, d: 1 } });
  assert.deepEqual(entries.map((entry) => entry.id), ['b', 'a', 'd']);
  assert.equal(vouch.leaderboardEntries({ vouches: { a: 1 } }, 5).length, 1);
});
test('channel links are read from pasted URLs, mentions and bare IDs', () => {
  const { parseChannelLink } = require('../src/lib/links');
  const channel = '223456789012345678';
  assert.equal(parseChannelLink(`https://discord.com/channels/123456789012345678/${channel}`), channel);
  assert.equal(
    parseChannelLink(`https://canary.discord.com/channels/123456789012345678/${channel}?foo=1`),
    channel,
    'canary links and query strings work',
  );
  assert.equal(
    parseChannelLink(`https://discordapp.com/channels/123456789012345678/${channel}`),
    channel,
    'old discordapp links work',
  );
  assert.equal(parseChannelLink(`<#${channel}>`), channel, 'channel mentions work');
  assert.equal(parseChannelLink(channel), channel, 'bare IDs work');
  assert.equal(parseChannelLink(` ${channel} `), channel, 'whitespace is trimmed');
  assert.equal(parseChannelLink('https://discord.com/channels/123456789012345678'), null, 'no channel in the link');
  assert.equal(parseChannelLink('https://example.com/channels/1/2'), null, 'wrong site');
  assert.equal(parseChannelLink('log channel please'), null);
  assert.equal(parseChannelLink(''), null);
  assert.equal(parseChannelLink(undefined), null);
});

test('/config set offers a link option next to every channel picker', () => {
  const configJson = modules.config.data[0].toJSON();
  const setJson = configJson.options.find((option) => option.name === 'set');
  const names = setJson.options.map((option) => option.name);

  for (const key of [
    'log_channel',
    'ticket_category',
    'transcript_channel',
    'application_review_channel',
    'vouch_channel',
    'staff_vouch_channel',
  ]) {
    assert.ok(names.includes(key), `${key} picker is still there`);
    assert.ok(names.includes(`${key}_link`), `${key}_link is missing`);
  }

  assert.equal(
    configJson.options.some((option) => option.name === 'link'),
    false,
    'links live inside /config set, not a separate subcommand',
  );
  for (const option of setJson.options.filter((entry) => entry.name.endsWith('_link'))) {
    assert.equal(option.type, 3, `${option.name} must be a string option so a link can be pasted`);
    assert.ok(option.name.length <= 32, `${option.name} is too long`);
    assert.ok(option.description.length <= 100, `${option.name} description is too long`);
  }
});

test('a pasted link is resolved to a real channel of the right type', async () => {
  const configModule = require('../src/commands/config');
  const { ChannelType } = require('discord.js');
  const text = { id: '223456789012345678', name: 'bot-logs', type: ChannelType.GuildText };
  const category = { id: '323456789012345678', name: 'Tickets', type: ChannelType.GuildCategory };
  const guild = {
    channels: {
      cache: new Map([[text.id, text], [category.id, category]]),
      fetch: async () => null,
    },
  };

  const logLink = `https://discord.com/channels/123456789012345678/${text.id}`;
  const logResult = await configModule.resolveChannel(guild, logLink, configModule.LINK_SETTINGS.log_channel);
  assert.equal(logResult.channel?.id, text.id, 'the log channel resolves from a pasted link');

  const categoryResult = await configModule.resolveChannel(
    guild,
    `<#${category.id}>`,
    configModule.LINK_SETTINGS.ticket_category,
  );
  assert.equal(categoryResult.channel?.id, category.id, 'a category resolves too');

  const wrongType = await configModule.resolveChannel(
    guild,
    logLink,
    configModule.LINK_SETTINGS.ticket_category,
  );
  assert.match(wrongType.error, /not a \*\*category\*\*/);

  const unknown = await configModule.resolveChannel(
    guild,
    'https://discord.com/channels/123456789012345678/999456789012345678',
    configModule.LINK_SETTINGS.log_channel,
  );
  assert.match(unknown.error, /no channel with the ID/);

  const garbage = await configModule.resolveChannel(guild, 'the log channel', configModule.LINK_SETTINGS.log_channel);
  assert.match(garbage.error, /not a channel link/);
});

test('plain names find fancy-styled roles for pinging', () => {
  const { findRole, roleKey } = require('../src/lib/roleping');
  const { toSmallCaps } = require('../src/lib/smallcaps');
  const guild = {
    id: 'g',
    roles: {
      cache: new Map(
        [
          { id: 'g', name: '@everyone' },
          { id: 'staff', name: toSmallCaps('Staff') },
          { id: 'mod', name: toSmallCaps('Moderator') },
          { id: 'co', name: `👑 ${toSmallCaps('Co-Owner')}` },
          { id: 'botrole', name: toSmallCaps('SomeBot'), managed: true },
        ].map((role) => [role.id, { ...role, managed: Boolean(role.managed) }]),
      ),
    },
  };

  assert.equal(roleKey('Co-Owner'), roleKey(`👑 ${toSmallCaps('Co-Owner')}`), 'emoji and font are ignored');
  assert.equal(findRole(guild, 'staff').role?.id, 'staff', 'plain lowercase works');
  assert.equal(findRole(guild, 'STAFF').role?.id, 'staff', 'any case works');
  assert.equal(findRole(guild, 'ꜱᴛᴀꜰꜰ').role?.id, 'staff', 'the fancy name still works');
  assert.equal(findRole(guild, 'co owner').role?.id, 'co', 'spaces match hyphens');
  assert.equal(findRole(guild, 'mode').role?.id, 'mod', 'a unique prefix is enough');
  assert.equal(findRole(guild, 'somebot').role, null, 'bot roles are skipped');
  assert.equal(findRole(guild, 'everyone').role, null, '@everyone is skipped');
  assert.equal(findRole(guild, 'nonsense').role, null);
  assert.equal(findRole(guild, '').role, null);
});

test('a readable staff font keeps @staff autocompleting', () => {
  const rolefont = require('../src/lib/rolefont');
  const { toSmallCaps } = require('../src/lib/smallcaps');
  const staff = { id: 'staff', name: 'Staff', position: 5, managed: false };

  const readable = rolefont.planRenames([staff], { everyoneId: 'g', readable: true });
  assert.equal(readable[0].to, `${toSmallCaps('Staff')} (Staff)`);

  const already = rolefont.planRenames(
    [{ ...staff, name: readable[0].to }],
    { everyoneId: 'g', readable: true },
  );
  assert.deepEqual(already, [], 'running it twice changes nothing');

  const backToPure = rolefont.planRenames(
    [{ ...staff, name: readable[0].to }],
    { everyoneId: 'g', readable: false },
  );
  assert.equal(backToPure[0].to, toSmallCaps('Staff'), 'plain !stafffont strips the alias again');

  const fromPure = rolefont.planRenames(
    [{ ...staff, name: toSmallCaps('Staff') }],
    { everyoneId: 'g', readable: true },
  );
  assert.equal(
    fromPure[0].to,
    `${toSmallCaps('Staff')} (Staff)`,
    'an already-styled role gets a plain alias, not a doubled fancy one',
  );

  const coOwner = { id: 'co', name: `👑 ${toSmallCaps('Co-Owner')}`, position: 9, managed: false };
  const coReadable = rolefont.planRenames([coOwner], { everyoneId: 'g', readable: true });
  assert.equal(coReadable[0].to, `👑 ${toSmallCaps('Co-Owner')} (Co-Owner)`, 'emoji stay, alias is plain');
  assert.deepEqual(
    rolefont.planRenames(
      [{ ...coOwner, name: coReadable[0].to }],
      { everyoneId: 'g', readable: true },
    ),
    [],
    'the alias is not stacked twice',
  );

  const genuineBrackets = { id: 'eu', name: 'Staff (EU)', position: 5, managed: false };
  assert.equal(rolefont.splitAlias('Staff (EU)').alias, null, 'real brackets are left alone');
  assert.equal(
    rolefont.planRenames([genuineBrackets], { everyoneId: 'g' })[0].to,
    `${toSmallCaps('Staff')} (ᴇᴜ)`,
  );
});

test('staff role names map to a rung of the icon ladder', () => {
  const { levelForRole } = require('../src/lib/roleicons');
  const { toSmallCaps } = require('../src/lib/smallcaps');

  assert.equal(levelForRole('Owner').id, 'owner');
  assert.equal(levelForRole(toSmallCaps('Owner')).id, 'owner', 'font is ignored');
  assert.equal(levelForRole('👑 Co-Owner').id, 'coowner', 'co-owner is not mistaken for owner');
  assert.equal(levelForRole('Administrator').id, 'admin');
  assert.equal(levelForRole('Head Admin').id, 'head', 'head wins over admin');
  assert.equal(levelForRole('Senior Moderator').id, 'senior', 'senior wins over moderator');
  assert.equal(levelForRole('Trial Moderator').id, 'trial', 'trial wins over moderator');
  assert.equal(levelForRole('Moderator').id, 'mod');
  assert.equal(levelForRole('Helper').id, 'helper');
  assert.equal(levelForRole('Staff Team').id, 'staff');
  assert.equal(levelForRole('Member'), null);
  assert.equal(levelForRole('Vouched'), null);
});

test('the icon plan skips members, bot roles and roles above the bot', () => {
  const { buildPlan } = require('../src/lib/roleicons');
  const guild = {
    id: 'g',
    emojis: {
      cache: {
        find: (predicate) =>
          [{ id: '900', name: 'admin', imageURL: () => 'https://cdn/900.png' }].find(predicate) ?? null,
      },
    },
    members: { me: { roles: { highest: { position: 20 } } } },
    roles: {
      cache: {
        values: () =>
          [
            { id: 'g', name: '@everyone', position: 0, managed: false },
            { id: 'member', name: 'Member', position: 1, managed: false },
            { id: 'staff', name: 'Staff', position: 5, managed: false },
            { id: 'admin', name: 'Admin', position: 10, managed: false },
            { id: 'owner', name: 'Owner', position: 25, managed: false },
            { id: 'botrole', name: 'SomeBot', position: 12, managed: true },
          ][Symbol.iterator](),
        get: (id) => null,
      },
    },
  };
  const plan = buildPlan(guild, { staffRoleId: 'staff' });

  assert.deepEqual(plan.planned.map((entry) => entry.role.id), ['admin', 'staff'], 'highest first');
  assert.equal(plan.planned[0].emoji?.name, 'admin', 'server emoji art is picked up');
  assert.equal(plan.planned[1].emoji, null, 'no server art for staff');
  assert.equal(plan.planned[1].source, 'icon', 'the bundled custom icon wins');
  assert.match(plan.planned[1].iconPath, /staff\.png$/);
  assert.deepEqual(plan.blocked.map((entry) => entry.role.id), ['owner'], 'owner sits above the bot');
  assert.deepEqual(plan.skipped.map((role) => role.id), ['member'], 'non-staff roles are skipped');
});

test('role icons apply as emoji when no server art exists', async () => {
  const { applyIcon } = require('../src/lib/roleicons');
  const calls = [];
  const role = {
    name: 'Staff',
    setUnicodeEmoji: async (emoji) => calls.push(['unicode', emoji]),
    setIcon: async () => calls.push(['icon']),
  };

  const method = await applyIcon({ role, level: { emoji: '⭐' }, emoji: null });
  assert.deepEqual(calls, [['unicode', '⭐']]);
  assert.match(method, /⭐/);

  // The bundled PNG is uploaded as the icon, not treated as an emoji.
  const imageCalls = [];
  const imageRole = {
    setUnicodeEmoji: async () => {},
    setIcon: async (buffer) => imageCalls.push(buffer),
  };
  const { iconFile } = require('../src/lib/roleicons');
  const staffIcon = iconFile({ id: 'staff' });
  assert.ok(staffIcon, 'assets/role-icons/staff.png should exist');
  const imageMethod = await applyIcon({
    role: imageRole,
    level: { id: 'staff', emoji: '⭐' },
    emoji: null,
    iconPath: staffIcon,
  });
  assert.equal(imageCalls.length, 1);
  assert.ok(Buffer.isBuffer(imageCalls[0]));
  assert.equal(imageCalls[0].subarray(0, 4).toString('hex'), '89504e47', 'a real PNG is uploaded');
  assert.match(imageMethod, /custom icon/);

  const { emojiTag } = require('../src/lib/roleicons');
  assert.equal(emojiTag({ id: '900', name: 'admin' }), '<:admin:900>');
  assert.equal(emojiTag({ id: '901', name: 'fire', animated: true }), '<a:fire:901>');
  assert.equal(emojiTag(null), '');
});

test('the level curve gets steeper each level', () => {
  const levels = require('../src/lib/levels');
  assert.equal(levels.xpForLevel(0), 100);
  assert.equal(levels.xpForLevel(1), 155);
  assert.equal(levels.xpForLevel(2), 220);
  assert.equal(levels.totalXpForLevel(2), 255, 'reaching level 2 takes 100 + 155');

  assert.deepEqual(
    [levels.levelFromXp(0).level, levels.levelFromXp(99).level, levels.levelFromXp(100).level],
    [0, 0, 1],
  );
  const level2 = levels.levelFromXp(255);
  assert.equal(level2.level, 2);
  assert.equal(level2.xpIntoLevel, 0);
  assert.equal(level2.xpForNext, 220);
  assert.equal(levels.levelFromXp(-50).totalXp, 0, 'negative XP is clamped');
  assert.equal(levels.levelFromXp('nonsense').level, 0);
});

test('messages earn XP once per cooldown', () => {
  const levels = require('../src/lib/levels');
  const settings = {
    levels: {
      enabled: true,
      announce: true,
      announceChannelId: null,
      xpMin: 20,
      xpMax: 20,
      cooldownSeconds: 60,
      users: {},
    },
  };
  const store = { guild: () => settings, save: () => {} };
  const message = (id = 'u1') => ({
    guild: { id: 'g' },
    channel: { id: 'c1', isTextBased: () => true, isDMBased: () => false },
    author: { id, bot: false },
  });

  const first = levels.awardMessage(message(), store);
  assert.equal(first.gained, 20);
  assert.equal(settings.levels.users.u1.xp, 20);
  assert.equal(settings.levels.users.u1.messages, 1);
  assert.equal(first.levelUp, null, 'one message is not a level');

  const second = levels.awardMessage(message(), store);
  assert.equal(second, null, 'cooldown blocks the XP');
  assert.equal(settings.levels.users.u1.xp, 20, 'XP unchanged');
  assert.equal(settings.levels.users.u1.messages, 2, 'the message still counts');

  settings.levels.users.u1.lastAt = Date.now() - 120_000;
  const third = levels.awardMessage(message(), store);
  assert.equal(third.gained, 20, 'XP resumes after the cooldown');

  const bot = levels.awardMessage({ ...message('b1'), author: { id: 'b1', bot: true } }, store);
  assert.equal(bot, null, 'bots never earn XP');

  settings.levels.enabled = false;
  assert.equal(levels.awardMessage(message('u2'), store), null, 'the system can be switched off');
});

test('crossing a threshold reports a level-up', () => {
  const levels = require('../src/lib/levels');
  const settings = {
    levels: { enabled: true, announce: true, xpMin: 30, xpMax: 30, cooldownSeconds: 0, users: { u1: { xp: 90, messages: 5, lastAt: 0 } } },
  };
  const store = { guild: () => settings, save: () => {} };
  const result = levels.awardMessage(
    { guild: { id: 'g' }, channel: { id: 'c1', isTextBased: () => true, isDMBased: () => false }, author: { id: 'u1', bot: false } },
    store,
  );
  assert.equal(result.levelUp.level, 1, '120 XP passes the 100 XP threshold');
  assert.equal(result.levelUp.xpIntoLevel, 20);
  assert.equal(result.levelUp.xpForNext, 155);
});

test('the leaderboard orders by XP and rank cards show progress', () => {
  const levels = require('../src/lib/levels');
  const settings = {
    levels: {
      users: {
        a: { xp: 400, messages: 40 },
        b: { xp: 900, messages: 12 },
        c: { xp: 0, messages: 0 },
      },
    },
  };
  assert.deepEqual(levels.entries(settings).map((entry) => entry.id), ['b', 'a'], 'most XP first, empty records skipped');
  assert.equal(levels.positionOf(settings, 'a'), 2);
  assert.equal(levels.positionOf(settings, 'nobody'), null);

  const member = {
    id: 'a',
    user: { username: 'Frost' },
    displayAvatarURL: () => 'https://cdn/avatar.png',
  };
  const card = levels.rankCard({ name: 'Arcane' }, settings, member);
  const text = textOf(card);
  assert.ok(text.includes('LEVEL 2'), '400 XP is level 2');
  assert.ok(text.includes('rank #2'), 'shows the leaderboard place');
  assert.ok(/\d+\/\d+ XP/.test(text), 'shows XP progress');
  assert.ok(text.includes('made by seraphum'));

  const top = textOf(levels.leaderboardCard({ name: 'Arcane', iconURL: () => null }, settings));
  assert.ok(top.includes('<@b>') && top.includes('Level 4'), 'leaderboard shows levels (900 XP)');
  assert.ok(!top.includes('<@c>'), 'members without XP are hidden');
});

test('only the owner and co-owner can set XP', async () => {
  const { execute } = require('../src/commands/level');

  // Both subcommands are gated, so an admin without a co-owner role gets
  // a refusal and no write, for settings as well as setxp.
  const replies = [];
  const settingsStore = {
    guild: () => ({ levels: { enabled: true } }),
    save: () => assert.fail('nothing may be saved'),
  };
  const admin = {
    id: 'admin',
    permissions: 8n,
    roles: { cache: { has: () => false, some: () => false } },
  };
  await execute(
    {
      guild: { id: 'g', ownerId: 'nemino', name: 'Nemino Nation' },
      member: admin,
      options: {
        getSubcommand: () => 'settings',
        getBoolean: () => true,
        getChannel: () => null,
        getInteger: () => 10,
      },
      reply: async (payload) => replies.push(payload),
    },
    { store: settingsStore },
  );

  assert.equal(replies.length, 1, 'the admin is refused');
  assert.match(JSON.stringify(replies[0]), /co-owner/, 'the refusal explains who can');

  runXpChecks();
});

function runXpChecks() {
  const { canSetXp } = require('../src/commands/level');
  const { toSmallCaps } = require('../src/lib/smallcaps');
  const guild = { id: 'g', ownerId: 'nemino' };
  const member = (id, roles = [], permissions = 0n) => ({
    id,
    permissions,
    roles: {
      cache: {
        has: (id) => roles.some((role) => role.id === id),
        some: (predicate) => roles.some(predicate),
      },
    },
  });

  assert.equal(canSetXp(member('nemino'), guild), true, 'the server owner always can');
  assert.equal(
    canSetXp(member('co', [{ id: 'co', name: `💎 ${toSmallCaps('Co-Owner')}` }]), guild),
    true,
    'a small-capped co-owner role still counts',
  );
  assert.equal(canSetXp(member('co2', [{ id: 'co2', name: 'Co Owner' }]), guild), true);
  assert.equal(
    canSetXp(member('admin', [{ id: 'a', name: 'Admin' }], 8n), guild),
    false,
    'Manage Server is not enough anymore',
  );
  assert.equal(canSetXp(member('mod', [{ id: 'm', name: 'Moderator' }]), guild), false);
  assert.equal(canSetXp(member('helper'), { id: 'g', ownerId: 'nemino' }), false, 'no roles means no access');
  assert.equal(canSetXp(null, guild), false, 'no member is refused');
}

test('!purge reads whole numbers and caps staff at 50', () => {
  const purge = require('../src/lib/purge');
  const guild = { id: 'g', ownerId: 'nemino' };
  const member = (id, roles = []) => ({
    id,
    roles: { cache: { has: () => false, some: (predicate) => roles.some(predicate) } },
  });

  assert.equal(purge.parseAmount('25'), 25);
  assert.equal(purge.parseAmount(' 7 '), 7);
  assert.equal(purge.parseAmount('0'), null, 'zero is not a purge');
  assert.equal(purge.parseAmount('-5'), null);
  assert.equal(purge.parseAmount('abc'), null);
  assert.equal(purge.parseAmount('1e3'), null);
  assert.equal(purge.parseAmount(''), null);

  assert.equal(purge.capFor(member('staff'), guild), 50, 'staff are capped at 50');
  assert.equal(purge.capFor(member('nemino'), guild), 1000, 'the owner is not capped at 50');
  assert.equal(
    purge.capFor(member('co', [{ id: 'co', name: '👑 ᴄᴏ-ᴏᴡɴᴇʀ' }]), guild),
    1000,
    'a co-owner is not capped at 50 either',
  );
});

test('!purge deletes in Discord-sized batches and refuses oversized staff purges', async () => {
  const purge = require('../src/lib/purge');
  const { PermissionFlagsBits } = require('discord.js');
  const guild = { id: 'g', ownerId: 'nemino' };
  const now = Date.now();

  const channelWith = (count, oldIndices = []) => {
    const individually = [];
    const messages = Array.from({ length: count }, (_, index) => ({
      id: String(9000 - index),
      createdTimestamp: oldIndices.includes(index) ? now - 15 * 86_400_000 : now - index * 1000,
      delete: async () => {
        individually.push(String(9000 - index));
      },
    }));
    const batches = [];
    return {
      batches,
      individually,
      isTextBased: () => true,
      messages: {
        fetch: async ({ limit, before }) => {
          const start = before ? messages.findIndex((entry) => entry.id === before) + 1 : 0;
          const slice = messages.slice(start, start + limit);
          const map = new Map(slice.map((entry) => [entry.id, entry]));
          return {
            size: map.size,
            values: () => map.values(),
            last: () => slice[slice.length - 1],
          };
        },
      },
      bulkDelete: async (chunk) => {
        batches.push(chunk.map((entry) => entry.id));
        return { size: chunk.length };
      },
      send: async () => ({ delete: async () => {} }),
    };
  };

  const run = async ({ id, roles = [], amount, channel }) => {
    const replies = [];
    await purge.handleMessage({
      id: 'cmd',
      content: `!purge ${amount}`,
      guild,
      channel,
      author: { username: 'Tester' },
      member: {
        id,
        permissions: { has: (flag) => flag === PermissionFlagsBits.ManageMessages },
        roles: { cache: { has: () => false, some: (predicate) => roles.some(predicate) } },
      },
      reply: async (payload) => replies.push(payload),
      delete: async () => {},
    });
    return replies;
  };

  const refusedChannel = channelWith(20);
  const refused = await run({ id: 'staff', amount: 60, channel: refusedChannel });
  assert.equal(refusedChannel.batches.length, 0, 'nothing is deleted when the cap is hit');
  assert.match(JSON.stringify(refused[0]), /up to \*\*50\*\*/);

  const channel = channelWith(400);
  await run({ id: 'nemino', amount: 150, channel });
  assert.deepEqual(
    channel.batches.map((batch) => batch.length),
    [100, 50],
    'Discord only takes 100 ids per call, so the purge is split',
  );
  assert.equal(channel.individually.length, 0);

  // Messages past Discord's 14-day bulk window are deleted one by one, never skipped.
  const withOld = channelWith(60, [48, 49]);
  await run({ id: 'nemino', amount: 50, channel: withOld });
  assert.equal(withOld.individually.length, 2, 'old messages are still removed');
  assert.equal(
    withOld.batches.reduce((total, batch) => total + batch.length, 0) + withOld.individually.length,
    50,
    'every requested message is deleted, however old',
  );
});

test('slash commands only re-register when they actually changed', () => {
  const { canonical, diffCommands } = require('../src/lib/commandsync');
  const local = [
    { name: 'level', description: 'Levels earned by chatting', options: [{ type: 1, name: 'rank' }] },
    { name: 'ping', description: 'Check that the bot is alive' },
  ];
  const remote = [
    { id: '1', application_id: '2', version: '3', ...local[0] },
    { id: '4', application_id: '2', version: '5', ...local[1] },
  ];

  assert.equal(diffCommands(local, remote).identical, true, 'ids and versions are ignored');
  assert.equal(canonical(local[1]), canonical(remote[1]));

  const added = diffCommands([...local, { name: 'rank', description: 'x' }], remote);
  assert.deepEqual(added.added, ['rank']);
  assert.equal(added.identical, false);

  const changed = diffCommands(
    [{ ...local[1], description: 'Changed' }, local[0]],
    remote,
  );
  assert.deepEqual(changed.changed, ['ping'], 'a description edit counts as a change');

  const removed = diffCommands([local[1]], remote);
  assert.deepEqual(removed.removed, ['level']);
});

test('nickname updates explain why Discord refuses them', () => {
  const { PermissionFlagsBits } = require('discord.js');
  const build = ({ has = true, mine = 10, theirs = 1, ownerId = 'owner' } = {}) => {
    const guild = {
      ownerId,
      members: {
        me: { permissions: { has: (flag) => has && flag === PermissionFlagsBits.ManageNicknames }, roles: { highest: { position: mine } } },
      },
    };
    return { id: 'user', guild, setNickname() {}, roles: { highest: { position: theirs } } };
  };

  assert.equal(vouch.nicknameBlocker(build()), null, 'a normal member can be renamed');
  assert.match(vouch.nicknameBlocker(build({ has: false })), /Manage Nicknames/);
  assert.match(
    vouch.nicknameBlocker(build({ ownerId: 'user' })),
    /server owner/,
    'the owner can never be renamed',
  );
  assert.match(
    vouch.nicknameBlocker(build({ mine: 5, theirs: 5 })),
    /above mine/,
    'a role at the bot level blocks the rename',
  );
});

test('staff roles are planned in small caps and nothing else is touched', () => {
  const rolefont = require('../src/lib/rolefont');
  const { toSmallCaps } = require('../src/lib/smallcaps');
  const roles = [
    { id: 'everyone', name: '@everyone', position: 0, managed: false },
    { id: 'member', name: 'Member', position: 1, managed: false },
    { id: 'staff', name: 'Staff', position: 5, managed: false },
    { id: 'mod', name: 'Moderator', position: 7, managed: false },
    { id: 'botrole', name: 'SomeBot', position: 9, managed: true },
    { id: 'done', name: toSmallCaps('Admin'), position: 8, managed: false },
  ];

  const plan = rolefont.planRenames(roles, { everyoneId: 'everyone', botPosition: 20, staffPosition: 5 });
  assert.deepEqual(plan.map((entry) => entry.id), ['mod', 'staff'], 'highest first, member/@everyone/managed skipped');
  assert.equal(plan[0].to, toSmallCaps('Moderator'));
  assert.ok(plan.every((entry) => entry.blocked === null));
  assert.equal(
    rolefont.planRenames(roles, { everyoneId: 'everyone' }).some((entry) => entry.id === 'member'),
    true,
    'without a staff floor every role is fair game',
  );

  const blocked = rolefont.planRenames(
    [{ id: 'owner', name: 'Owner', position: 20, managed: false }],
    { everyoneId: 'everyone', botPosition: 10 },
  );
  assert.match(blocked[0].blocked, /move my bot role above it/);
});

test('timeout times accept minutes, hours, days and weeks', () => {
  assert.equal(timeout.parseTimeoutTime('10'), 600_000);
  assert.equal(timeout.parseTimeoutTime('10m'), 600_000);
  assert.equal(timeout.parseTimeoutTime('2h'), 7_200_000);
  assert.equal(timeout.parseTimeoutTime('1d'), 86_400_000);
  assert.equal(timeout.parseTimeoutTime('29d'), null, 'Discord caps timeouts at 28 days');
  assert.equal(timeout.parseTimeoutTime('30s'), null, 'the minimum is one minute');
  assert.equal(timeout.parseTimeoutTime('soon'), null);
});
test('timeout durations are shown in a short form', () => {
  assert.equal(timeout.formatTimeout(600_000), '10m');
  assert.equal(timeout.formatTimeout(7_200_000), '2h');
  assert.equal(timeout.formatTimeout(90_000_000), '1d 1h');
});

console.log('\nWelcome & member counter');
const welcome = require('../src/lib/welcome');
const membercount = require('../src/lib/membercount');

function textOf(payload) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'object' && typeof node.toJSON === 'function') return walk(node.toJSON());
    if (typeof node === 'object') {
      if (typeof node.content === 'string') parts.push(node.content);
      if (node.accessory && typeof node.accessory.media?.url === 'string') {
        parts.push(node.accessory.media.url);
      }
      if (typeof node.media?.url === 'string') parts.push(node.media.url);
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') walk(value);
      }
    }
  };
  walk(payload.components);
  return parts.join('\n');
}

const welcomeGuild = {
  name: 'Nemino Nation',
  memberCount: 747,
  rulesChannel: { id: 'rules-1' },
  channels: {
    cache: {
      get: (id) => (id === 'general-1' ? { id, isTextBased: () => true, name: '💬general' } : null),
      find: (predicate) =>
        [{ id: 'general-1', isTextBased: () => true, name: '💬general' }].find(predicate) ?? null,
    },
  },
};

const welcomeMember = {
  id: 'u-1',
  joinedAt: new Date('2026-10-25T12:00:00Z'),
  user: {
    id: 'u-1',
    tag: 'newbie#0001',
    createdAt: new Date('2024-01-02T00:00:00Z'),
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/u-1/a.png',
    toString: () => '<@u-1>',
  },
};

test('the welcome card is one wide container with the profile and join time', () => {
  const payload = welcome.welcomeCard(welcomeMember, welcomeGuild, 747);
  assert.ok(payload.flags & 32768, 'card should be Components V2');
  assert.equal(payload.components.length, 1, 'one container keeps it wide instead of stacked');
  assert.equal(payload.embeds, undefined, 'no legacy embed is used');
  assert.equal(payload.content, undefined, 'V2 messages reject a content field');
  const text = textOf(payload);
  assert.ok(text.includes('<@u-1>'), 'mentions the new member');
  assert.ok(text.includes('member #747'), 'shows the member number');
  assert.equal((text.match(/747/g) ?? []).length, 1, 'the member number appears once, not twice');
  assert.ok(text.includes('Joined'), 'shows the join line');
  assert.ok(text.includes('avatars/u-1/a.png'), 'uses their avatar');
  assert.ok(!text.includes('newbie#0001'), 'no tag line');
  assert.ok(!text.includes('Account age'), 'no account age line');
  assert.ok(!text.includes('🆔'), 'no user id line');
  assert.ok(text.includes('made by seraphum'), 'keeps the signature');
  assert.ok(text.includes('WELCOME TO'), 'has a title');
});

test('the welcome channel resolves from settings first', () => {
  const channel = (id) => ({ id, isTextBased: () => true, name: '👋ᴡᴇʟᴄᴏᴍᴇ' });
  const guild = {
    channels: {
      cache: {
        get: (id) => (id === 'chan-9' ? channel('chan-9') : null),
        find: (predicate) => [channel('chan-7')].find(predicate) ?? null,
      },
    },
  };
  assert.equal(welcome.resolveWelcomeChannel(guild, { welcomeChannelId: 'chan-9' }).id, 'chan-9');
  assert.equal(
    welcome.resolveWelcomeChannel(guild, {}).id,
    'chan-7',
    'falls back to a #welcome-named channel',
  );

  const withDefault = {
    channels: {
      cache: {
        get: (id) => (id === welcome.DEFAULT_WELCOME_CHANNEL_ID ? channel(id) : null),
        find: () => null,
      },
    },
  };
  assert.equal(
    welcome.resolveWelcomeChannel(withDefault, {}).id,
    welcome.DEFAULT_WELCOME_CHANNEL_ID,
    'uses the default welcome channel id',
  );
});

test('the member counter name follows Members - (amount)', () => {
  assert.equal(membercount.countChannelName('Members - {count}', 747), 'Members - 747');
  assert.equal(membercount.countChannelName(undefined, 12), 'Members - 12');
  assert.ok(membercount.countChannelName('Members - {count}', 747).length <= 100);
});

test('the member counter reads the guild member count', () => {
  assert.equal(membercount.memberCount({ memberCount: 747 }), 747);
  assert.equal(membercount.memberCount({ members: { cache: { size: 5 } } }), 5);
  assert.equal(membercount.memberCount({}), 0);
});

console.log('\nBot status');
const presence = require('../src/lib/presence');
test('the status cycles between the credit and the member count', () => {
  const client = {
    guilds: { cache: { first: () => ({ memberCount: 747 }) } },
    user: { setPresence: () => {} },
  };
  const statuses = presence.statusesFor(client);
  assert.deepEqual(statuses, [presence.CREDIT, 'watching over 747 members']);
  assert.equal(
    presence.statusesFor({ guilds: { cache: { first: () => ({ memberCount: 1 }) } } })[1],
    'watching over 1 member',
  );
  assert.equal(presence.memberStatus(0), 'watching over 0 members');
});

test('each cycle swaps the status and refreshes the count', () => {
  let count = 747;
  const seen = [];
  const client = {
    guilds: { cache: { first: () => ({ memberCount: count }) } },
    user: {
      setPresence: ({ activities }) =>
        seen.push(activities[0].state ?? activities[0].name),
    },
  };
  presence.start(client);
  presence.stop();
  presence.apply(client);
  count = 748;
  presence.apply(client);
  presence.apply(client);
  // The fourth call comes back around to the member count, which is re-read.
  assert.deepEqual(seen, [
    presence.CREDIT,
    'watching over 747 members',
    presence.CREDIT,
    'watching over 748 members',
  ]);
  assert.ok(presence.CYCLE_MS >= 20 * 1000, 'presence updates must stay under Discord rate limits');
});

test('the member line is a custom status so it is not prefixed with a verb', () => {
  const credit = presence.activityFor(presence.CREDIT);
  assert.equal(credit.type, 3); // Watching
  assert.equal(credit.name, presence.CREDIT);
  const members = presence.activityFor(presence.memberStatus(747));
  assert.equal(members.type, 4); // Custom
  assert.equal(members.state, 'watching over 747 members');
  assert.equal(members.name, 'Custom Status');
});

console.log('\nSpawner prices & media');
const spawners = require('../src/lib/spawners');
const media = require('../src/commands/media');

function collectButtons(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
  if (json.type === 2 && json.label) out.push(json);
  for (const value of Object.values(json)) {
    if (value && typeof value === 'object') collectButtons(value, out);
  }
  return out;
}

const noEmojiGuild = { id: 'g-1', emojis: { cache: { find: () => null } } };
const emojiGuild = {
  id: 'g-1',
  emojis: {
    cache: {
      find: (predicate) =>
        [
          { id: '900', name: 'skeleton', animated: false },
          { id: '901', name: 'fire', animated: true },
        ].find(predicate) ?? null,
    },
  },
};

test('spawner types are listed in the requested order', () => {
  assert.deepEqual(spawners.SPAWNER_TYPES.map((type) => type.label), [
    'Skeleton',
    'Creeper',
    'Iron Golem',
    'Zombified Piglin',
    'Pig',
    'Cow',
  ]);
  assert.equal(spawners.spawnerByKey('creeper').label, 'Creeper');
  assert.equal(spawners.spawnerByKey('blaze'), null);
});

test('prices allow up to two decimals and letters are rejected', () => {
  assert.equal(spawners.formatPrice(13), '13M');
  assert.equal(spawners.formatPrice('22'), '22M');
  assert.equal(spawners.formatPrice('13m'), null);
  assert.equal(spawners.formatPrice(0), null);
  assert.equal(spawners.formatPrice(12.5), '12.5M', 'one decimal');
  assert.equal(spawners.formatPrice('0.75'), '0.75M', 'two decimals');
  assert.equal(spawners.formatPrice(10.5), '10.5M', 'trailing zeros are trimmed');
  assert.equal(spawners.formatPrice(12.755), null, 'three decimals are rejected');
  assert.equal(spawners.validatePrice(12.755).ok, false);
  assert.equal(spawners.validatePrice(12.75).ok, true);

  const settings = { spawners: { buy: {}, sell: {} } };
  assert.equal(spawners.applyPrice(settings, 'creeper', 'buy', 16), '16M');
  assert.equal(settings.spawners.buy.creeper, 16);
  assert.equal(spawners.applyPrice(settings, 'creeper', 'buy', 16.5), '16.5M');
  assert.equal(settings.spawners.buy.creeper, 16.5, 'decimals are stored');
  assert.equal(spawners.applyPrice(settings, 'creeper', 'buy', 0.25), '0.25M');
  assert.equal(spawners.applyPrice(settings, 'creeper', 'buy', 1.234), null, 'too many decimals');
  assert.equal(spawners.applyPrice(settings, 'creeper', 'buy', '1x'), null);
  assert.equal(spawners.applyPrice(settings, 'creeper', 'buy', ''), null);
  assert.equal(spawners.applyPrice(settings, 'blaze', 'buy', 5), null, 'unknown spawner');
  assert.equal(spawners.applyPrice(settings, 'pig', 'hold', 5), null, 'unknown mode');
});

test('the ticket total is the current price times the amount', () => {
  assert.equal(spawners.formatMillions(13 * 8), '104M');
  assert.equal(spawners.formatMillions(12.75 * 8), '102M', 'float noise is rounded away');
  assert.equal(spawners.formatMillions(0.75 * 3), '2.25M');
  assert.equal(spawners.formatMillions(1_500_000), '1500000M', 'totals may pass the unit cap');
  assert.equal(spawners.formatMillions('nope'), null);

  assert.equal(spawners.parseAmount('8').value, 8, 'whole numbers');
  assert.equal(spawners.parseAmount('1,000').value, 1000, 'thousands separators are fine');
  assert.equal(spawners.parseAmount(' 16 ').value, 16);
  assert.equal(spawners.parseAmount('0').ok, false, 'zero is not an order');
  assert.equal(spawners.parseAmount('-3').ok, false);
  assert.equal(spawners.parseAmount('2.5').ok, false, 'no half spawners');
  assert.equal(spawners.parseAmount('many').ok, false);
  assert.equal(spawners.parseAmount('').ok, false);
});

test('spawner tickets ping the spawner perms role', () => {
  const role = (id, name) => ({ id, name });
  const roles = [
    role('r-staff', 'ꜱᴛᴀꜰꜰ'),
    role('r-perms', 'ꜱᴘᴀᴡɴᴇʀ ᴘᴇʀᴍꜱ'),
    role('r-other', 'Spawner Buyer'),
  ];
  const guild = {
    id: 'g-1',
    roles: {
      cache: {
        get: (id) => roles.find((entry) => entry.id === id) ?? null,
        find: (predicate) => roles.find(predicate) ?? null,
      },
    },
  };

  assert.equal(
    spawners.spawnerPermsRole(guild, {}).id,
    'r-perms',
    'a role named “spawner perms” is found in any font',
  );
  assert.equal(
    spawners.spawnerPermsRole(guild, { spawnerPermsRoleId: 'r-other' }).id,
    'r-other',
    'the configured role wins',
  );
  assert.equal(
    spawners.spawnerPermsRole(guild, { spawnerPermsRoleId: 'deleted' }).id,
    'r-perms',
    'a stale id falls back to the name match',
  );
  assert.equal(spawners.spawnerPermsRole([], {}), null, 'no guild, no role');
  assert.equal(
    spawners.spawnerPermsRole({ id: 'g-1', roles: { cache: { find: () => null } } }, {}),
    null,
    'and nothing when the server has no such role',
  );
});

test('spawner emojis use the server custom emoji with a fallback', () => {
  const skeleton = spawners.spawnerByKey('skeleton');
  assert.equal(spawners.spawnerEmoji(noEmojiGuild, skeleton), '💀');
  assert.equal(spawners.spawnerEmoji(emojiGuild, skeleton), '<:skeleton:900>');
  assert.equal(spawners.titleEmoji(noEmojiGuild), '🔥');
  assert.equal(spawners.titleEmoji(emojiGuild), '<a:fire:901>');
});

test('the board is one wide container with both sides, notes and buttons', () => {
  const settings = {
    spawners: { buy: { skeleton: 13, cow: 50 }, sell: { skeleton: 15 }, panelChannelId: null },
  };
  const payload = spawners.panelPayload(emojiGuild, settings);
  assert.equal(payload.components.length, 1, 'one container keeps it wide');
  assert.equal(payload.embeds, undefined, 'no legacy embed');
  assert.equal(payload.content, undefined, 'V2 rejects a content field');
  assert.deepEqual(payload.allowedMentions, { parse: [] });

  const text = textOf(payload);
  assert.ok(text.includes(toSmallCaps('Spawner Prices')), 'has the title');
  assert.ok(text.includes('<a:fire:901>'), 'uses the custom fire emoji');
  assert.ok(text.includes('<:skeleton:900>'), 'uses the custom spawner emoji');
  assert.ok(
    text.includes(toSmallCaps('buying')) && text.includes(toSmallCaps('selling')),
    'both sides are shown',
  );
  assert.ok(text.includes('Skeleton') && text.includes('**13M** each'), 'shows the set price');
  assert.ok(text.includes('**15M** each'), 'shows the selling price');
  assert.ok(text.includes('Cow') && text.includes('**50M** each'), 'shows the second set price');
  assert.ok(!text.includes('Creeper'), 'spawners without a price are hidden');
  assert.ok(!text.includes('not set'), 'unset prices are not mentioned at all');
  assert.ok(text.indexOf('Skeleton') < text.indexOf('Cow'), 'order follows the list');
  assert.ok(text.includes('NOT'), 'prices are not negotiable');
  assert.ok(/2 by 2/.test(text) && /8 spawner/.test(text), 'notes are kept');
  assert.ok(text.includes('made by seraphum'), 'keeps the signature');

  const buttons = collectButtons(payload);
  assert.deepEqual(
    buttons.map((button) => button.custom_id),
    ['spawner:buy', 'spawner:sell'],
  );
  assert.deepEqual(
    buttons.map((button) => button.label),
    ['Buy Spawners', 'Sell Spawners'],
  );
  assert.equal(buttons[0].style, 4, 'buy is red');
  assert.equal(buttons[1].style, 3, 'sell is green');
});

test('a board with no prices shows no spawner rows at all', () => {
  const payload = spawners.panelPayload(noEmojiGuild, { spawners: { buy: {}, sell: {} } });
  const text = textOf(payload);
  assert.equal(
    (text.match(/no prices listed yet/g) || []).length,
    2,
    'both sides explain that nothing is listed',
  );
  assert.ok(!text.includes('Skeleton'), 'no spawner rows');
  assert.ok(!text.includes('not set'), 'no placeholder prices');
  assert.equal(spawners.priceLine(noEmojiGuild, { spawners: { buy: {} } }, spawners.spawnerByKey('cow'), 'buy'), null);
});

test('the saved board message is remembered per guild', () => {
  assert.equal(spawners.storedPanel({ spawners: { buy: {}, sell: {} } }), null);
  assert.deepEqual(
    spawners.storedPanel({ spawners: { panelChannelId: 'c-1', panelMessageId: 'm-1' } }),
    { channelId: 'c-1', messageId: 'm-1' },
  );
});

test('links are validated and YouTube covers are picked up', () => {
  assert.equal(media.cleanUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(media.cleanUrl('not a link'), null);
  assert.equal(media.cleanUrl('ftp://example.com/video'), null);
  assert.ok(
    media
      .videoThumbnail('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      .includes('i.ytimg.com/vi/dQw4w9WgXcQ'),
  );
  assert.ok(
    media.videoThumbnail('https://youtube.com/shorts/dQw4w9WgXcQ').includes('dQw4w9WgXcQ'),
  );
  assert.equal(media.videoThumbnail('https://example.com/video.mp4'), null);
});

const mediaGuild = {
  id: 'g-1',
  ownerId: 'owner-1',
  roles: {
    cache: {
      find: (predicate) =>
        [
          { id: 'g-1', name: '@everyone', managed: false },
          { id: 'role-nemino', name: 'Nemino', managed: false },
        ].find(predicate) ?? null,
      get: (id) => (id === media.DEFAULT_PING_ROLE_ID ? { id, name: 'Nemino' } : null),
    },
  },
};

test('uploads ping the Nemino role, even after !stafffont', () => {
  const role = media.announceRole(mediaGuild);
  assert.equal(role.id, 'role-nemino');

  const restyled = {
    ...mediaGuild,
    roles: {
      cache: {
        ...mediaGuild.roles.cache,
        find: (predicate) =>
          [
            { id: 'g-1', name: '@everyone', managed: false },
            { id: 'role-nemino', name: 'ɴᴇᴍɪɴᴏ', managed: false },
          ].find(predicate) ?? null,
      },
    },
  };
  assert.equal(
    media.announceRole(restyled)?.id,
    'role-nemino',
    'small-capped role names still match',
  );

  const payload = media.uploadCard({ guild: mediaGuild, url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(payload.components.length, 1, 'one wide container');
  assert.equal(payload.content, undefined, 'V2 rejects a content field');
  assert.deepEqual(payload.allowedMentions, { parse: [], roles: ['role-nemino'] });

  const text = textOf(payload);
  assert.ok(text.includes('<@&role-nemino>'), 'mentions the role inside the card');
  assert.ok(text.includes('realnemino'), 'names the owner');
  assert.ok(text.includes('dQw4w9WgXcQ'), 'links the video');
  assert.ok(text.includes('i.ytimg.com'), 'uses the cover image');
  assert.ok(text.includes('made by seraphum'), 'keeps the signature');

  const buttons = collectButtons(payload);
  assert.equal(buttons.length, 2, 'watch button plus the channel link');
  assert.equal(buttons[0].style, 5, 'link button');
  assert.equal(buttons[0].url, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(buttons[1].url, media.YOUTUBE_CHANNEL_URL, 'always links the channel');
});

test('going live pings the server with the stream title', () => {
  const payload = media.liveCard({
    guild: mediaGuild,
    title: 'Building the 10B base',
    url: 'https://twitch.tv/realnemino',
  });
  assert.deepEqual(payload.allowedMentions, { parse: ['everyone'] });
  const text = textOf(payload);
  assert.ok(text.includes('@everyone'), 'pings the server');
  assert.ok(text.includes('Building the 10B base'), 'shows the stream title');
  assert.ok(text.includes('twitch.tv/realnemino'), 'links the stream');
  assert.equal(collectButtons(payload)[0].url, 'https://twitch.tv/realnemino');
  assert.equal(collectButtons(payload)[1].url, media.YOUTUBE_CHANNEL_URL, 'links the channel');

  const noLink = media.liveCard({ guild: mediaGuild, title: 'Chilling', url: null });
  assert.equal(collectButtons(noLink).length, 1, 'only the channel link without a stream url');
  assert.ok(textOf(noLink).includes('@everyone'));
});

console.log('\nLive tracking');
const streams = require('../src/lib/streams');

test('a redirect to the watch page means the channel is live', () => {
  assert.deepEqual(
    streams.parseLiveResponse({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      status: 200,
    }),
    { live: true, videoId: 'dQw4w9WgXcQ' },
  );
  assert.deepEqual(
    streams.parseLiveResponse({ url: 'https://www.youtube.com/@RealNemino/live', status: 200, html: 'x' }),
    { live: false, videoId: null },
    'an offline channel page is not live',
  );
  assert.equal(streams.parseLiveResponse({ status: 429 }).live, false, 'rate limits are not live');
  assert.equal(streams.parseLiveResponse({}).live, false);
});

test('a live marker in the page is read with its video id', () => {
  const live = '"isLive":true,"videoId":"abcDEF12345"';
  assert.deepEqual(streams.parseLiveResponse({ status: 200, html: live }), {
    live: true,
    videoId: 'abcDEF12345',
  });
  assert.equal(
    streams.parseLiveResponse({ status: 200, html: '"videoId":"abcDEF12345","hlsManifestUrl":"https://x"' })
      .live,
    true,
    'a live player manifest is enough',
  );
  assert.equal(streams.parseLiveResponse({ status: 200, html: '"isLive":false' }).live, false);
  assert.equal(streams.videoIdFrom('no id here'), null);

  // The marker sits deep in a real channel page, well past the first chunk.
  const deep = `${'x'.repeat(500_000)}"videoId":"abcDEF12345","liveBroadcastDetails":{"isLiveNow":true}`;
  assert.deepEqual(streams.parseLiveResponse({ status: 200, html: deep }), {
    live: true,
    videoId: 'abcDEF12345',
  });
});

test('a manual announcement marks the live video as already announced', () => {
  const settings = { stream: {} };
  assert.equal(streams.markAnnounced(settings, 'abcDEF12345'), true);
  assert.equal(settings.stream.announcedVideoId, 'abcDEF12345');
  assert.ok(settings.stream.announcedAt, 'remembers when it was announced');
  assert.equal(streams.markAnnounced(settings, null), false);
});

test('the watched channel is the RealNemino YouTube channel', () => {
  assert.equal(media.YOUTUBE_CHANNEL_URL, 'https://www.youtube.com/@RealNemino');
  assert.equal(streams.liveUrl(), 'https://www.youtube.com/@RealNemino/live');
  assert.equal(streams.liveUrl('RealNemino'), 'https://www.youtube.com/@RealNemino/live');
  assert.equal(streams.watchUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(streams.handleOf(''), '@RealNemino');
  assert.equal(streams.POLL_MS, 3 * 60 * 1000);
});

test('only the owner, Manage Server or the announced role may post', () => {
  const member = (id, permissions, roles = []) => ({
    id,
    permissions: { has: (permission) => permissions.includes(permission) },
    roles: { cache: { has: (roleId) => roles.includes(roleId) } },
  });
  const role = { id: 'role-nemino' };
  assert.equal(media.canAnnounce(member('owner-1', []), mediaGuild, role), true);
  assert.equal(media.canAnnounce(member('1', ['ManageGuild']), mediaGuild, role), true);
  assert.equal(media.canAnnounce(member('1', [], ['role-nemino']), mediaGuild, role), true);
  assert.equal(media.canAnnounce(member('1', [], []), mediaGuild, role), false);
});

const commandCountLine = `   ${jsonByName.size} commands: ${[...jsonByName.keys()].map((n) => `/${n}`).join(', ')}`;
test('env loader accepts .env, wispbyte.env and env', () => {
  const { ENV_FILES } = require(path.join(root, 'src', 'lib', 'env'));
  assert.deepEqual(ENV_FILES, ['.env', 'wispbyte.env', 'env']);
});

test('startup names the exact environment problem', () => {
  const env = require('../src/lib/env');
  const saved = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
  };
  const token = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(28)}`;

  try {
    delete process.env.DISCORD_TOKEN;
    process.env.CLIENT_ID = '123456789012345678';
    delete process.env.GUILD_ID;

    let audit = env.auditEnv();
    assert.equal(audit.fatal, true, 'a missing token is fatal');
    assert.match(audit.lines.join('\n'), /DISCORD_TOKEN missing/);
    assert.equal(audit.guildId, null, 'an absent GUILD_ID is not an error');

    process.env.DISCORD_TOKEN = `"${token}"`;
    audit = env.auditEnv();
    assert.equal(audit.fatal, false, 'quotes are stripped instead of crashing');
    assert.equal(audit.token, token);
    assert.match(audit.lines.join('\n'), /quotes/);

    process.env.GUILD_ID = 'main server';
    audit = env.auditEnv();
    assert.equal(audit.fatal, false);
    assert.equal(audit.guildId, null, 'a bad GUILD_ID is ignored, not fatal');
    assert.match(audit.lines.join('\n'), /not a server ID/);

    process.env.GUILD_ID = '1527920833404866759';
    assert.equal(env.auditEnv().guildId, '1527920833404866759');

    process.env.DISCORD_TOKEN = 'not-a-token';
    audit = env.auditEnv();
    assert.equal(audit.fatal, true);
    assert.match(audit.lines.join('\n'), /does not look like a bot token/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ticket channels are named after the member, safely', () => {
  const { channelSlug, ticketLabel, categoryKey } = require(path.join(
    root,
    'src',
    'commands',
    'ticket',
  ));
  assert.equal(channelSlug('sarimvora2012'), 'sarimvora2012');
  assert.equal(channelSlug('Some.User'), 'some.user');
  assert.equal(channelSlug('weird name!!'), 'weird-name');
  assert.equal(channelSlug('--trailing--'), 'trailing');
  assert.equal(channelSlug(''), 'member');
  assert.equal(ticketLabel('giveaway'), 'giveaway-claim');
  assert.equal(ticketLabel('application'), 'application');
  assert.equal(ticketLabel('spawner-buy'), 'spawner-buy');
  assert.equal(ticketLabel('spawner-sell'), 'spawner-sell');
  assert.equal(ticketLabel('ticket'), 'ticket');
  assert.equal(ticketLabel(undefined), 'ticket');
  assert.equal(categoryKey('spawner-buy'), 'spawner');
  assert.equal(categoryKey('spawner-sell'), 'spawner');
  assert.equal(categoryKey('application'), 'application');
});

test('transcripts post a summary block with the .txt file', () => {
  const { transcriptContent } = require(path.join(root, 'src', 'commands', 'ticket'));
  const ticket = {
    number: 1,
    userId: '1061471321801895987',
    createdAt: '2026-10-24T10:45:32.445Z',
  };
  const transcript = {
    messageCount: 2,
    closedAt: '2026-10-24T10:59:55.550Z',
    channelName: 'ticket-0001',
    summary: [
      'Ticket #0001',
      'Opened by: 1061471321801895987',
      'Created: 2026-10-24T10:45:32.445Z',
      'Closed: 2026-10-24T10:59:55.550Z',
      'Channel: #ticket-0001',
      '='.repeat(60),
    ],
  };
  const content = transcriptContent(ticket, transcript);
  const lines = content.split('\n');

  assert.equal(lines[0], '📄 Transcript for ticket #0001 — 2 messages');
  assert.equal(lines[1], '```');
  assert.equal(lines[2], 'Ticket #0001');
  assert.ok(lines.includes('Opened by: 1061471321801895987'));
  assert.ok(lines.includes('Channel: #ticket-0001'));
  assert.equal(lines[lines.length - 2], '='.repeat(60));
  assert.equal(lines[lines.length - 1], '```');

  const single = transcriptContent(
    { ...ticket, number: 12 },
    { ...transcript, messageCount: 1 },
  );
  assert.ok(single.startsWith('📄 Transcript for ticket #0012 — 1 message\n'));
});
test('leaderboards use the custom trophy emoji', () => {
  const { trophyEmoji } = require('../src/lib/helpers');
  const guild = {
    emojis: {
      cache: {
        find: (predicate) =>
          [
            { id: '1', name: 'crown', animated: false },
            { id: '1565217609174098052', name: 'trophy', animated: true },
          ].find(predicate),
      },
    },
  };
  assert.equal(trophyEmoji(guild), '<a:trophy:1565217609174098052>');
  assert.equal(trophyEmoji({ emojis: { cache: { find: () => undefined } } }), '🏆');
  assert.equal(trophyEmoji(null), '🏆');

  const levels = require('../src/lib/levels');
  const vouchBoard = require('../src/lib/vouch');
  const text = (card) =>
    card.components[0]
      .toJSON()
      .components.map((component) => component.content ?? '')
      .join('\n');
  assert.match(
    text(levels.leaderboardCard(guild, { levels: { users: { a: { xp: 500 } } } })),
    /<a:trophy:1565217609174098052> TOP MEMBERS/,
  );
  assert.match(
    text(vouchBoard.leaderboardCard(guild, { vouches: { a: 3 } })),
    /<a:trophy:1565217609174098052> TOP VOUCHED/,
  );
});

Promise.all(pendingTests).then(() => {
  console.log(`\n${failures === 0 ? '✅ All checks passed' : `❌ ${failures} check(s) failed`}`);
  console.log(`${commandCountLine}\n`);
  process.exit(failures === 0 ? 0 : 1);
});
