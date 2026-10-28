'use strict';

const path = require('node:path');
const {
  ContainerBuilder,
  FileBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');

const DEFAULT_COLOR = 0x5865f2;
const TEXT_LIMIT = 4000;
const SIGNATURE = 'made by seraphum';

function toEmbedJson(embed) {
  if (!embed) return null;
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  if (embed.data) return embed.data;
  return embed;
}

function normalizeEmbeds(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(toEmbedJson).filter(Boolean);
}

function takeText(value, budget) {
  const text = String(value ?? '');
  if (!text || budget.remaining <= 0) return '';
  if (text.length <= budget.remaining) {
    budget.remaining -= text.length;
    return text;
  }
  if (budget.remaining <= 1) {
    budget.remaining = 0;
    return '…';
  }
  const slice = `${text.slice(0, budget.remaining - 1)}…`;
  budget.remaining = 0;
  return slice;
}

function buildContainer(embed, budget) {
  if (!embed) return null;

  const container = new ContainerBuilder().setAccentColor(
    Number.isInteger(embed.color) ? embed.color : DEFAULT_COLOR,
  );

  const headerParts = [];
  if (embed.title) headerParts.push(`## ${embed.title}`);
  if (embed.description) headerParts.push(embed.description);
  const headerText = takeText(headerParts.join('\n'), budget);
  const thumbnail = embed.thumbnail?.url;

  if (headerText && thumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)),
    );
  } else if (headerText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  }

  if (Array.isArray(embed.fields) && embed.fields.length) {
    // Inline fields read better as compact "label · value" lines grouped
    // together, while full-width fields keep their value on its own line.
    const blocks = [];
    let inlineRun = [];
    const flushInline = () => {
      if (inlineRun.length) {
        blocks.push(inlineRun.join('\n'));
        inlineRun = [];
      }
    };
    for (const field of embed.fields) {
      const value = field.value ?? '—';
      if (field.inline) {
        inlineRun.push(`**${field.name}** · ${value}`);
      } else {
        flushInline();
        blocks.push(`**${field.name}**\n${value}`);
      }
    }
    flushInline();
    const fieldsText = takeText(blocks.join('\n\n'), budget);
    if (fieldsText) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldsText));
    }
  }

  const footerParts = [];
  if (embed.footer?.text) footerParts.push(embed.footer.text);
  if (embed.timestamp) {
    const timestamp = Math.floor(Date.parse(embed.timestamp) / 1000);
    if (Number.isFinite(timestamp)) footerParts.push(`<t:${timestamp}:R>`);
  }
  if (footerParts.length) {
    const footerText = takeText(`-# ${footerParts.join(' · ')}`, budget);
    if (footerText) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
      );
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText));
    }
  }

  return container.components.length ? container : null;
}

function signatureLine(footer) {
  const text = String(footer ?? '').trim();
  if (!text) return `-# ${SIGNATURE}`;
  if (text.includes(SIGNATURE)) return `-# ${text}`;
  return `-# ${text} · ${SIGNATURE}`;
}

function clampText(value, max = TEXT_LIMIT) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Builds a polished Components V2 card: accent colour, a header with an
 * optional thumbnail, a highlighted quote, stat lines, a progress bar and a
 * small-text footer. Returns a ready-to-send payload.
 */
