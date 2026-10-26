import type { ButtonInteraction, Interaction, ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Actor, Lobby } from '../api/types.js';
import { civNames, civRows } from '../services/civ-names.js';
import { inLobbyTurn, lobbySettings, showLobby } from '../services/lobby.service.js';
import { loadMembers, memberNames } from '../services/members.js';
import { parseId } from '../ui/kit/index.js';
import { banFieldIds } from '../ui/panels/draft.js';
import { LOBBY_BANS, VERB, lobbyBanForm, settingsAfter, settingsPanel, teamsPanel } from '../ui/panels/lobby.js';
import { defer, fail, holdPanel, refuse, replacePanel, respond, say } from '../ui/reply.js';
import { isStaff } from '../utils/access.js';
import { selectedIn } from '../utils/modal-fields.js';

const api = new ApiClient();

// What each press does, completing "Could not ...".
const ACTION: Readonly<Record<string, string>> = {
  [VERB.join]: 'join the lobby',
  [VERB.leave]: 'leave the lobby',
  [VERB.start]: 'start the lobby',
  [VERB.cancel]: 'cancel the lobby',
  [VERB.settings]: 'open the settings',
  [VERB.setting]: 'fix that setting',
  [VERB.bans]: 'open the bans',
  [VERB.bansForm]: 'save the bans',
  [VERB.teams]: 'open the teams',
  [VERB.move]: 'move that player',
};

const actorOf = (interaction: Interaction): Actor => ({ id: interaction.user.id });

async function hostsLobby(interaction: Interaction, lobbyId: string): Promise<Lobby> {
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open') refuse('This lobby is closed.');
  if (lobby.host_id !== interaction.user.id) refuse('Only the host can do that.');
  return lobby;
}

// A press on the lobby's post: the change, then the post redrawn. A lobby the
// change fills then starts itself, with the bot acting as its host.
async function onPost(interaction: ButtonInteraction, lobbyId: string, change: () => Promise<Lobby>): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const changed = await change();
    await showLobby(interaction.client, changed, api, changed.status === 'done');
    if (changed.status === 'open' && changed.players.length === changed.seats) {
      await showLobby(interaction.client, await api.startLobby(lobbyId, { id: changed.host_id }), api, true);
    }
  });
}

async function openSettings(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await defer(interaction, 'private');
  const lobby = await hostsLobby(interaction, lobbyId);
  await respond(interaction, settingsPanel(lobby, await lobbySettings(lobby.mode, api)), 'private');
}

async function fixSetting(interaction: StringSelectMenuInteraction, lobbyId: string, question: string): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const lobby = await hostsLobby(interaction, lobbyId);
    const fixed = await api.fixLobbySettings(lobbyId, actorOf(interaction), settingsAfter(lobby, question, interaction.values[0] ?? ''));
    await replacePanel(interaction, settingsPanel(fixed, await lobbySettings(fixed.mode, api)));
    await showLobby(interaction.client, fixed, api);
  });
}

// The form must be the press's first answer, so it is built from cache-warm
// reads before anything is said.
async function openBans(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  const [lobby, rows, names] = await Promise.all([hostsLobby(interaction, lobbyId), civRows('civ6', api), civNames('civ6', api)]);
  await interaction.showModal(lobbyBanForm(lobby, rows, names));
}

async function saveBans(interaction: ModalSubmitInteraction, lobbyId: string): Promise<void> {
  await defer(interaction, 'private');
  const leaders = selectedIn(interaction, banFieldIds(LOBBY_BANS, await civRows('civ6', api)).leaders);
  await inLobbyTurn(lobbyId, async () => {
    const lobby = await api.banLobbyLeaders(lobbyId, actorOf(interaction), leaders);
    await showLobby(interaction.client, lobby, api);
  });
  await say(interaction, 'success', leaders.length ? `${leaders.length} leaders banned.` : 'No leaders banned.');
}

async function openTeams(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await defer(interaction, 'private');
  const lobby = await hostsLobby(interaction, lobbyId);
  const ids = lobby.players.map((p) => p.discord_id);
  await loadMembers(interaction.guild, ids);
  await respond(interaction, teamsPanel(lobby, memberNames(interaction.guild, ids)), 'private');
}

async function movePlayer(interaction: StringSelectMenuInteraction, lobbyId: string): Promise<void> {
  const [playerId = '', team = ''] = (interaction.values[0] ?? '').split(':');
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const lobby = await api.moveLobbyPlayer(lobbyId, actorOf(interaction), playerId, Number(team));
    const ids = lobby.players.map((p) => p.discord_id);
    await replacePanel(interaction, teamsPanel(lobby, memberNames(interaction.guild, ids)));
    await showLobby(interaction.client, lobby, api);
  });
}

async function route(interaction: Interaction, verb: string, lobbyId: string, arg: string): Promise<void> {
  if (interaction.isButton()) {
    if (verb === VERB.join) return onPost(interaction, lobbyId, () => api.joinLobby(lobbyId, actorOf(interaction)));
    if (verb === VERB.leave) return onPost(interaction, lobbyId, () => api.leaveLobby(lobbyId, actorOf(interaction)));
    if (verb === VERB.start) return onPost(interaction, lobbyId, () => api.startLobby(lobbyId, actorOf(interaction)));
    if (verb === VERB.cancel) {
      return onPost(interaction, lobbyId, () => api.cancelLobby(lobbyId, { id: interaction.user.id, isStaff: isStaff(interaction) }));
    }
    if (verb === VERB.settings) return openSettings(interaction, lobbyId);
    if (verb === VERB.bans) return openBans(interaction, lobbyId);
    if (verb === VERB.teams) return openTeams(interaction, lobbyId);
  }
  if (interaction.isStringSelectMenu()) {
    if (verb === VERB.setting) return fixSetting(interaction, lobbyId, arg);
    if (verb === VERB.move) return movePlayer(interaction, lobbyId);
  }
  if (interaction.isModalSubmit() && verb === VERB.bansForm) return saveBans(interaction, lobbyId);
  refuse('This button is out of date.');
}

export async function handleLobbyInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'lobby') return false;
  try {
    await route(interaction, id.verb, id.args[0] ?? '', id.args[1] ?? '');
  } catch (error) {
    await fail(interaction, error, ACTION[id.verb] ?? 'complete that action', { customId: interaction.customId });
  }
  return true;
}
