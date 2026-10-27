import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { LobbyShape } from '../../api/types.js';
import { config } from '../../config.js';
import { openEditor } from '../../handlers/lobby.handlers.js';
import { closeVote } from '../../services/lobby-vote.service.js';
import { inLobbyTurn, showLobby } from '../../services/lobby.service.js';
import { SHAPES, lobbyLinkOf, openLobbiesPanel } from '../../ui/panels/lobby.js';
import { defer, fail, refuse, respond, say } from '../../ui/reply.js';
import { isStaff } from '../../utils/access.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('lobby')
  .setDescription('Host a Civ6 lobby: set it up, fill it, vote on bans, then draft.')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('host')
      .setDescription('Set up a Civ6 lobby, then open it to players.')
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Game mode and seats')
          .setRequired(true)
          .addChoices(...(Object.keys(SHAPES) as LobbyShape[]).map((value) => ({ name: SHAPES[value], value }))),
      )
      .addStringOption((o) => o.setName('steam-link').setDescription('Optional: your Civ6 lobby link, steam://joinlobby/289070/...').setMaxLength(120))
      .addStringOption((o) => o.setName('message').setDescription('Optional: a note on the lobby, e.g. no novices').setMaxLength(200))
      .addBooleanOption((o) => o.setName('lfg').setDescription('Ping the LFG role when the lobby opens')),
  )
  .addSubcommand((sub) => sub.setName('edit').setDescription('Edit the lobby you host.'))
  .addSubcommand((sub) => sub.setName('browse').setDescription('List the open lobbies here.'))
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a lobby: its host, or staff.')
      .addStringOption((o) => o.setName('code').setDescription("The lobby's code, shown on its post").setRequired(true).setMaxLength(8)),
  );

// The lobby opens in setup, seen only by its host in their editor.
async function host(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  const policy = { allowedChannelIds: [config.discord.channels.civ6LobbyLinks], requiredRoleIds: [config.discord.roles.civ6Rank], allowDeveloperOverride: true };
  if (!(await ensureCommandAccess(interaction, policy))) return;
  const steamLink = interaction.options.getString('steam-link')?.trim() || null;
  if (steamLink && !lobbyLinkOf(steamLink, config.lobbyLinkUrl)) {
    refuse('That is not a Civ6 lobby link. Paste the steam://joinlobby/289070/... link of your lobby, or leave it out.');
  }
  const lfg = interaction.options.getBoolean('lfg') ?? false;
  if (lfg && !config.discord.roles.civ6Lfg) refuse('This server has no LFG role set up, so leave lfg off.');
  await defer(interaction, 'private');
  const lobby = await api.hostLobby(
    {
      shape: interaction.options.getString('mode', true) as LobbyShape,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      steam_link: steamLink,
      message: interaction.options.getString('message')?.trim() || null,
      lfg,
    },
    { id: interaction.user.id },
  );
  // An editor that cannot open would leave the host's seat held by a lobby no one sees.
  await openEditor(interaction, lobby).catch(async (error: unknown) => {
    await api.cancelLobby(lobby.guild_id, lobby.code, { id: interaction.user.id }).catch(() => undefined);
    throw error;
  });
}

async function browse(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  await defer(interaction, 'private');
  await respond(interaction, openLobbiesPanel(await api.openLobbies(interaction.guildId)), 'private');
}

// The host's editor for the lobby they host, until it starts.
async function edit(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  await defer(interaction, 'private');
  const [mine] = await api.openLobbies(interaction.guildId, interaction.user.id);
  if (!mine) refuse('You are not hosting an open lobby.');
  if (mine.phase !== 'setup' && mine.phase !== 'live') refuse('Your lobby has started, so it can no longer be edited.');
  await openEditor(interaction, mine);
}

async function cancel(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  await defer(interaction, 'private');
  const code = interaction.options.getString('code', true);
  const cancelled = await api.cancelLobby(interaction.guildId, code, { id: interaction.user.id, isStaff: isStaff(interaction) });
  await inLobbyTurn(cancelled.id, async () => {
    await showLobby(interaction.client, cancelled, api);
    await closeVote(interaction.client, cancelled);
  });
  await say(interaction, 'success', `Lobby ${cancelled.code} is cancelled.`);
}

const ACTION: Readonly<Record<string, string>> = { host: 'host the lobby', browse: 'list the lobbies', edit: 'open the editor', cancel: 'cancel the lobby' };

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  try {
    if (!interaction.inGuild()) refuse('Lobbies are hosted in a server.');
    if (sub === 'host') await host(interaction);
    else if (sub === 'browse') await browse(interaction);
    else if (sub === 'edit') await edit(interaction);
    else await cancel(interaction);
  } catch (error) {
    await fail(interaction, error, ACTION[sub] ?? 'run /lobby', { command: 'lobby' });
  }
}