function card({
  accent = DEFAULT_COLOR,
  kicker = null,
  title = null,
  subtitle = null,
  quote = null,
  description = null,
  stats = [],
  progress = null,
  sections = [],
  footer = null,
  thumbnail = null,
  image = null,
  buttons = [],
} = {}) {
  const container = new ContainerBuilder().setAccentColor(accent);

  const headerLines = [];
  if (kicker) headerLines.push(`-# ${kicker}`);
  if (title) headerLines.push(`# ${title}`);
  if (subtitle) headerLines.push(`-# ${subtitle}`);

  if (headerLines.length) {
    const header = new TextDisplayBuilder().setContent(clampText(headerLines.join('\n')));
    if (thumbnail) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(header)
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail)),
      );
    } else {
      container.addTextDisplayComponents(header);
    }
  }

  const bodyBlocks = [];
  if (quote) bodyBlocks.push(clampText(quote));
  if (description) bodyBlocks.push(clampText(description));
  if (bodyBlocks.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
    for (const block of bodyBlocks) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
    }
  }

  if (stats.length) {
    const lines = stats
      .filter((stat) => stat && stat.label)
      .map(({ emoji = '•', label, value }) =>
        `${emoji} **${label}**${value !== undefined && value !== null ? ` · ${value}` : ''}`,
      );
    if (lines.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(clampText(lines.join('\n'))),
      );
    }
  }

  if (progress) {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
    const filled = Math.round(percent / 10);
    const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${progress.emoji ?? '📊'} \`${bar}\` **${percent}%**${progress.label ? ` · ${progress.label}` : ''}`,
      ),
    );
  }

  for (const section of sections) {
    if (!section) continue;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(clampText(section)));
  }

  if (image) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems((item) => item.setURL(image)),
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(signatureLine(footer)),
  );

  if (buttons.length) {
    for (const row of buttons) container.addActionRowComponents(row);
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** Turns a card payload into an ephemeral interaction payload. */
function ephemeral(payload) {
  return { ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral };
}

function attachmentName(file) {
  if (!file) return null;
  if (typeof file === 'string') return path.basename(file);
  if (file.name) return file.name;
  if (typeof file.attachment === 'string') return path.basename(file.attachment);
  return null;
}

/**
 * Converts classic MessageCreate/Interaction payloads into Components V2
 * display components. Existing sent payloads that are already V2 are left alone.
 */
function convertPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const flags = Number(payload.flags ?? 0);
  if (flags & MessageFlags.IsComponentsV2) return payload;

  const embeds = normalizeEmbeds(payload.embeds);
  const hasContent = typeof payload.content === 'string' && payload.content.trim().length > 0;
  const hasComponents = Array.isArray(payload.components) && payload.components.length > 0;
  const hasFiles = Array.isArray(payload.files) && payload.files.length > 0;
  // Plain text stays a classic message: V2 has no benefit for it and the text
  // keeps its notification preview, plain-text mentions and searchable content.
  if (!embeds.length && !hasComponents && !hasFiles) return payload;

  const budget = { remaining: TEXT_LIMIT };
  const components = [];

  if (hasContent) {
    const text = takeText(payload.content, budget);
    if (text) components.push(new TextDisplayBuilder().setContent(text));
  }

  for (const embed of embeds) {
    const container = buildContainer(embed, budget);
    if (container) components.push(container);
  }

  if (hasComponents) components.push(...payload.components);

  if (hasFiles) {
    for (const file of payload.files) {
      const name = attachmentName(file);
      if (!name) {
        console.warn('[v2] Attachment has no resolvable name; sending this message as a classic embed.');
        return payload;
      }
      components.push(new FileBuilder().setURL(`attachment://${name}`));
    }
  }

  if (!components.length) return payload;

  const { embeds: _embeds, content: _content, poll: _poll, stickers: _stickers, ...rest } = payload;
  const converted = {
    ...rest,
    components,
    flags: flags | MessageFlags.IsComponentsV2,
  };

  // Embed mentions used to render quietly. Keep that behaviour for cards that
  // have no intentional message content, while leaving content pings alone.
  if (!hasContent && payload.allowedMentions === undefined) {
    converted.allowedMentions = { parse: [] };
  }

  return converted;
}

function isV2Message(message) {
  return Boolean(message?.flags?.has?.(MessageFlags.IsComponentsV2));
}

function isClassicEmbedMessage(message) {
  return Boolean(message?.embeds?.length && !isV2Message(message));
}

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  const discord = require('discord.js');

  const patch = (prototype, method, targetGetter = null) => {
    const original = prototype?.[method];
    if (typeof original !== 'function' || original.__v2Patched) return;

    function wrapped(options, ...args) {
      const originalOptions = options;
      let converted = false;

      if (options && typeof options === 'object') {
        const target = targetGetter ? targetGetter.call(this) : null;
        // A message that was not sent as Components V2 cannot be edited into
        // V2 in place, so only upgrade payloads whose message is already V2.
        if (!target || isV2Message(target)) {
          options = convertPayload(options);
          converted = options !== originalOptions;
        }
      }

      const result = original.call(this, options, ...args);
      if (!converted || typeof result?.catch !== 'function') return result;

      return result.catch((err) => {
        const message = String(err?.message ?? '');
        if (
          message.includes('IS_COMPONENTS_V2') ||
          message.includes('MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2')
        ) {
          console.warn('[v2] Falling back to a classic message for an older message or unsupported payload.');
          return original.call(this, originalOptions, ...args);
        }
        throw err;
      });
    }
    wrapped.__v2Patched = true;
    prototype[method] = wrapped;
  };

  for (const name of [
    'CommandInteraction',
    'MessageComponentInteraction',
    'ModalSubmitInteraction',
    'ContextMenuCommandInteraction',
  ]) {
    const interaction = discord[name];
    if (!interaction?.prototype) continue;
    for (const method of ['reply', 'followUp']) {
      patch(interaction.prototype, method);
    }
    for (const method of ['editReply', 'update']) {
      patch(interaction.prototype, method, function target() {
        return this.message ?? null;
      });
    }
  }

  patch(discord.Message?.prototype, 'reply');
  patch(discord.Message?.prototype, 'edit', function target() {
    return this;
  });

  for (const name of [
    'TextChannel',
    'NewsChannel',
    'ThreadChannel',
    'DMChannel',
    'VoiceChannel',
    'StageChannel',
  ]) {
    const channel = discord[name];
    if (channel?.prototype) patch(channel.prototype, 'send');
  }
}

module.exports = {
  DEFAULT_COLOR,
  SIGNATURE,
  TEXT_LIMIT,
  attachmentName,
  card,
  clampText,
  ephemeral,
  signatureLine,
  buildContainer,
  convertPayload,
  install,
  isClassicEmbedMessage,
  isV2Message,
  normalizeEmbeds,
};
