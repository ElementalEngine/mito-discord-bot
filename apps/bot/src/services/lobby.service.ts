import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Actor, Lobby, SettingQuestion } from '../api/types.js';
import { config } from '../config.js';
import { lobbyDraftPanels, lobbyLinkOf, lobbyPanel, type LobbyView } from '../ui/panels/lobby.js';
import { editPanelById, postPanel } from '../ui/reply.js';
import { serial } from '../utils/serial.js';
import { civNames } from './civ-names.js';

// Changes to one lobby take turns, so its post is never redrawn from an older
// copy than the last.
export const inLobbyTurn = serial();

// The settings catalogue changes only by release, so one read per game type lasts.
const questions = new Map<string, Promise<readonly SettingQuestion[]>>();

export function lobbySettings(gameType: string, api: ApiClient): Promise<readonly SettingQuestion[]> {
  const held = questions.get(gameType);
  if (held) return held;
  const read = api.lobbySettings('civ6', gameType);
  questions.set(gameType, read);
  void read.catch(() => questions.delete(gameType));
  return read;
}

export async function lobbyViewOf(lobby: Lobby, api: ApiClient): Promise<LobbyView> {
  const [names, asked] = await Promise.all([civNames('civ6', api), lobbySettings(lobby.mode, api)]);
  return { lobby, names, questions: asked, link: lobbyLinkOf(lobby.steam_link, config.lobbyLinkUrl) };
}

export async function channelOf(client: Client, lobby: Lobby) {
  const channel = await client.channels.fetch(lobby.channel_id);
  return channel?.isTextBased() && channel.isSendable() ? channel : null;
}

// Redraw the lobby's post. Once it has drafted, each draft follows as its own
// message beneath it.
export async function showLobby(client: Client, lobby: Lobby, api: ApiClient, drafted = false): Promise<void> {
  const channel = await channelOf(client, lobby);
  if (!channel || !lobby.message_id) return;
  const view = await lobbyViewOf(lobby, api);
  await editPanelById(channel, lobby.message_id, lobbyPanel(view));
  if (drafted) for (const panel of lobbyDraftPanels(lobby, view.names)) await postPanel(channel, panel);
}

// The host confirms: the lobby's post goes up in its channel, and from then on
// players join from it.
export async function publishLobby(client: Client, lobby: Lobby, host: Actor, api: ApiClient): Promise<Lobby> {
  const channel = await channelOf(client, lobby);
  if (!channel) throw new Error(`lobby channel ${lobby.channel_id} is not one the bot can post in`);
  const post = await postPanel(channel, lobbyPanel(await lobbyViewOf(lobby, api)));
  try {
    return await api.openLobby(lobby.id, host, post.id);
  } catch (error) {
    await post.delete().catch(() => undefined);
    throw error;
  }
}
