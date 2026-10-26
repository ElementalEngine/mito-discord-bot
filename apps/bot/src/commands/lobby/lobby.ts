import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { ApiClient } from '../../api/index.js';
import type { LobbyShape } from '../../api/types.js';
import { config } from '../../config.js';
import { openEditor } from '../../handlers/lobby.handlers.js';
import { showLobby } from '../../services/lobby.service.js';
import { DRAFT_MODES, SHAPES, lobbyLinkOf, openLobbiesPanel, type DraftMode } from '../../ui/panels/lobby.js';
import { defer, fail, refuse, respond, say } from '../../ui/reply.js';
import { ensureCommandAccess } from '../../utils/ensure-command-access.js';

const api = new ApiClient();

export const data = new SlashCommandBuilder()
  .setName('lobby')
  .setDescription('Host a Civ6 lobby: set it up, open it to players, then draft it.')
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
      .addStringOption((o) =>
        o
          .setName('draft')
          .setDescription('Standard: an even share of leaders each. Random: one leader each.')
          .setRequired(true)
          .addChoices(...(Object.keys(DRAFT_MODES) as DraftMode[]).map((value) => ({ name: DRAFT_MODES[value], value }))),
      )
      .addStringOption((o) => o.setName('rules').setDescription('Host rules, shown on the lobby').setMaxLength(500)),
  )
  .addSubcommand((sub) => sub.setName('browse').setDescription('List the open lobbies here.'))
  .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel the lobby you host.'));

// FFA and duels are hosted where FFAs are voted, teamers where teamers are,
// and FFAs in the novice channel too.
function hostChannels(shape: LobbyShape): string[] {
  const c = config.discord.channels;
  if (shape.startsWith('teamer')) return [c.civ6teamerVote];
  return shape === 'duel' ? [c.civ6ffaVote] : [c.civ6ffaVote, c.noviceCommands];
}

// The lobby opens in setup, seen only by its host in their editor.
async function host(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  const shape = interaction.options.getString('mode', true) as LobbyShape;
  const policy = { allowedChannelIds: hostChannels(shape), requiredRoleIds: [config.discord.roles.civ6Rank], allowDeveloperOverride: true };
  if (!(await ensureCommandAccess(interaction, policy))) return;
  const steamLink = interaction.options.getString('steam-link')?.trim() || null;
  if (steamLink && !lobbyLinkOf(steamLink, config.lobbyLinkUrl)) {
    refuse('That is not a Civ6 lobby link. Paste the steam://joinlobby/289070/... link of your lobby, or leave it out.');
  }
  await defer(interaction, 'private');
  const lobby = await api.hostLobby(
    {
      shape,
      draft_mode: interaction.options.getString('draft', true) as DraftMode,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      steam_link: steamLink,
      rules: interaction.options.getString('rules')?.trim() || null,
    },
    { id: interaction.user.id },
  );
  await openEditor(interaction, lobby);
}

async function browse(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  await defer(interaction, 'private');
  await respond(interaction, openLobbiesPanel(await api.openLobbies(interaction.guildId)), 'private');
}

async function cancel(interaction: ChatInputCommandInteraction<'cached' | 'raw'>): Promise<void> {
  await defer(interaction, 'private');
  const [mine] = await api.openLobbies(interaction.guildId, interaction.user.id);
  if (!mine) refuse('You are not hosting an open lobby.');
  const cancelled = await api.cancelLobby(mine.id, { id: interaction.user.id });
  await showLobby(interaction.client, cancelled, api);
  await say(interaction, 'success', 'Your lobby is cancelled.');
}

const ACTION: Readonly<Record<string, string>> = { host: 'host the lobby', browse: 'list the lobbies', cancel: 'cancel your lobby' };

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  try {
    if (!interaction.inGuild()) refuse('Lobbies are hosted in a server.');
    if (sub === 'host') await host(interaction);
    else if (sub === 'browse') await browse(interaction);
    else await cancel(interaction);
  } catch (error) {
    await fail(interaction, error, ACTION[sub] ?? 'run /lobby', { command: 'lobby' });
  }
}
