import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  ModalMessageModalSubmitInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

import { ApiClient } from '../api/index.js';
import type { Actor, CivDataResponse, Lobby, LobbyShape, SettingQuestion } from '../api/types.js';
import { civNames, civRows } from '../services/civ-names.js';
import { advanceLobby, keepTime, openVote, showBlindStatus } from '../services/lobby-vote.service.js';
import { inLobbyTurn, lobbySettings, publishLobby, showLobby } from '../services/lobby.service.js';
import { loadMembers, memberNames } from '../services/members.js';
import { allFinished, allPicked, pickingBy } from '../services/setup.js';
import { parseId, type CivNames } from '../ui/kit/index.js';
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
import { defer, fail, holdPanel, refuse, replacePanel, respond, updatePanel } from '../ui/reply.js';
import { idleCloser, type Closer } from '../utils/idle.js';
import { log } from '../utils/log.js';
import { selectedIn } from '../utils/modal-fields.js';

const api = new ApiClient();

// One editor per lobby, held by its host, drawn from reads made as it opens so
// no press waits. It closes after two minutes idle (ten with a form out).
type Session = Readonly<{
  messageId: string;
  draft: EditorDraft;
  questions: readonly SettingQuestion[];
  names: CivNames;
  rows: CivDataResponse;
  saving: boolean;
}>;
const sessions = new Map<string, Session>();
const editors = idleCloser();
const IDLE_MS = 2 * 60_000;
const FORM_MS = 10 * 60_000;
const TOKEN_MS = 14 * 60_000;

type EditorPress = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;
type EditorUpdate = ButtonInteraction | StringSelectMenuInteraction | ModalMessageModalSubmitInteraction;

// What each press does, completing "Could not ...".
const ACTION: Readonly<Record<string, string>> = {
  [VERB.join]: 'join the lobby',
  [VERB.leave]: 'leave the lobby',
  [VERB.start]: 'start the lobby',
  [VERB.setting]: 'set the game setting',
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
      const held = sessions.get(lobbyId);
      if (!held) return;
      if (held.messageId !== messageId) return replacePanel(interaction, closedEditor('You opened the editor again, so this one closed.'));
      sessions.delete(lobbyId);
      if (held.draft.lobby.phase !== 'setup') return replacePanel(interaction, closedEditor('Closed with no activity. Nothing was saved.'));
      const { guild_id, code } = held.draft.lobby;
      await api.cancelLobby(guild_id, code, actorOf(interaction)).catch((error: unknown) => log.warn('unconfirmed lobby not cancelled', lobbyId, error));
      await replacePanel(interaction, closedEditor('Closed with no activity, so the lobby was cancelled. Run /lobby host again.'));
    }),
  until: Date.now() + TOKEN_MS,
});

const drawn = (session: Session, guild: Interaction['guild']) =>
  editorPanel(session.draft, {
    questions: session.questions,
    names: session.names,
    playerNames: memberNames(guild, session.draft.lobby.players.map((p) => p.discord_id)),
  });

// The host's editor, privately: in setup straight after /lobby host, or from
// /lobby edit while live. A newer editor closes the one before it.
export async function openEditor(interaction: ChatInputCommandInteraction, lobby: Lobby): Promise<void> {
  const [questions, names, rows] = await Promise.all([
    lobbySettings(lobby.mode, api),
    civNames('civ6', api),
    civRows('civ6', api),
    loadMembers(interaction.guild, lobby.players.map((p) => p.discord_id)),
  ]);
  const opening: Session = { messageId: '', draft: draftOf(lobby), questions, names, rows, saving: false };
  const message = await respond(interaction, drawn(opening, interaction.guild), 'private');
  if (!message) throw new Error('the editor was not posted');
  sessions.set(lobby.id, { ...opening, messageId: message.id });
  editors.open(lobby.id, interaction.user.id, message.id, closerFor(interaction, lobby.id, message.id), IDLE_MS);
}

// The editor this press came from, its clock restarted. A press opening a form
// keeps the closer it had: it has no panel of its own to close.
function sessionOf(interaction: EditorPress, lobbyId: string, form = false): Session {
  const held = sessions.get(lobbyId);
  const messageId = interaction.message?.id ?? '';
  if (held?.saving) refuse('Your changes are being saved. Try again in a moment.');
  const closer = form ? undefined : closerFor(interaction, lobbyId, messageId);
  if (!held || held.messageId !== messageId || !editors.touch(lobbyId, messageId, form ? FORM_MS : IDLE_MS, closer)) {
    refuse('This editor has closed. Open it again with /lobby edit.');
  }
  return held;
}

// A press on the editor that calls core-api, worked in the lobby's turn. A
// newer editor opened meanwhile has the session, so this one does nothing.
async function inEditorTurn(interaction: EditorPress, lobbyId: string, work: (session: Session) => Promise<void>): Promise<void> {
  const session = sessionOf(interaction, lobbyId);
  const mine = (held: Session | undefined): held is Session => held?.messageId === session.messageId;
  sessions.set(lobbyId, { ...session, saving: true });
  try {
    await holdPanel(interaction);
    await inLobbyTurn(lobbyId, async () => {
      const held = sessions.get(lobbyId);
      if (mine(held)) await work(held);
    });
  } finally {
    const held = sessions.get(lobbyId);
    if (mine(held)) sessions.set(lobbyId, { ...held, saving: false });
  }
}

