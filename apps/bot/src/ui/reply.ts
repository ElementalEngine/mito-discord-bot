import { randomBytes } from 'node:crypto';

import {
  MessageFlags,
  type AnySelectMenuInteraction,
  type AttachmentBuilder,
  type ButtonInteraction,
  type Message,
  type MessageEditOptions,
  type MessageMentionOptions,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type SendableChannels,
  type TextBasedChannel,
} from 'discord.js';

import { ApiError, parseApiError } from '../api/errors.js';
import { log } from '../utils/log.js';
import { container, notice, type Panel, type Tone } from './kit/index.js';

// Errors and refusals are private, results for the channel public. Discord
// drops an interaction after 3s, so a call to core-api defers first or races it.
export type Visibility = 'public' | 'private';

// A rule the user broke, said back to them. Thrown so a command can stop at
// the check that failed; the dispatcher renders it.
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

export function refuse(message: string): never {
  throw new Refusal(message);
}

const visibilityOf = new WeakMap<RepliableInteraction, Visibility>();
const holding = new WeakSet<RepliableInteraction>();
const NO_PINGS: MessageMentionOptions = { parse: [] };

export async function defer(interaction: RepliableInteraction, visibility: Visibility): Promise<void> {
  if (interaction.deferred || interaction.replied) return;
  visibilityOf.set(interaction, visibility);
  if (visibility === 'private') await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferReply();
}

// Files are shown where the panel's file blocks name them.
export type Extras = Readonly<{ allowedMentions?: MessageMentionOptions; files?: readonly AttachmentBuilder[] }>;

// The message written, where Discord gives one back.
export async function respond(
  interaction: RepliableInteraction,
  panel: Panel,
  visibility: Visibility,
  extras: Extras = {},
): Promise<Message | undefined> {
  const components = [container(panel)];
  const allowedMentions = extras.allowedMentions ?? NO_PINGS;
  const files = [...(extras.files ?? [])];
  const flags =
    visibility === 'private'
      ? ([MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] as const)
      : ([MessageFlags.IsComponentsV2] as const);

  // A held panel stays as it is; anything said arrives beside it.
  if (holding.has(interaction)) return interaction.followUp({ flags, components, allowedMentions, files });
  if (interaction.deferred && !interaction.replied) {
    const deferredAs = visibilityOf.get(interaction) ?? (interaction.ephemeral ? 'private' : 'public');
    if (deferredAs === visibility) {
      return interaction.editReply({
        content: null,
        embeds: [],
        flags: MessageFlags.IsComponentsV2,
        components,
        allowedMentions,
        files,
      });
    }
    // A private answer to a public deferral must not land in the channel.
    if (visibility === 'private') await interaction.deleteReply().catch(() => undefined);
  }
  if (interaction.deferred || interaction.replied) return interaction.followUp({ flags, components, allowedMentions, files });
  visibilityOf.set(interaction, visibility);
  await interaction.reply({ flags, components, allowedMentions, files });
  return undefined;
}

// Another public panel after the first answer, such as a long draft's second.
export async function respondMore(interaction: RepliableInteraction, panel: Panel): Promise<void> {
  await interaction.followUp({ flags: [MessageFlags.IsComponentsV2], components: [container(panel)], allowedMentions: NO_PINGS });
}

type PanelPress = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

// Acknowledge a press on a private panel without answering it yet; the panel
// is then rewritten with replacePanel.
export async function holdPanel(interaction: PanelPress): Promise<void> {
  holding.add(interaction);
  await interaction.deferUpdate();
}

// A message rewritten as a panel, clearing whatever it showed before.
function asPanel(panel: Panel, allowedMentions: MessageMentionOptions = NO_PINGS): MessageEditOptions {
  return { content: null, embeds: [], flags: MessageFlags.IsComponentsV2, components: [container(panel)], allowedMentions };
}

// The interaction's own message rewritten: the panel a press was held on, or a
// command's or press's earlier reply.
export async function replacePanel(interaction: RepliableInteraction, panel: Panel): Promise<void> {
  await interaction.editReply(asPanel(panel));
}

// A panel posted to a channel, or an earlier message rewritten as one, rather
// than an answer to an interaction.
export async function postPanel(
  channel: SendableChannels,
  panel: Panel,
  allowedMentions: MessageMentionOptions = NO_PINGS,
): Promise<Message> {
  return channel.send({ flags: MessageFlags.IsComponentsV2, components: [container(panel)], allowedMentions });
}

export async function editPanel(
  message: Message,
  panel: Panel,
  allowedMentions: MessageMentionOptions = NO_PINGS,
): Promise<Message> {
  return message.edit(asPanel(panel, allowedMentions));
}

// The same for a message known only by its id: one call, with no fetch first.
export async function editPanelById(channel: TextBasedChannel, id: string, panel: Panel): Promise<Message> {
  return channel.messages.edit(id, asPanel(panel));
}

// A one-line private answer. Never throws: the interaction may have expired.
export async function say(interaction: RepliableInteraction, tone: Tone, message: string): Promise<void> {
  await respond(interaction, notice(tone, message), 'private').catch((error: unknown) => {
    log.warn('reply not delivered', error instanceof Error ? error.message : error);
  });
}

export type Failure = Readonly<{
  tone: Tone;
  text: string;
  level: 'none' | 'warn' | 'error';
  incident: string | null;
}>;

const unreachable = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' || error.name === 'TimeoutError' || (error instanceof TypeError && error.message === 'fetch failed'));

// What a failure says, completing "Could not <action>". core-api's message
// is written for display and is shown; a raw response body never is.
export function failureOf(error: unknown, action: string): Failure {
  if (error instanceof Refusal) return { tone: 'refused', text: error.message, level: 'none', incident: null };

  if (error instanceof ApiError) {
    const payload = parseApiError(error.body);
    const refused = error.status >= 400 && error.status < 500;
    const tone: Tone = refused ? 'refused' : 'failed';
    const level = refused ? 'warn' : 'error';
    if (payload) {
      const ref = payload.correlation_id ? ` (ref ${payload.correlation_id})` : '';
      const retry = payload.retryable ? ' Try again.' : '';
      const reason = (payload.message.trim() || payload.code).replace(/\.+$/, '');
      return { tone, text: `Could not ${action}: ${reason}.${retry}${ref}`, level, incident: null };
    }
    const text = refused
      ? `Could not ${action}: refused (${error.status}).`
      : `Could not ${action}: the league server failed (${error.status}). Try again.`;
    return { tone, text, level, incident: null };
  }

  if (unreachable(error)) {
    return { tone: 'failed', text: `Could not ${action}: the league server did not answer. Try again.`, level: 'error', incident: null };
  }

  const incident = randomBytes(3).toString('hex');
  return { tone: 'failed', text: `Could not ${action}. Ref ${incident}.`, level: 'error', incident };
}

// Log a failure once and tell the user privately.
export async function fail(
  interaction: RepliableInteraction,
  error: unknown,
  action: string,
  context: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const failure = failureOf(error, action);
  const where = { ...context, user: interaction.user.id, channel: interaction.channelId };
  if (failure.level === 'error') log.error(`failed to ${action}`, { ...where, incident: failure.incident }, error);
  else if (failure.level === 'warn') log.warn(`refused to ${action}`, where, error instanceof ApiError ? error.status : '');

  try {
    await respond(interaction, notice(failure.tone, failure.text), 'private');
  } catch (sendError) {
    log.warn('failure notice not delivered', sendError instanceof Error ? sendError.message : sendError);
  }
}
