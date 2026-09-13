import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import { ApiError } from '../../api/errors.js';
import { config } from '../../config.js';
import { EMOJI_CONFIRM, EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import { buildLobbyButtons, buildLobbyOpenEmbed } from '../../ui/embeds/lobby.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { log } from '../../utils/log.js';

const api = new ApiClient();
const FFA_SIZES = [8, 10, 12] as const;

// The command opens a lobby on core-api and posts the embed; every seat,
// vote, ban and pick happens in the Activity from there.
export const data = new SlashCommandBuilder()
  .setName('vote-civ6')
  .setDescription('Open a Civ6 lobby.')
  .addSubcommand((sub) =>
    sub.setName('ffa').setDescription('Open a Civ6 FFA lobby.')
      .addIntegerOption((o) => o.setName('size').setDescription('Seats').addChoices(...FFA_SIZES.map((n) => ({ name: String(n), value: n }))))
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)))
  .addSubcommand((sub) =>
    sub.setName('duel').setDescription('Open a Civ6 duel lobby.')
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)))
  .addSubcommand((sub) =>
    sub.setName('team').setDescription('Open a Civ6 teamer lobby.')
      .addIntegerOption((o) => o.setName('number-of-teams').setDescription('Teams').setMinValue(2).setMaxValue(6).setRequired(true))
      .addIntegerOption((o) => o.setName('team-size').setDescription('Players per team').setMinValue(1).setMaxValue(6).setRequired(true))
      .addStringOption((o) => o.setName('draft-mode').setDescription('Draft mode').addChoices({ name: 'standard', value: 'standard' }, { name: 'cwc (two teams only)', value: 'cwc' }))
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)));

const GAME_TYPE = { ffa: 'ffa', duel: 'duel', team: 'teamer' } as const;

function allowedChannels(sub: keyof typeof GAME_TYPE): readonly string[] {
  const c = config.discord.channels;
  if (sub === 'team') return [c.civ6teamerVote, c.noviceCommands];
  if (sub === 'ffa') return [c.civ6ffaVote, c.noviceCommands];
  return [c.civ6ffaVote];
}

async function member(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
  if (!interaction.inGuild() || !interaction.guild) return null;
  if (interaction.inCachedGuild()) return interaction.member;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true) as keyof typeof GAME_TYPE;
  if (!(await ensureCommandAccess(interaction, { allowedChannelIds: allowedChannels(sub) }))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const say = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });

  const host = await member(interaction);
  if (!host) return void (await say(`${EMOJI_ERROR} Unable to resolve your member info.`));
  const voice = host.voice.channel;
  if (!voice) return void (await say(`${EMOJI_FAIL} Join a voice channel first, then run /vote-civ6.`));
  if (!interaction.channel?.isSendable()) return void (await say(`${EMOJI_FAIL} I cannot post in this channel.`));

  const teams = sub === 'team' ? interaction.options.getInteger('number-of-teams', true) : null;
  const draftMode = sub === 'team' ? ((interaction.options.getString('draft-mode') ?? 'standard') as 'standard' | 'cwc') : null;
  if (draftMode === 'cwc' && teams !== 2) return void (await say(`${EMOJI_FAIL} CWC is two teams only.`));

  try {
    const lobby = await api.createLobby({
      guild_id: interaction.guildId!,
      channel_id: interaction.channelId,
      voice_channel_id: voice.id,
      host_discord_id: interaction.user.id,
      edition: 'civ6',
      game_type: GAME_TYPE[sub],
      size: sub === 'ffa' ? (interaction.options.getInteger('size') ?? FFA_SIZES[0]) : null,
      number_teams: teams,
      team_size: sub === 'team' ? interaction.options.getInteger('team-size', true) : null,
      draft_mode: draftMode,
      host_rules: interaction.options.getString('rules'),
    });
    await interaction.channel.send({ embeds: [buildLobbyOpenEmbed(lobby)], components: [buildLobbyButtons(lobby)] });
    await say(`${EMOJI_CONFIRM} Lobby posted. Open it from the message to take your seat.`);
  } catch (error) {
    if (error instanceof ApiError) {
      log.warn('vote-civ6: create refused', error.status, error.code);
      return void (await say(`${EMOJI_FAIL} ${error.status === 409 ? 'You are already seated in another open lobby.' : `Could not open the lobby (${error.code ?? error.status}).`}`));
    }
    log.error('vote-civ6: create failed', error);
    await say(`${EMOJI_ERROR} Could not open the lobby.`);
  }
}
