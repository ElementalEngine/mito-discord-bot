import type { Client } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Actor, CivVersion, Lobby, LobbyShape, SettingQuestion } from '../api/types.js';
import { config } from '../config.js';
import { isStarted, lobbyLinkOf, lobbyPanel, type LobbyView } from '../ui/panels/lobby.js';
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

// Each mode pings its own LFG role: duels the duel one, teamers the teamer one, FFAs the FFA one. Empty when unset.
export function lfgRoleFor(shape: LobbyShape, roles: Readonly<{ civ6LfgFfa: string; civ6LfgDuel: string; civ6LfgTeamer: string }> = config.discord.roles): string {
  if (shape === 'duel') return roles.civ6LfgDuel;
  return shape.startsWith('teamer-') ? roles.civ6LfgTeamer : roles.civ6LfgFfa;
}

// FFAs and duels draft in the FFA voting channel, teamers in the teamer one.
export function voteChannelOf(lobby: Lobby): string {
  const c = config.discord.channels;
  return lobby.mode === 'teamer' ? c.civ6teamerVote : c.civ6ffaVote;
}

export async function lobbyViewOf(lobby: Lobby, api: ApiClient): Promise<LobbyView> {
  const [names, asked] = await Promise.all([civNames('civ6', api), lobbySettings(lobby.mode, api)]);
  const lfgRole = lobby.lfg ? lfgRoleFor(lobby.shape) || null : null;
  const link = lobbyLinkOf(lobby.steam_link, config.lobbyLinkUrl);
  return { lobby, names, questions: asked, link, lfgRole, voteChannel: voteChannelOf(lobby) };
}

// Redraw the lobby's post. One closed before it started is removed; one that
// started stays as the record of who played.
export async function showLobby(client: Client, lobby: Lobby, api: ApiClient): Promise<void> {
  const channel = await sendableIn(client, lobby.channel_id);
  if (!channel || !lobby.message_id) return;
  if (lobby.status === 'cancelled' && !isStarted(lobby)) await channel.messages.delete(lobby.message_id).catch(() => undefined);
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
