import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Actor, Lobby, LobbyShape } from '../api/types.js';
import { civNames, civRows } from '../services/civ-names.js';
import { advanceLobby, keepTime, openVote, showBlindStatus } from '../services/lobby-vote.service.js';
import { inLobbyTurn, lobbySettings, publishLobby, showLobby } from '../services/lobby.service.js';
import { loadMembers, memberNames } from '../services/members.js';
import { parseId } from '../ui/kit/index.js';
import { banFieldIds } from '../ui/panels/draft.js';
import {
  LOBBY_BANS,
  VERB,
  closedEditor,
  draftOf,
  editOf,
  editorPanel,
  lobbyBanForm,
  withBans,
  withKick,
  withMove,
  withSetting,
  withShape,
  withView,
  type EditorDraft,
  type EditorView,
} from '../ui/panels/lobby.js';
import { blindPickPanel, voteStatusPanel } from '../ui/panels/lobby-vote.js';
import { defer, fail, holdPanel, refuse, replacePanel, respond } from '../ui/reply.js';
import { idleCloser, type Closer } from '../utils/idle.js';
import { log } from '../utils/log.js';
import { selectedIn } from '../utils/modal-fields.js';

const api = new ApiClient();

// One editor per lobby, held by its host. It closes after two minutes idle
// (ten with the bans form out), and always before its token expires.
const editors = idleCloser();
const drafts = new Map<string, Readonly<{ messageId: string; draft: EditorDraft }>>();
const IDLE_MS = 2 * 60_000;
const FORM_MS = 10 * 60_000;
const TOKEN_MS = 14 * 60_000;

type EditorPress = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

// What each press does, completing "Could not ...".
const ACTION: Readonly<Record<string, string>> = {
  [VERB.join]: 'join the lobby',
  [VERB.leave]: 'leave the lobby',
  [VERB.start]: 'start the lobby',
  [VERB.bansForm]: 'set the bans',
  [VERB.done]: 'save your changes',
  [VERB.confirm]: 'open the lobby',
  [VERB.discard]: 'cancel the lobby',
  [VERB.finished]: 'finish voting',
  [VERB.pick]: 'show your pool',
  [VERB.picked]: 'choose your leader',
  [VERB.lockIn]: 'lock in your pick',
};

const actorOf = (interaction: Interaction): Actor => ({ id: interaction.user.id });

// Idle, an editor drops its draft and a setup lobby is cancelled, freeing its
// host. One a newer editor replaced just says so.
const closerFor = (interaction: ChatInputCommandInteraction | EditorPress, lobbyId: string, messageId: string): Closer => ({
  close: () =>
    inLobbyTurn(lobbyId, async () => {
      const held = drafts.get(lobbyId);
      if (!held) return;
      if (held.messageId !== messageId) return replacePanel(interaction, closedEditor('You opened the editor again, so this one closed.'));
      drafts.delete(lobbyId);
      if (held.draft.lobby.phase !== 'setup') return replacePanel(interaction, closedEditor('Closed with no activity. Nothing was saved.'));
      const { guild_id, code } = held.draft.lobby;
      await api.cancelLobby(guild_id, code, actorOf(interaction)).catch((error: unknown) => log.warn('unconfirmed lobby not cancelled', lobbyId, error));
      await replacePanel(interaction, closedEditor('Closed with no activity, so the lobby was cancelled. Run /lobby host again.'));
    }),
  until: Date.now() + TOKEN_MS,
});

async function editorContext(draft: EditorDraft, guild: Interaction['guild']) {
  const ids = draft.lobby.players.map((p) => p.discord_id);
  const [questions, names] = await Promise.all([lobbySettings(draft.lobby.mode, api), civNames('civ6', api), loadMembers(guild, ids)]);
  return { questions, names, playerNames: memberNames(guild, ids) };
}

// The host's editor, privately: in setup straight after /lobby host, or from
// /lobby edit while live. A newer editor closes the one before it.
export async function openEditor(interaction: ChatInputCommandInteraction, lobby: Lobby): Promise<void> {
  const draft = draftOf(lobby);
  const message = await respond(interaction, editorPanel(draft, await editorContext(draft, interaction.guild)), 'private');
  if (!message) throw new Error('the editor was not posted');
  drafts.set(lobby.id, { messageId: message.id, draft });
  editors.open(lobby.id, interaction.user.id, message.id, closerFor(interaction, lobby.id, message.id), IDLE_MS);
}

