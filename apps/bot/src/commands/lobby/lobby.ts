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
type Mode = 'ffa' | 'teamer' | 'duel';

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
          .addChoices({ name: 'FFA', value: 'ffa' }, { name: 'Teamer', value: 'teamer' }, { name: 'Duel', value: 'duel' }))
      .addIntegerOption((o) =>
        o.setName('size').setDescription('Seats — FFA only')
          .addChoices(...FFA_SIZES.map((n) => ({ name: String(n), value: n }))))
      .addIntegerOption((o) => o.setName('number-of-teams').setDescription('Teams — teamer only').setMinValue(2).setMaxValue(6))
      .addIntegerOption((o) => o.setName('team-size').setDescription('Players per team — teamer only').setMinValue(1).setMaxValue(6))
      .addStringOption((o) =>
        o.setName('draft-mode').setDescription('Draft mode — teamer only')
          .addChoices({ name: 'standard', value: 'standard' }, { name: 'cwc (two teams only)', value: 'cwc' }))
      .addStringOption((o) =>
        o.setName('starting-age').setDescription('Starting age — Civ7 only')
          .addChoices({ name: 'Antiquity', value: AGES[0] }, { name: 'Exploration', value: AGES[1] }, { name: 'Modern', value: AGES[2] }))
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)));

function allowedChannels(game: Game, mode: Mode): readonly string[] {
  const c = config.discord.channels;
  const vote = mode === 'teamer'
    ? (game === 'civ6' ? c.civ6teamerVote : c.civ7teamerVote)
    : (game === 'civ6' ? c.civ6ffaVote : c.civ7ffaVote);
  return mode === 'duel' ? [vote] : [vote, c.noviceCommands];
}

// Every option that only applies to one shape, refused in one place.
function wrongFor(game: Game, mode: Mode, o: ChatInputCommandInteraction['options']): string | null {
  if (mode !== 'ffa' && o.getInteger('size') !== null) return 'size is FFA only.';
  if (mode !== 'teamer' && (o.getInteger('number-of-teams') !== null || o.getInteger('team-size') !== null || o.getString('draft-mode') !== null))
    return 'number-of-teams, team-size and draft-mode are teamer only.';
  if (mode === 'teamer' && (o.getInteger('number-of-teams') === null || o.getInteger('team-size') === null))
    return 'A teamer needs number-of-teams and team-size.';
  if (game !== 'civ7' && o.getString('starting-age') !== null) return 'starting-age is Civ7 only.';
  if (o.getString('draft-mode') === 'cwc' && o.getInteger('number-of-teams') !== 2) return 'CWC is two teams only.';
  return null;
}

async function member(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
  if (!interaction.inGuild() || !interaction.guild) return null;
  if (interaction.inCachedGuild()) return interaction.member;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const game = interaction.options.getString('game', true) as Game;
  const mode = interaction.options.getString('mode', true) as Mode;
  if (!(await ensureCommandAccess(interaction, { allowedChannelIds: allowedChannels(game, mode) }))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const say = (content: string) => interaction.editReply({ content, allowedMentions: { parse: [] } });

  const wrong = wrongFor(game, mode, interaction.options);
  if (wrong) return void (await say(`${EMOJI_FAIL} ${wrong}`));

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
      game_type: mode,
      size: mode === 'ffa' ? (interaction.options.getInteger('size') ?? FFA_SIZES[0]) : null,
      number_teams: interaction.options.getInteger('number-of-teams'),
      team_size: interaction.options.getInteger('team-size'),
      draft_mode: mode === 'teamer' ? ((interaction.options.getString('draft-mode') ?? 'standard') as 'standard' | 'cwc') : null,
      starting_age: interaction.options.getString('starting-age') as (typeof AGES)[number] | null,
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
