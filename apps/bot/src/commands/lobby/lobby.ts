import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { LobbyDocument } from '../../api/types.js';
import { config } from '../../config.js';
import { lobbyLabel, lobbyListPanel, lobbyOpenPanel } from '../../ui/panels/lobby.js';
import { fail, postPanel, refuse, respond, say } from '../../ui/reply.js';
import { isStaff } from '../../utils/access.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

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
  .setContexts(InteractionContextType.Guild)
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
        o.setName('size').setDescription('Seats \u2014 FFA only')
          .addChoices(...FFA_SIZES.map((n) => ({ name: String(n), value: n }))))
      .addStringOption((o) =>
        o.setName('starting-age').setDescription('Starting age \u2014 Civ7 only')
          .addChoices({ name: 'Antiquity', value: AGES[0] }, { name: 'Exploration', value: AGES[1] }, { name: 'Modern', value: AGES[2] }))
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)))
  .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel the lobby you host. Staff may cancel any in this channel.'))
  .addSubcommand((sub) => sub.setName('leave').setDescription('Leave your seat, freeing you to join another lobby.'))
  .addSubcommand((sub) => sub.setName('browse').setDescription('List the open lobbies in this guild.'));

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

// cancel and leave take no id: a player is in one lobby at a time, and a
// host hosts one, so the channel's open lobbies are enough to find it.
async function openInChannel(interaction: ChatInputCommandInteraction): Promise<LobbyDocument[]> {
  return api.browseLobbies(interaction.guildId ?? '', interaction.user.id, interaction.channelId);
}

async function runCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const staff = isStaff(interaction);
  const open = await openInChannel(interaction);
  const mine = open.filter((l) => staff || l.host_discord_id === interaction.user.id);
  if (mine.length === 0) {
    refuse(staff ? 'There is no open lobby in this channel.' : 'You are not hosting an open lobby in this channel.');
  }
  if (mine.length > 1) refuse(`There are ${mine.length} open lobbies here. Cancel the one you mean from the Activity.`);
  const lobby = mine[0]!;
  await api.cancelLobby(lobby._id, lobby.host_discord_id, lobby.revision, staff);
  await say(interaction, 'success', `${lobbyLabel(lobby)} lobby cancelled.`);
}

async function runLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  const seated = (await openInChannel(interaction)).filter((l) => l.seats.some((s) => s.discord_id === interaction.user.id));
  if (seated.length === 0) refuse('You are not seated in an open lobby in this channel.');
  const lobby = seated[0]!;
  if (lobby.host_discord_id === interaction.user.id) refuse('You host this lobby. Use /lobby cancel to close it.');
  await api.leaveLobby(lobby._id, interaction.user.id, lobby.revision);
  await say(interaction, 'success', `You left the ${lobbyLabel(lobby)} lobby. You can join another now.`);
}

async function runBrowse(interaction: ChatInputCommandInteraction): Promise<void> {
  const open = await api.browseLobbies(interaction.guildId ?? '', interaction.user.id);
  if (open.length === 0) return say(interaction, 'muted', 'No lobbies are open right now. Start one with /lobby create.');
  await respond(interaction, lobbyListPanel(open), 'private');
}

async function runCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const game = interaction.options.getString('game', true) as Game;
  const chosen = MODES.find((m) => m.value === interaction.options.getString('mode', true));
  if (!chosen) refuse('That mode is not offered. Pick one from the list.');
  if (!(await ensureCommandAccess(interaction, { allowedChannelIds: allowedChannels(game, chosen.gameType) }))) return;

  const size = interaction.options.getInteger('size');
  if (size !== null && chosen.gameType !== 'ffa') refuse('Size applies to FFA lobbies only.');
  const startingAge = interaction.options.getString('starting-age');
  if (startingAge !== null && game !== 'civ7') refuse('Starting age applies to Civ7 lobbies only.');

  const host = await member(interaction);
  if (!host) throw new Error('lobby host is not a resolvable guild member');
  if (!host.voice.channel) refuse('Join a voice channel first, then run /lobby create.');
  const channel = interaction.channel;
  if (!interaction.guildId || !channel?.isSendable()) {
    refuse('I cannot post in this channel. Ask staff to check my permissions here.');
  }

  const lobby = await api.createLobby(
    {
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
    },
    host.displayName,
  );
  await postPanel(channel, lobbyOpenPanel(lobby));
  await say(interaction, 'success', 'Lobby posted. Open it from the message to take your seat.');
}

const ACTION: Readonly<Record<string, string>> = {
  create: 'open the lobby',
  cancel: 'cancel the lobby',
  leave: 'leave the lobby',
  browse: 'list the open lobbies',
};

// Every answer is private; the lobby itself is posted to the channel.
export const visibility = 'private';

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  try {
    if (sub === 'create') await runCreate(interaction);
    else if (sub === 'cancel') await runCancel(interaction);
    else if (sub === 'leave') await runLeave(interaction);
    else await runBrowse(interaction);
  } catch (error) {
    await fail(interaction, error, ACTION[sub] ?? `run /lobby ${sub}`, { sub });
  }
}
