import { GuildMember, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import { teamsPanel } from '../../ui/panels/stats.js';
import { refuse, respond } from '../../ui/reply.js';
import { editionOf, editionOption } from '../../utils/edition.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { MAX_PLAYERS } from '../../utils/stats-options.js';
import { idsIn } from '../../utils/voters.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setContexts(InteractionContextType.Guild)
  .setName('teamgen')
  .setDescription('Create two balanced teams to compete.')
  .addStringOption(editionOption)
  .addStringOption((opt) =>
    opt
      .setName('discord-ids')
      .setDescription('Players as mentions or ids: all of a cloud game, or more beside your voice channel')
      .setRequired(false),
  );

export const visibility = 'public';

// A cloud game has no voice channel, so its players are listed; a realtime one
// is the caller's voice channel and anyone listed beside it.
function playersOf(interaction: ChatInputCommandInteraction, cloud: boolean): string[] {
  const listed = idsIn(interaction.options.getString('discord-ids') ?? '');
  let ids = listed;
  if (!cloud) {
    if (!(interaction.member instanceof GuildMember)) refuse('Run /teamgen in the server, not in a DM.');
    const voice = interaction.member.voice.channel;
    if (!voice) refuse('Join a voice channel first, then run /teamgen.');
    ids = [...new Set([...[...voice.members.values()].filter((m) => !m.user.bot).map((m) => m.user.id), ...listed])];
  }
  if (ids.length < 2) {
    refuse(cloud ? 'List at least two players in discord-ids, as mentions or ids.' : 'Teams need two players: add others in discord-ids, as mentions or ids.');
  }
  if (ids.length > MAX_PLAYERS) refuse(`Teams can be made for at most ${MAX_PLAYERS} players.`);
  return ids;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await ensureCommandAccess(interaction))) return;
  const civVersion = editionOf(interaction);
  const cloud = interaction.channelId === config.discord.channels.cloudCommands;
  const ids = playersOf(interaction, cloud);
  const result = await api.getTeamGen(civVersion, cloud ? 'cloud' : 'realtime', ids);
  await respond(interaction, teamsPanel(result), 'public');
}
