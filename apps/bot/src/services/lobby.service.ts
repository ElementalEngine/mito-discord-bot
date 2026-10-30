import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Actor, CivVersion, Lobby, SettingQuestion } from '../api/types.js';
import { config } from '../config.js';
import { lobbyLinkOf, lobbyPanel, type LobbyView } from '../ui/panels/lobby.js';
import { editPanelById, postPanel } from '../ui/reply.js';
import { civNames } from './civ-names.js';
import { recorded, sendableIn } from './setup.js';

// The settings catalogue changes only by release, so one read per edition and
// game type lasts.
const questions = new Map<string, Promise<readonly SettingQuestion[]>>();

export function lobbySettings(gameType: string, api: ApiClient, edition: CivVersion = 'civ6'): Promise<readonly SettingQuestion[]> {
  const key = `${edition}:${gameType}`;
  const held = questions.get(key);
  if (held) return held;
  const read = api.lobbySettings(edition, gameType);
  questions.set(key, read);
  void read.catch(() => questions.delete(key));
  return read;
}

export async function lobbyViewOf(lobby: Lobby, api: ApiClient): Promise<LobbyView> {
  const [names, asked] = await Promise.all([civNames('civ6', api), lobbySettings(lobby.mode, api)]);
  const lfgRole = lobby.lfg ? config.discord.roles.civ6Lfg || null : null;
  return { lobby, names, questions: asked, link: lobbyLinkOf(lobby.steam_link, config.lobbyLinkUrl), lfgRole };
}

// Redraw the lobby's post; a cancelled lobby's post is removed.
export async function showLobby(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const channel = await sendableIn(client, lobby.channel_id);
  if (!channel || !lobby.message_id) return;
  if (lobby.status === 'cancelled') await channel.messages.delete(lobby.message_id).catch(() => undefined);
  else await editPanelById(channel, lobby.message_id, lobbyPanel(await lobbyViewOf(lobby, api)));
}

// The host confirms: the lobby's post goes up in its channel, drawn live and
// pinging the LFG role if asked, and from then on players join from it.
export async function publishLobby(client: Client, lobby: Lobby, host: Actor, api: ApiClient): Promise<Lobby> {
  const channel = await sendableIn(client, lobby.channel_id);
  if (!channel) throw new Error(`lobby channel ${lobby.channel_id} is not one the bot can post in`);
  const view = await lobbyViewOf({ ...lobby, phase: 'live' }, api);
  const post = await postPanel(channel, lobbyPanel(view), { roles: view.lfgRole ? [view.lfgRole] : [] });
  return recorded(post, () => api.openLobby(lobby.id, host, post.id));
}