// The draft changed and the editor redrawn in the press's own answer: the
// change is local, so nothing waits on core-api or the lobby's turn.
async function onEditor(interaction: EditorUpdate, lobbyId: string, change: (session: Session) => EditorDraft): Promise<void> {
  const session = sessionOf(interaction, lobbyId);
  const next = { ...session, draft: change(session) };
  sessions.set(lobbyId, next);
  await updatePanel(interaction, drawn(next, interaction.guild));
}

// The editor's last word: the session is gone, so the closer has nothing to do.
async function finish(interaction: EditorPress, lobbyId: string, message: string): Promise<void> {
  sessions.delete(lobbyId);
  await replacePanel(interaction, closedEditor(message));
  editors.close(lobbyId);
}

async function save(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async ({ draft }) => {
    const lobby = await api.editLobby(lobbyId, actorOf(interaction), editOf(draft));
    await showLobby(interaction.client, lobby, api);
    keepTime(interaction.client, lobby, api);
    await finish(interaction, lobbyId, 'Saved. The lobby shows your changes.');
  });
}

async function revert(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async (session) => {
    const reverted = { ...session, draft: draftOf(await api.lobby(lobbyId)) };
    sessions.set(lobbyId, reverted);
    await replacePanel(interaction, drawn(reverted, interaction.guild));
  });
}

async function confirm(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async ({ draft }) => {
    const lobby = await api.editLobby(lobbyId, actorOf(interaction), editOf(draft));
    await publishLobby(interaction.client, lobby, actorOf(interaction), api);
    await finish(interaction, lobbyId, 'Your lobby is open. Players join from its post.');
  });
}

async function discard(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await inEditorTurn(interaction, lobbyId, async ({ draft }) => {
    await api.cancelLobby(draft.lobby.guild_id, draft.lobby.code, actorOf(interaction));
    await finish(interaction, lobbyId, 'The lobby was cancelled.');
  });
}

// A setting picked: kept in the draft and acknowledged without a redraw, so
// quick picks never race one. The menu already shows the pick.
async function pickSetting(interaction: StringSelectMenuInteraction, lobbyId: string, question: string, value: string): Promise<void> {
  const session = sessionOf(interaction, lobbyId);
  sessions.set(lobbyId, { ...session, draft: withSetting(session.draft, question, value) });
  await holdPanel(interaction);
}

async function openBans(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  const { draft, rows, names } = sessionOf(interaction, lobbyId, true);
  await interaction.showModal(lobbyBanForm(draft, rows, names));
}

async function setBans(interaction: ModalSubmitInteraction, lobbyId: string): Promise<void> {
  if (!interaction.isFromMessage()) refuse('This form is out of date.');
  await onEditor(interaction, lobbyId, ({ draft, rows }) => withBans(draft, selectedIn(interaction, banFieldIds(LOBBY_BANS, rows).leaders)));
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
    if (allFinished(lobby)) await advanceLobby(interaction.client, lobbyId, api, true);
  });
}

const pickingLobby = async (lobbyId: string, playerId: string): Promise<Lobby> => pickingBy(await api.lobby(lobbyId), playerId, 'lobby');

// A player's pool panel, from cached civ data.
async function poolPanel(lobby: Lobby, playerId: string, leader?: string) {
  const [names, data] = await Promise.all([civNames('civ6', api), civRows('civ6', api)]);
  return blindPickPanel(lobby, playerId, names, data, leader);
}

// A blind drafter's own pool, privately.
async function showPool(interaction: ButtonInteraction, lobbyId: string): Promise<void> {
  await defer(interaction, 'private');
  const lobby = await pickingLobby(lobbyId, interaction.user.id);
  await respond(interaction, await poolPanel(lobby, interaction.user.id), 'private');
}

// A leader chosen from the pool, not yet locked in.
async function chooseLeader(interaction: StringSelectMenuInteraction, lobbyId: string, leader: string): Promise<void> {
  await holdPanel(interaction);
  const lobby = await pickingLobby(lobbyId, interaction.user.id);
  await replacePanel(interaction, await poolPanel(lobby, interaction.user.id, leader));
}

// The pick locked in; once every player has, the picks are revealed.
async function lockIn(interaction: ButtonInteraction, lobbyId: string, leader: string): Promise<void> {
  await holdPanel(interaction);
  await inLobbyTurn(lobbyId, async () => {
    const lobby = await api.pickLeader(lobbyId, actorOf(interaction), leader);
    await replacePanel(interaction, await poolPanel(lobby, interaction.user.id));
    await showBlindStatus(interaction.client, lobby);
    if (allPicked(lobby)) await advanceLobby(interaction.client, lobbyId, api, true);
  });
}

const VIEWS: readonly EditorView[] = ['main', 'settings', 'lobby'];

async function onSelect(interaction: StringSelectMenuInteraction, verb: string, lobbyId: string, arg: string): Promise<void> {
  const value = interaction.values[0] ?? '';
  if (verb === VERB.setting) return pickSetting(interaction, lobbyId, arg, value);
  if (verb === VERB.shape) return onEditor(interaction, lobbyId, ({ draft }) => withShape(draft, value as LobbyShape));
  if (verb === VERB.kick) return onEditor(interaction, lobbyId, ({ draft }) => withKick(draft, value));
  if (verb === VERB.picked) return chooseLeader(interaction, lobbyId, value);
  if (verb === VERB.move) {
    const [player = '', team = ''] = value.split(':');
    return onEditor(interaction, lobbyId, ({ draft }) => withMove(draft, player, Number(team)));
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
  if (verb === VERB.view && VIEWS.includes(arg as EditorView)) return onEditor(interaction, lobbyId, ({ draft }) => withView(draft, arg as EditorView));
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