// The draft of the editor this press came from, its clock restarted. A press
// opening a form keeps the closer it had: it has no panel of its own to close.
function editorDraft(interaction: EditorPress, lobbyId: string, ms = IDLE_MS): EditorDraft {
  const held = drafts.get(lobbyId);
  const messageId = interaction.message?.id ?? '';
  const closer = ms === FORM_MS ? undefined : closerFor(interaction, lobbyId, messageId);
  if (!held || held.messageId !== messageId || !editors.touch(lobbyId, messageId, ms, closer)) {
    refuse('This editor has closed. Open it again with /lobby edit.');
  }
  return held.draft;
}

// A press on the editor, worked in the lobby's turn on its draft. A newer
// editor opened meanwhile has the draft, so this press then does nothing.
async function inEditorTurn(interaction: EditorPress, lobbyId: string, work: (draft: EditorDraft) => Promise<void>): Promise<void> {
  editorDraft(interaction, lobbyId);
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const held = drafts.get(lobbyId);
    if (held && held.messageId === interaction.message?.id) await work(held.draft);
  });
}

// The draft changed and the editor redrawn.
async function onEditor(interaction: EditorPress, lobbyId: string, change: (draft: EditorDraft) => EditorDraft | Promise<EditorDraft>): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async (draft) => {
    const next = await change(draft);
    const held = drafts.get(lobbyId);
    if (held) drafts.set(lobbyId, { ...held, draft: next });
    await replacePanel(interaction, editorPanel(next, await editorContext(next, interaction.guild)));
  });
}

// The editor's last word: the draft is gone, so the closer has nothing to do.
async function finish(interaction: EditorPress, lobbyId: string, message: string): Promise<void> {
  drafts.delete(lobbyId);
  await replacePanel(interaction, closedEditor(message));
  editors.close(lobbyId);
}

async function save(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async (draft) => {
    const lobby = await api.editLobby(lobbyId, actorOf(interaction), editOf(draft));
    await showLobby(interaction.client, lobby, api);
    keepTime(interaction.client, lobby, api);
    await finish(interaction, lobbyId, 'Saved. The lobby shows your changes.');
  });
}

async function revert(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await onEditor(interaction, lobbyId, async () => draftOf(await api.lobby(lobbyId)));
}

async function confirm(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async (draft) => {
    const lobby = await api.editLobby(lobbyId, actorOf(interaction), editOf(draft));
    await publishLobby(interaction.client, lobby, actorOf(interaction), api);
    await finish(interaction, lobbyId, 'Your lobby is open. Players join from its post.');
  });
}

async function discard(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async ({ lobby }) => {
    await api.cancelLobby(lobby.guild_id, lobby.code, actorOf(interaction));
    await finish(interaction, lobbyId, 'The lobby was cancelled.');
  });
}

// The form must be the press's first answer, so it is built from cache-warm
// reads before anything is said; it keeps the editor open meanwhile.
async function openBans(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  const draft = editorDraft(interaction, lobbyId, FORM_MS);
  const [rows, names] = await Promise.all([civRows('civ6', api), civNames('civ6', api)]);
  await interaction.showModal(lobbyBanForm(draft, rows, names));
}

async function setBans(interaction: ModalSubmitInteraction, lobbyId: string): Promise<void> {
  const fields = banFieldIds(LOBBY_BANS, await civRows('civ6', api));
  await onEditor(interaction, lobbyId, (draft) => withBans(withView(draft, 'main'), selectedIn(interaction, fields.leaders)));
}

// A press on the lobby's post: the change, then the post redrawn. The host's
// Start opens the bans vote; a full lobby's countdown opens it at its end.
async function onPost(interaction: ButtonInteraction, lobbyId: string, change: () => Promise<Lobby>): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const changed = await change();
    if (changed.phase === 'voting') return openVote(interaction.client, changed, api);
    await showLobby(interaction.client, changed, api);
    keepTime(interaction.client, changed, api);
  });
}

// A player is done voting; once every player is, the vote is counted.
async function finishVoting(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const lobby = await api.finishVote(lobbyId, actorOf(interaction));
    await replacePanel(interaction, voteStatusPanel(lobby, await civNames('civ6', api)));
    if (lobby.players.every((p) => lobby.vote?.finished.includes(p.discord_id))) await advanceLobby(interaction.client, lobbyId, api);
  });
}

