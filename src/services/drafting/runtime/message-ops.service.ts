import type {
  ButtonInteraction,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
  StringSelectMenuInteraction,
} from 'discord.js';

export type DraftRenderPayload = Omit<MessageCreateOptions, 'flags'> & Omit<MessageEditOptions, 'flags'>;

type NoticeInteraction = ButtonInteraction | StringSelectMenuInteraction;

export async function safeEditDraftMessage(msg: Message, payload: DraftRenderPayload): Promise<void> {
  try {
    if (!msg.editable) return;
    await msg.edit(payload);
  } catch {
    // best effort
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
    await safeEditDraftMessage(current, payload);
    return current;
  }

  return send();
}
