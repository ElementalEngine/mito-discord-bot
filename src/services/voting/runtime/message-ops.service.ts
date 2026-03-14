import { MessageFlags, type ButtonInteraction, type Guild, type InteractionReplyOptions, type ModalSubmitInteraction, type Message, type StringSelectMenuInteraction } from 'discord.js';

import type { PublicVotePayload } from '../panels/public-message.service.js';
import type { GameVoteSession } from '../../../types/voting.types.js';

function formatUnknownError(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const name = 'name' in err && typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : '';
  const message = 'message' in err && typeof (err as { message?: unknown }).message === 'string'
    ? (err as { message: string }).message
    : '';
  if (name && message) return `${name}: ${message}`;
  return name || message;
}

export async function replySafe(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  payload: InteractionReplyOptions,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  } catch {
    // ignore
  }
}

export async function replyNotice(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  content: string,
): Promise<void> {
  const base = { content, allowedMentions: { parse: [] as const } } as const;
  const payload = interaction.inGuild()
    ? ({ ...base, flags: MessageFlags.Ephemeral } as const)
    : base;
  await replySafe(interaction, payload);
}

export async function safeEditMessage(
  msg: Message<true>,
  payload: PublicVotePayload,
): Promise<void> {
  try {
    await msg.edit({
      content: payload.content ?? msg.content ?? null,
      embeds: payload.embeds,
      components: payload.components,
      allowedMentions: { parse: [] as const },
    });
  } catch {
    // ignore
  }
}

function buildInitialVotePingContent(session: GameVoteSession): string | undefined {
  if (session.voterIds.length === 0) return undefined;
  return `🔔 Vote started for ${session.voterIds.map((id) => `<@${id}>`).join(' ')}`;
}

export async function openInitialVoteMessages(
  session: GameVoteSession,
  guild: Guild,
  payload: PublicVotePayload,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const msg = await session.commandChannel.send({
      ...payload,
      content: buildInitialVotePingContent(session),
      allowedMentions: {
        parse: [] as const,
        users: [...session.voterIds],
      },
    });
    if (!msg.inGuild()) return { ok: false, message: '⚠️ This command must be used in a server channel.' };
    if (msg.guildId !== guild.id) return { ok: false, message: '⚠️ Internal error: guild mismatch.' };
    session.publicMessage = msg;
    return { ok: true };
  } catch (err: unknown) {
    console.error('gamevote initial send failed', {
      sessionId: session.sessionId,
      guildId: session.guildId,
      channelId: 'id' in session.commandChannel ? session.commandChannel.id : undefined,
      edition: session.edition,
      gameType: session.gameType,
      error: err,
    });
    const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: unknown }).code : undefined;
    const detail = formatUnknownError(err);
    const extra = typeof code === 'number' || typeof code === 'string'
      ? ` (Discord error ${code})`
      : detail
        ? ` (${detail})`
        : '';
    return { ok: false, message: `⚠️ I couldn't post the vote message in that channel${extra}.` };
  }
}
