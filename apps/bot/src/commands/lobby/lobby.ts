import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';

import { ApiError } from '../../api/errors.js';
import { ApiClient } from '../../api/index.js';
import { config } from '../../config.js';
import { EMOJI_CONFIRM, EMOJI_ERROR, EMOJI_FAIL } from '../../config/constants.js';
import { buildLobbyButtons, buildLobbyOpenEmbed } from '../../ui/embeds/lobby.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';
import { log } from '../../utils/log.js';

const api = new ApiClient();
const FFA_SIZES = [8, 10, 12] as const;
const AGES = ['AGE_ANTIQUITY', 'AGE_EXPLORATION', 'AGE_MODERN'] as const;

type Game = 'civ6' | 'civ7';
type GameType = 'ffa' | 'teamer' | 'duel';

// A teamer's shape is the mode, so an invalid one is not expressible: CWC
// needs a pick order, and CPL plays it at 4v4 and 5v5.
type ModeChoice = Readonly<{
  label: string;
  value: string;
  gameType: GameType;
  teams?: number;
  teamSize?: number;
  draftMode?: 'standard' | 'cwc';
}>;

const MODES: readonly ModeChoice[] = [
  { label: 'FFA', value: 'ffa', gameType: 'ffa' },
  { label: 'Duel', value: 'duel', gameType: 'duel' },
  { label: 'Teamer 2v2', value: 'teamer-2v2', gameType: 'teamer', teams: 2, teamSize: 2, draftMode: 'standard' },
  { label: 'Teamer 3v3', value: 'teamer-3v3', gameType: 'teamer', teams: 2, teamSize: 3, draftMode: 'standard' },
  { label: 'Teamer 4v4', value: 'teamer-4v4', gameType: 'teamer', teams: 2, teamSize: 4, draftMode: 'standard' },
  { label: 'Teamer 5v5', value: 'teamer-5v5', gameType: 'teamer', teams: 2, teamSize: 5, draftMode: 'standard' },
  { label: 'CWC 4v4', value: 'cwc-4v4', gameType: 'teamer', teams: 2, teamSize: 4, draftMode: 'cwc' },
  { label: 'CWC 5v5', value: 'cwc-5v5', gameType: 'teamer', teams: 2, teamSize: 5, draftMode: 'cwc' },
];

// Edition and mode are data, not structure: Discord allows three levels of
// nesting and the verbs need them. The combinations are checked here, where
// a refusal can say why.
export const data = new SlashCommandBuilder()
  .setName('lobby')
  .setDescription('Open and manage Activity lobbies.')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Open a lobby and take the host seat.')
      .addStringOption((o) =>
        o.setName('game').setDescription('Edition').setRequired(true)
          .addChoices({ name: 'Civ6', value: 'civ6' }, { name: 'Civ7', value: 'civ7' }))
      .addStringOption((o) =>
        o.setName('mode').setDescription('Game mode').setRequired(true)
          .addChoices(...MODES.map((m) => ({ name: m.label, value: m.value }))))
      .addIntegerOption((o) =>
        o.setName('size').setDescription('Seats — FFA only')
          .addChoices(...FFA_SIZES.map((n) => ({ name: String(n), value: n }))))
      .addStringOption((o) =>
        o.setName('starting-age').setDescription('Starting age — Civ7 only')
          .addChoices({ name: 'Antiquity', value: AGES[0] }, { name: 'Exploration', value: AGES[1] }, { name: 'Modern', value: AGES[2] }))
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)));

function allowedChannels(game: Game, mode: GameType): readonly string[] {
  const c = config.discord.channels;
  const vote = mode === 'teamer'
    ? (game === 'civ6' ? c.civ6teamerVote : c.civ7teamerVote)
    : (game === 'civ6' ? c.civ6ffaVote : c.civ7ffaVote);
  return mode === 'duel' ? [vote] : [vote, c.noviceCommands];
}

async function member(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
  if (!interaction.inGuild() || !interaction.guild) return null;
  if (interaction.inCachedGuild()) return interaction.member;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const game = interaction.options.getString('game', true) as Game;
  const chosen = MODES.find((m) => m.value === interaction.options.getString('mode', true));
  if (!chosen) return void (await interaction.reply({ content: `${EMOJI_FAIL} Unknown mode.`, flags: MessageFlags.Ephemeral }));
  if (!(await ensureCommandAccess(interaction, { allowedChannelIds: allowedChannels(game, chosen.gameType) }))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const say = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });

  const size = interaction.options.getInteger('size');
  if (size !== null && chosen.gameType !== 'ffa') return void (await say(`${EMOJI_FAIL} size is FFA only.`));
  const startingAge = interaction.options.getString('starting-age');
  if (startingAge !== null && game !== 'civ7') return void (await say(`${EMOJI_FAIL} starting-age is Civ7 only.`));

  const host = await member(interaction);
  if (!host) return void (await say(`${EMOJI_ERROR} Unable to resolve your member info.`));
  if (!host.voice.channel) return void (await say(`${EMOJI_FAIL} Join a voice channel first, then run /lobby create.`));
  if (!interaction.guildId || !interaction.channel?.isSendable()) {
    return void (await say(`${EMOJI_FAIL} I cannot post in this channel.`));
  }

  try {
    const lobby = await api.createLobby({
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      voice_channel_id: host.voice.channel.id,
      host_discord_id: interaction.user.id,
      edition: game,
      game_type: chosen.gameType,
      size: chosen.gameType === 'ffa' ? (size ?? FFA_SIZES[0]) : null,
      number_teams: chosen.teams ?? null,
      team_size: chosen.teamSize ?? null,
      draft_mode: chosen.draftMode ?? null,
      starting_age: startingAge as (typeof AGES)[number] | null,
      host_rules: interaction.options.getString('rules'),
    });
    await interaction.channel.send({ embeds: [buildLobbyOpenEmbed(lobby)], components: [buildLobbyButtons(lobby)] });
    await say(`${EMOJI_CONFIRM} Lobby posted. Open it from the message to take your seat.`);
  } catch (error) {
    if (error instanceof ApiError) {
      log.warn('lobby create refused', error.status, error.code);
      return void (await say(`${EMOJI_FAIL} ${error.status === 409 ? 'You are already seated in another open lobby.' : `Could not open the lobby (${error.code ?? error.status}).`}`));
    }
    log.error('lobby create failed', error);
    await say(`${EMOJI_ERROR} Could not open the lobby.`);
  }
}
