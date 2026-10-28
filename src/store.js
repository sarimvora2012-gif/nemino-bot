'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_QUESTIONS = [
  'What is your Discord username and timezone?',
  'How old are you?',
  'Why do you want to join the staff team?',
  'What experience do you have (moderation, communities, etc.)?',
  'How many hours per week can you be active?',
];

function defaultGuild() {
  return {
    staffRoleId: null,
    kickProtectionRoleId: null,
    protectedUsers: [],
    logChannelId: null,
    ticketCategoryId: null,
    transcriptChannelId: null,
    vouchChannelId: null,
    staffVouchChannelId: null,
    welcomeChannelId: null,
    memberCountChannelId: null,
    memberCountTemplate: 'Members - {count}',
    vouchAdminRoleId: null,
    // Role pinged when AutoMod catches a suspicious link; falls back to the staff role.
    automodAlertRoleId: null,
    vouches: {},
    vouchGiven: {},
    vouchPanels: {},
    applications: {
      reviewChannelId: null,
      acceptRoleId: null,
      panelChannelId: null,
      questions: [...DEFAULT_QUESTIONS],
      open: true,
    },
    activity: {
      enabled: false,
      intervalSeconds: 7 * 24 * 60 * 60,
      durationSeconds: 48 * 60 * 60,
      channelId: null,
      loaRoleId: '1539905285789982781',
      nextCheckAt: null,
      current: null,
      lastCheck: null,
    },
    // XP is stored per member as { xp, messages, lastAt }; the curve lives in lib/levels.js.
    levels: {
      enabled: true,
      announce: true,
      announceChannelId: null,
      xpMin: 15,
      xpMax: 25,
      cooldownSeconds: 20,
      users: {},
    },
    honeypot: { channelId: null, messageId: null, inviteUrl: null },
    spawners: { buy: {}, sell: {}, panelChannelId: null, panelMessageId: null },
    stream: {
      enabled: true,
      handle: null,
      isLive: false,
      announcedVideoId: null,
      announcedAt: null,
      lastCheckedAt: null,
      messageId: null,
    },
    counters: { ticket: 0, application: 0, strike: 0, giveaway: 0, loa: 0, suggestion: 0 },
  };
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = {
      guilds: {},
      tickets: {},
      applications: {},
      strikes: {},
      giveaways: {},
      loaRequests: {},
      suggestions: {},
    };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        guilds: parsed.guilds ?? {},
        tickets: parsed.tickets ?? {},
        applications: parsed.applications ?? {},
        strikes: parsed.strikes ?? {},
        giveaways: parsed.giveaways ?? {},
        loaRequests: parsed.loaRequests ?? {},
        suggestions: parsed.suggestions ?? {},
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[store] Could not read ${this.file}, starting fresh:`, err.message);
      }
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Guild settings, filled in with defaults. */
  guild(guildId) {
    if (!this.data.guilds[guildId]) {
      this.data.guilds[guildId] = defaultGuild();
      this.save();
    }
    const guild = this.data.guilds[guildId];
    // Backfill in case an older data file is missing newer keys.
    const defaults = defaultGuild();
    for (const [key, value] of Object.entries(defaults)) {
      if (guild[key] === undefined) guild[key] = value;
    }
    guild.applications = { ...defaults.applications, ...guild.applications };
    guild.activity = { ...defaults.activity, ...guild.activity };
    guild.honeypot = { ...defaults.honeypot, ...guild.honeypot };
    guild.levels = { ...defaults.levels, ...guild.levels };
    guild.levels.users = { ...(guild.levels.users ?? {}) };
    // The first shipped cooldown was 60s; move servers saved with it to the
    // new 20s once, then never touch an explicit choice again.
    if (!guild.levels.cooldownChecked) {
      if (guild.levels.cooldownSeconds === 60) guild.levels.cooldownSeconds = 20;
      guild.levels.cooldownChecked = true;
    }
    guild.spawners = {
      ...defaults.spawners,
      ...guild.spawners,
      buy: { ...(guild.spawners?.buy ?? {}) },
      sell: { ...(guild.spawners?.sell ?? {}) },
    };
    guild.stream = { ...defaults.stream, ...guild.stream };
    guild.counters = { ...defaults.counters, ...guild.counters };
    return guild;
  }

  updateGuild(guildId, patch) {
    const guild = this.guild(guildId);
    Object.assign(guild, patch);
    this.save();
    return guild;
  }

  nextCounter(guildId, key) {
    const guild = this.guild(guildId);
    guild.counters[key] = (guild.counters[key] ?? 0) + 1;
    this.save();
    return guild.counters[key];
  }

  // ---- Tickets -------------------------------------------------------------

  addTicket(channelId, ticket) {
    this.data.tickets[channelId] = ticket;
    this.save();
  }

  ticket(channelId) {
    return this.data.tickets[channelId] ?? null;
  }

  removeTicket(channelId) {
    delete this.data.tickets[channelId];
    this.save();
  }

  openTicketFor(guildId, userId) {
    return (
      Object.entries(this.data.tickets).find(
        ([, t]) => t.guildId === guildId && t.userId === userId && t.status === 'open',
      )?.[0] ?? null
    );
  }

  // ---- Applications --------------------------------------------------------

  addApplication(application) {
    this.data.applications[application.id] = application;
    this.save();
    return application;
  }

  application(id) {
    return this.data.applications[id] ?? null;
  }

  pendingApplicationFor(guildId, userId) {
    return (
      Object.values(this.data.applications).find(
        (a) => a.guildId === guildId && a.userId === userId && a.status === 'pending',
      ) ?? null
    );
  }

  /** Most recent denied application, used to enforce the reapply cooldown. */
  latestDeniedApplicationFor(guildId, userId) {
    return (
      Object.values(this.data.applications)
        .filter((a) => a.guildId === guildId && a.userId === userId && a.status === 'denied')
        .sort((a, b) => new Date(b.reviewedAt ?? 0) - new Date(a.reviewedAt ?? 0))[0] ?? null
    );
  }

  /** Open application ticket for an application, if one already exists. */
  ticketForApplication(guildId, applicationId) {
    return (
      Object.entries(this.data.tickets).find(
        ([, t]) =>
          t.guildId === guildId &&
          t.applicationId === applicationId &&
          t.status === 'open',
      )?.[0] ?? null
    );
  }

  updateApplication(id, patch) {
    const app = this.data.applications[id];
    if (!app) return null;
    Object.assign(app, patch);
    this.save();
    return app;
  }

  // ---- Strikes -------------------------------------------------------------

  strikes(guildId, userId) {
    return this.data.strikes[`${guildId}:${userId}`] ?? [];
  }

  addStrike(guildId, userId, strike) {
    const key = `${guildId}:${userId}`;
    if (!this.data.strikes[key]) this.data.strikes[key] = [];
    this.data.strikes[key].push(strike);
    this.save();
    return strike;
  }

  findStrike(guildId, userId, id) {
    return this.strikes(guildId, userId).find((s) => s.id === id) ?? null;
  }

  updateStrike(guildId, userId, id, patch) {
    const strike = this.findStrike(guildId, userId, id);
    if (!strike) return null;
    Object.assign(strike, patch);
    this.save();
    return strike;
  }

  // ---- Leave of absence requests ------------------------------------------

  addLoaRequest(request) {
    this.data.loaRequests[request.id] = request;
    this.save();
    return request;
  }

  loaRequest(id) {
    return this.data.loaRequests[id] ?? null;
  }

  pendingLoaRequestFor(guildId, userId) {
    return (
      Object.values(this.data.loaRequests).find(
        (request) =>
          request.guildId === guildId &&
          request.userId === userId &&
          request.status === 'pending',
      ) ?? null
    );
  }

  updateLoaRequest(id, patch) {
    const request = this.data.loaRequests[id];
    if (!request) return null;
    Object.assign(request, patch);
    this.save();
    return request;
  }

  // ---- Suggestions ---------------------------------------------------------

  addSuggestion(suggestion) {
    this.data.suggestions[suggestion.id] = suggestion;
    this.save();
    return suggestion;
  }

  suggestion(id) {
    return this.data.suggestions[id] ?? null;
  }

  suggestionsForGuild(guildId) {
    return Object.values(this.data.suggestions).filter(
      (suggestion) => suggestion.guildId === guildId,
    );
  }

  updateSuggestion(id, patch) {
    const suggestion = this.data.suggestions[id];
    if (!suggestion) return null;
    Object.assign(suggestion, patch);
    this.save();
    return suggestion;
  }

  // ---- Giveaways -----------------------------------------------------------

  addGiveaway(giveaway) {
    this.data.giveaways[giveaway.id] = giveaway;
    this.save();
    return giveaway;
  }

  giveaway(id) {
    return this.data.giveaways[id] ?? null;
  }

  giveawaysForGuild(guildId) {
    return Object.values(this.data.giveaways).filter((giveaway) => giveaway.guildId === guildId);
  }

  updateGiveaway(id, patch) {
    const giveaway = this.data.giveaways[id];
    if (!giveaway) return null;
    Object.assign(giveaway, patch);
    this.save();
    return giveaway;
  }
}

module.exports = { Store, DEFAULT_QUESTIONS };
