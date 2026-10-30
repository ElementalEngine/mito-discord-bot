import type { ChatInputCommandInteraction, SlashCommandStringOption } from 'discord.js';

import { refuse } from '../ui/reply.js';

const MENTION = /<@!?(\d{17,20})>/g;
const ID = /<@!?(\d{17,20})>|\b(\d{17,20})\b/g;
const MAX_VOTERS = 14;

// Players written as mentions or bare ids, in order, each once.
export const idsIn = (listed: string): string[] => [...new Set([...listed.matchAll(ID)].map((m) => m[1] ?? m[2]!))];

export const playersOption = (o: SlashCommandStringOption): SlashCommandStringOption =>
  o.setName('players').setDescription('Your voice channel is in already. @mention others to add, or to take out, spaced apart').setMaxLength(1000);

// The voters: the starter's voice channel, bots aside, with each player
// mentioned added or taken out. A name typed without its mention is refused.
export function votersOf(interaction: ChatInputCommandInteraction<'cached'>): { voiceId: string; voters: string[] } {
  const voice = interaction.member.voice.channel;
  if (!voice) refuse('Join a voice channel first: its players are the voters.');
  const voters = new Set([...voice.members.values()].filter((m) => !m.user.bot).map((m) => m.id));
  const mentions = interaction.options.getString('players') ?? '';
  const stray = mentions.replace(MENTION, ' ').replace(/[\s,]+/g, ' ').trim();
  if (stray) refuse(`Pick each player from the @ list so they show as a mention; "${stray.slice(0, 50)}" is not one.`);
  for (const id of new Set([...mentions.matchAll(MENTION)].map((m) => m[1]))) {
    if (!id || interaction.client.users.cache.get(id)?.bot) continue;
    if (!voters.delete(id)) voters.add(id);
  }
  if (voters.size < 2 || voters.size > MAX_VOTERS) refuse(`A vote takes 2 to ${MAX_VOTERS} players; this one has ${voters.size}.`);
  return { voiceId: voice.id, voters: [...voters] };
}
