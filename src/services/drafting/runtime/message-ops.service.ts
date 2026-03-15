import type {
  ButtonInteraction,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
  StringSelectMenuInteraction,
} from 'discord.js';

export type DraftRenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

type NoticeInteraction = ButtonInteraction | StringSelectMenuInteraction;

function hasOwn<K extends PropertyKey>(value: object, key: K): value is object & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeComparable(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => normalizeComparable(entry));
  if (typeof value === 'object') {
    if ('toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return normalizeComparable((value as { toJSON: () => unknown }).toJSON());
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, normalizeComparable(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function normalizedJson(value: unknown): string {
  return JSON.stringify(normalizeComparable(value));
}

function isDraftEditNoop(msg: Message, payload: DraftRenderPayload): boolean {
  if (hasOwn(payload, 'content') && (payload.content ?? null) !== (msg.content || null)) {
    return false;
  }

  if (hasOwn(payload, 'embeds') && normalizedJson(payload.embeds) !== normalizedJson(msg.embeds)) {
    return false;
  }

  if (hasOwn(payload, 'components') && normalizedJson(payload.components) !== normalizedJson(msg.components)) {
    return false;
  }

  return true;
}

export async function safeEditDraftMessage(msg: Message, payload: DraftRenderPayload): Promise<boolean> {
  try {
    if (!msg.editable) return false;
    if (isDraftEditNoop(msg, payload)) return true;
    await msg.edit(payload);
    return true;
  } catch {
    return false;
  }
}

export async function replyDraftNotice(interaction: NoticeInteraction, content: string): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(interaction.inGuild() ? { ...base, ephemeral: true } : base);
      return;
    }

    await interaction.reply(interaction.inGuild() ? { ...base, ephemeral: true } : base);
  } catch {
    // best effort
  }
}

export async function upsertDraftTrackingMessage(
  current: Message | null,
  payload: DraftRenderPayload,
  send: () => Promise<Message>,
): Promise<Message> {
  if (current) {
    const didEdit = await safeEditDraftMessage(current, payload);
    if (didEdit) return current;
  }

  return send();
}