async function pickingLobby(lobbyId: string, playerId: string): Promise<Lobby> {
  const lobby = await api.lobby(lobbyId);
  if (lobby.status !== 'open' || lobby.phase !== 'picking') refuse('The blind picks are closed.');
  if (!lobby.pools.some((p) => p.player_id === playerId)) refuse("Only the lobby's players pick.");
  return lobby;
}

// A blind drafter's own pool, privately here, for anyone the DM missed.
async function showPool(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await defer(interaction, 'private');
  const lobby = await pickingLobby(lobbyId, interaction.user.id);
  await respond(interaction, blindPickPanel(lobby, interaction.user.id, await civNames('civ6', api)), 'private');
}

// A leader chosen from the pool, not yet locked in.
async function chooseLeader(interaction: StringSelectMenuInteraction, lobbyId: string, leader: string): Promise<void> {
  await holdPanel(interaction);
  const lobby = await pickingLobby(lobbyId, interaction.user.id);
  await replacePanel(interaction, blindPickPanel(lobby, interaction.user.id, await civNames('civ6', api), leader));
}

// The pick locked in; once every player has, the picks are revealed.
async function lockIn(interaction: ButtonInteraction, lobbyId: string, leader: string): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const lobby = await api.pickLeader(lobbyId, actorOf(interaction), leader);
    await replacePanel(interaction, blindPickPanel(lobby, interaction.user.id, await civNames('civ6', api)));
    await showBlindStatus(interaction.client, lobby);
    if (lobby.pools.every((pool) => lobby.picks.some((p) => p.player_id === pool.player_id))) await advanceLobby(interaction.client, lobbyId, api);
  });
}

const VIEWS: readonly EditorView[] = ['main', 'settings', 'lobby'];

async function onSelect(interaction: StringSelectMenuInteraction, verb: string, lobbyId: string, arg: string): Promise<void> {
  const value = interaction.values[0] ?? '';
  if (verb === VERB.setting) return onEditor(interaction, lobbyId, (d) => withSetting(d, arg, value));
  if (verb === VERB.shape) return onEditor(interaction, lobbyId, (d) => withShape(d, value as LobbyShape));
  if (verb === VERB.kick) return onEditor(interaction, lobbyId, (d) => withKick(d, value));
  if (verb === VERB.picked) return chooseLeader(interaction, lobbyId, value);
  if (verb === VERB.move) {
    const [player = '', team = ''] = value.split(':');
    return onEditor(interaction, lobbyId, (d) => withMove(d, player, Number(team)));
  }
  refuse('This menu is out of date.');
}

async function onButton(interaction: ButtonInteraction, verb: string, lobbyId: string, arg: string): Promise<void> {
  if (verb === VERB.join) return onPost(interaction, lobbyId, () => api.joinLobby(lobbyId, actorOf(interaction)));
  if (verb === VERB.leave) return onPost(interaction, lobbyId, () => api.leaveLobby(lobbyId, actorOf(interaction)));
  if (verb === VERB.start) return onPost(interaction, lobbyId, () => api.startLobby(lobbyId, actorOf(interaction)));
  if (verb === VERB.finished) return finishVoting(interaction, lobbyId);
  if (verb === VERB.pick) return showPool(interaction, lobbyId);
  if (verb === VERB.lockIn && arg) return lockIn(interaction, lobbyId, arg);
  if (verb === VERB.view && VIEWS.includes(arg as EditorView)) return onEditor(interaction, lobbyId, (d) => withView(d, arg as EditorView));
  if (verb === VERB.bans) return openBans(interaction, lobbyId);
  if (verb === VERB.done) return save(interaction, lobbyId);
  if (verb === VERB.revert) return revert(interaction, lobbyId);
  if (verb === VERB.confirm) return confirm(interaction, lobbyId);
  if (verb === VERB.discard) return discard(interaction, lobbyId);
  refuse('This button is out of date.');
}

export async function handleLobbyInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
  const id = parseId(interaction.customId);
  if (id?.surface !== 'lobby') return false;
  const [lobbyId = '', arg = ''] = id.args;
  try {
    if (interaction.isButton()) await onButton(interaction, id.verb, lobbyId, arg);
    else if (interaction.isStringSelectMenu()) await onSelect(interaction, id.verb, lobbyId, arg);
    else if (id.verb === VERB.bansForm) await setBans(interaction, lobbyId);
    else refuse('This form is out of date.');
  } catch (error) {
    await fail(interaction, error, ACTION[id.verb] ?? 'change the lobby', { customId: interaction.customId });
  }
  return true;
}
