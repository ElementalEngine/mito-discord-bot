import { ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder } from 'discord.js';

import type { CivDataResponse, Lobby, LobbyEdit, LobbyShape, SettingQuestion } from '../../api/types.js';
import { channel, customId, field, fit, idLine, inBody, mention, row, text, when, type Block, type CivNames, type Panel } from '../kit/index.js';
import { banFields } from './draft.js';
import { PUT_TO_VOTE, VOTE_EMOJI, banLine, draftModeName, draftOutputPanels, settingLines } from './draft-output.js';

// In the order /lobby host offers them.
export const SHAPES: Readonly<Record<LobbyShape, string>> = {
  duel: 'Duel',
  'ffa-8': 'FFA, 8 seats',
  'ffa-10': 'FFA, 10 seats',
  'ffa-12': 'FFA, 12 seats',
  'ffa-14': 'FFA, 14 seats',
  'teamer-2v2': 'Teamer 2v2',
  'teamer-3v3': 'Teamer 3v3',
  'teamer-4v4': 'Teamer 4v4',
  'teamer-5v5': 'Teamer 5v5',
  'teamer-2v2v2': 'Teamer 2v2v2',
  'teamer-2v2v2v2': 'Teamer 2v2v2v2',
};

// A lobby keeps its mode and its number of teams; only its size changes.
const SIZES: readonly (readonly LobbyShape[])[] = [
  ['ffa-8', 'ffa-10', 'ffa-12', 'ffa-14'],
  ['duel'],
  ['teamer-2v2', 'teamer-3v3', 'teamer-4v4', 'teamer-5v5'],
  ['teamer-2v2v2'],
  ['teamer-2v2v2v2'],
];
const SEATS: Readonly<Record<LobbyShape, number>> = {
  'ffa-8': 8,
  'ffa-10': 10,
  'ffa-12': 12,
  'ffa-14': 14,
  duel: 2,
  'teamer-2v2': 4,
  'teamer-3v3': 6,
  'teamer-4v4': 8,
  'teamer-5v5': 10,
  'teamer-2v2v2': 6,
  'teamer-2v2v2v2': 8,
};

export const VERB = {
  join: 'join',
  leave: 'leave',
  start: 'start',
  view: 'view',
  setting: 'setting',
  shape: 'shape',
  move: 'move',
  kick: 'kick',
  bans: 'bans',
  bansForm: 'bansform',
  done: 'done',
  revert: 'revert',
  confirm: 'confirm',
  discard: 'discard',
  finished: 'finished',
  pick: 'pick',
  picked: 'picked',
  lockIn: 'lockin',
} as const;

// The vote's one message, then the blind picks' in its place.
export const VOTE_STATUS = 'status';

export const LOBBY_BANS = { edition: 'civ6', age: null } as const;
const STEAM_LINK = /^steam:\/\/joinlobby\/289070\/([0-9]+)\/(7656119[0-9]+)$/;

// Discord links only http(s), so the Steam link goes out through the redirect
// host, which accepts nothing but a lobby. Null for anything else.
export function lobbyLinkOf(steamLink: string | null, redirectUrl: string): string | null {
  const m = steamLink ? STEAM_LINK.exec(steamLink.trim()) : null;
  return m ? `${redirectUrl}/civ6/${m[1]}/${m[2]}` : null;
}

export const button = (lobby: Lobby, verb: string, label: string, style: ButtonStyle, ...args: string[]): ButtonBuilder =>
  new ButtonBuilder().setCustomId(customId('lobby', verb, lobby.id, ...args)).setLabel(label).setStyle(style);


type Seat = Readonly<{ discord_id: string; team: number | null }>;

const teamOf = (players: readonly Seat[], team: number): string[] => players.filter((p) => p.team === team).map((p) => p.discord_id);

function seatLines(lobby: Lobby, players: readonly Seat[] = lobby.players): string {
  const name = (id: string): string => `${mention(id)}${id === lobby.host_id ? ' (host)' : ''}\n${idLine(id)}`;
  if (!lobby.teams) return players.map((p, i) => `${i + 1}. ${name(p.discord_id)}`).join('\n');
  return Array.from({ length: lobby.teams }, (_, i) => {
    const team = teamOf(players, i + 1);
    return `**Team ${i + 1}**\n${team.length ? team.map(name).join('\n') : 'empty'}`;
  }).join('\n');
}

// Every lobby message carries its host and code, so players can tell it is theirs.
export const lobbyFooter = (lobby: Lobby): string => `Hosted by ${mention(lobby.host_id)} · code ${lobby.code}`;

const settingsOf = (lobby: Lobby): Record<string, string> => Object.fromEntries(lobby.settings.map((s) => [s.id, s.value]));

// The settings the draft leaves unset; the lobby opens only once none are.
const unsetOf = (settings: Readonly<Record<string, string>>, questions: readonly SettingQuestion[]): SettingQuestion[] =>
  questions.filter((q) => settings[q.id] === undefined);

// A lobby as drawn: its names, settings, Steam link, the LFG role it pings
// when asked (null for none), and the channel its vote runs in.
export type LobbyView = Readonly<{
  lobby: Lobby;
  names: CivNames;
  questions: readonly SettingQuestion[];
  link: string | null;
  lfgRole: string | null;
  voteChannel: string;
}>;

// A lobby has started once its host pressed Start, whatever its vote did since.
export const isStarted = (lobby: Lobby): boolean =>
  Boolean(lobby.started_at) || lobby.phase === 'voting' || lobby.phase === 'picking' || lobby.status === 'done';

// Why a lobby was cancelled after its start, for its record.
const CANCELLED: Readonly<Record<string, string>> = {
  host: 'by the host',
  staff: 'by staff',
  inactive: 'when a player did not finish the vote',
  idle: 'for inactivity',
};

// The lobby's post. While players join it is live, with the Steam link and the
// buttons; once its host starts it, it becomes the lobby's record of who
// played, redrawn only to say it was cancelled. Only the host starts a lobby,
// full or not.
export function lobbyPanel({ lobby, names, questions, link, lfgRole, voteChannel }: LobbyView): Panel {
  const title = `Civ6 ${SHAPES[lobby.shape]} lobby`;
  const footer = lobbyFooter(lobby);
  const started = isStarted(lobby);
  const facts = [
    ...(lobby.message ? [field('From the host', lobby.message)] : []),
    field(started ? 'Players' : 'Seats', seatLines(lobby)),
    field('Settings', settingLines(settingsOf(lobby), questions)),
    field('Leader bans', banLine(names, lobby.bans.map((b) => b.token))),
  ];
  if (started) {
    const at = lobby.started_at ? ` ${when(Date.parse(lobby.started_at), 'f')}` : '';
    const cancelled = lobby.status === 'cancelled';
    const then = cancelled ? `Cancelled ${CANCELLED[lobby.cancel_reason ?? ''] ?? 'before the draft'}.` : `The vote and the draft are in ${channel(voteChannel)}.`;
    return {
      tone: cancelled ? 'muted' : 'success',
      surface: 'lobby',
      title: `${title}: ${cancelled ? 'cancelled' : 'started'}`,
      subtitle: `${lobby.players.length} players · ${draftModeName(lobby.draft_mode)}`,
      body: [text(`### Started${at}\n-# ${then}`), ...facts],
      footer,
    };
  }
  const full = lobby.players.length >= lobby.seats;
  const actions = [
    row(
      button(lobby, VERB.join, 'Join', ButtonStyle.Success),
      button(lobby, VERB.leave, 'Leave', ButtonStyle.Secondary),
      button(lobby, VERB.start, 'Start', ButtonStyle.Primary),
    ),
  ];
  return {
    tone: 'info',
    surface: 'lobby',
    title,
    subtitle: `${lobby.players.length}/${lobby.seats} seats · ${draftModeName(lobby.draft_mode)}`,
    body: [
      ...(lfgRole && !full ? [text(`<@&${lfgRole}> looking for players`)] : []),
      ...(link ? [text(`### [Join the Steam lobby](${link})`)] : []),
      ...(full ? [text('### Full: waiting for the host to press Start')] : []),
      ...facts,
    ],
    actions,
    footer: `${footer} · closes after 2.5 hours with no activity`,
  };
}

// The draft in the voting channel, posted as every draft is.
export function lobbyDraftPanels({ lobby, names, questions }: LobbyView): Panel[] {
  const out = {
    title: `Civ6 ${SHAPES[lobby.shape]} draft`,
    footer: lobbyFooter(lobby),
    draftMode: lobby.draft_mode,
    teams: lobby.teams,
    players: lobby.players,
    pools: lobby.pools,
    picks: lobby.picks,
    settings: settingsOf(lobby),
    questions,
    bans: lobby.bans,
    banKinds: ['leader'],
  } as const;
  return draftOutputPanels(out, names);
}

// How many started or closed lobbies browse lists, newest first.
const RECENT_SHOWN = 20;

// /lobby browse: the lobbies open to join, then those started or closed in
// the last day. A started one links to its post, the record of who played; a
// lobby closed before it started has none, and one that never left its
// host's editor is not listed.
export function lobbiesPanel(lobbies: readonly Lobby[]): Panel {
  const post = (l: Lobby, label: string): string =>
    l.message_id ? ` · [${label}](https://discord.com/channels/${l.guild_id}/${l.channel_id}/${l.message_id})` : '';
  const ago = (at: string | null | undefined, l: Lobby): string => when(Date.parse(at ?? l.updated_at), 'R');
  const line = (l: Lobby): string => {
    const shape = `**${SHAPES[l.shape]}**`;
    if (isStarted(l)) return `${shape} · started ${ago(l.started_at, l)} · ${l.players.length} players${post(l, 'post')}`;
    if (l.status !== 'open') return `${shape} · closed ${ago(l.closed_at, l)}`;
    return `${shape} · ${l.players.length}/${l.seats} · hosted by ${mention(l.host_id)}${post(l, 'open')}`;
  };
  const open = lobbies.filter((l) => l.status === 'open' && !isStarted(l));
  const recent = lobbies.filter((l) => !open.includes(l) && l.phase !== 'setup').slice(0, RECENT_SHOWN);
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Lobbies',
    body: [
      field('Open', open.length ? open.map(line).join('\n') : 'No lobby is open here. Host one with /lobby host.'),
      ...(recent.length ? [field('Started or closed in the last day', recent.map(line).join('\n'))] : []),
    ],
  };
}

// The host's editor: changes stay a draft until Done (or Confirm, in setup).
export type EditorView = 'main' | 'settings' | 'lobby';

export type EditorDraft = Readonly<{
  lobby: Lobby;
  view: EditorView;
  shape: LobbyShape;
  settings: Readonly<Record<string, string>>;
  bans: readonly string[];
  teams: Readonly<Record<string, number>>;
  removed: readonly string[];
}>;

export const draftOf = (lobby: Lobby): EditorDraft => ({
  lobby,
  view: 'main',
  shape: lobby.shape,
  settings: settingsOf(lobby),
  bans: lobby.bans.map((b) => b.token),
  teams: {},
  removed: [],
});

export const editOf = (d: EditorDraft): LobbyEdit => ({ shape: d.shape, settings: { ...d.settings }, bans: [...d.bans], teams: { ...d.teams }, removed: [...d.removed] });

// The players as the draft leaves them.
const seatsOf = (d: EditorDraft): Seat[] =>
  d.lobby.players.filter((p) => !d.removed.includes(p.discord_id)).map((p) => ({ ...p, team: d.teams[p.discord_id] ?? p.team }));

export const withSetting = (d: EditorDraft, question: string, value: string): EditorDraft => ({ ...d, settings: { ...d.settings, [question]: value } });

export const withShape = (d: EditorDraft, shape: LobbyShape): EditorDraft => ({ ...d, shape });
export const withBans = (d: EditorDraft, bans: readonly string[]): EditorDraft => ({ ...d, bans: [...new Set(bans)] });
// A player moved back to their own team has no move left to save.
export function withMove(d: EditorDraft, player: string, team: number): EditorDraft {
  const teams: Record<string, number> = { ...d.teams, [player]: team };
  if (d.lobby.players.find((p) => p.discord_id === player)?.team === team) delete teams[player];
  return { ...d, teams };
}
export const withKick = (d: EditorDraft, player: string): EditorDraft => ({ ...d, removed: [...new Set([...d.removed, player])] });
export const withView = (d: EditorDraft, view: EditorView): EditorDraft => ({ ...d, view });

const sizesLike = (shape: LobbyShape): readonly LobbyShape[] => SIZES.find((sizes) => sizes.includes(shape)) ?? [shape];

function mainView(d: EditorDraft, questions: readonly SettingQuestion[], names: CivNames): Panel {
  const live = d.lobby.phase !== 'setup';
  const lobby = d.lobby;
  const unset = unsetOf(d.settings, questions).length;
  const optional = 'Optional: **Leader bans** to ban leaders, and **Lobby settings** to change the seats or move and remove players.';
  const guide = unset
    ? `Set each game setting under **Game settings**, then press **Confirm** (${unset} still to set). ${optional}`
    : `Every game setting is set: press **Confirm** to open the lobby to players. ${optional}`;
  const changes = [
    ...(d.removed.length ? [`Removing ${d.removed.map(mention).join(', ')}`] : []),
    ...(Object.keys(d.teams).length ? [`Moving ${Object.entries(d.teams).map(([p, t]) => `${mention(p)} to Team ${t}`).join(', ')}`] : []),
  ];
  return {
    tone: 'info',
    surface: 'lobby',
    title: live ? 'Edit your lobby' : 'Set up your lobby',
    subtitle: live ? 'Done saves your changes; Revert drops them' : 'Players see it once you confirm',
    body: [
      ...(live ? [] : [text(guide)]),
      field('Size', `${SHAPES[d.shape]} · ${seatsOf(d).length}/${SEATS[d.shape]} seated`),
      field('Settings', settingLines(d.settings, questions)),
      field('Leader bans', banLine(names, d.bans)),
      ...(changes.length ? [field('Players', changes.join('\n'))] : []),
    ],
    actions: [
      row(
        button(lobby, VERB.view, 'Game settings', ButtonStyle.Secondary, 'settings'),
        button(lobby, VERB.bans, 'Leader bans', ButtonStyle.Secondary),
        button(lobby, VERB.view, 'Lobby settings', ButtonStyle.Secondary, 'lobby'),
      ),
      live
        ? row(button(lobby, VERB.done, 'Done', ButtonStyle.Success), button(lobby, VERB.revert, 'Revert', ButtonStyle.Secondary))
        : row(button(lobby, VERB.confirm, 'Confirm', ButtonStyle.Success).setDisabled(unset > 0), button(lobby, VERB.discard, 'Cancel lobby', ButtonStyle.Danger)),
    ],
  };
}

// Each setting under its title, its menu showing the draft's choice, with
// Put to vote first. A pick is kept without redrawing, so quick picks never race a redraw.
function settingsView(d: EditorDraft, questions: readonly SettingQuestion[]): Panel {
  const menus = questions.flatMap((q) => [
    text(`**${q.title}**`),
    inBody(
      new StringSelectMenuBuilder()
        .setCustomId(customId('lobby', VERB.setting, d.lobby.id, q.id))
        .setPlaceholder('Choose\u2026')
        .addOptions(
          { label: 'Put to vote', value: PUT_TO_VOTE, description: 'The players vote on it with the bans', default: d.settings[q.id] === PUT_TO_VOTE, emoji: { name: VOTE_EMOJI } },
          ...q.options.map((o) => ({ label: fit(o.label, 100), value: o.id, default: d.settings[q.id] === o.id, emoji: { name: o.emoji } })),
        ),
    ),
  ]);
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Game settings',
    subtitle: 'Each pick is kept as you make it. Put to vote leaves a setting to the players, voted on with the bans. Press Back when done.',
    body: menus,
    actions: [row(button(d.lobby, VERB.view, 'Back', ButtonStyle.Secondary, 'main'))],
  };
}

function lobbyView(d: EditorDraft, playerNames: ReadonlyMap<string, string>): Panel {
  const lobby = d.lobby;
  const seats = seatsOf(d);
  const nameOfPlayer = (id: string): string => playerNames.get(id) ?? id;
  const fits = (s: LobbyShape): boolean =>
    SEATS[s] >= seats.length && Array.from({ length: lobby.teams }, (_, i) => teamOf(seats, i + 1).length).every((n) => n <= SEATS[s] / lobby.teams);
  const sizes = sizesLike(d.shape).filter(fits);
  const menus: Block[] = [];
  const titled = (title: string, menu: StringSelectMenuBuilder): void => {
    menus.push(text(`**${title}**`), inBody(menu));
  };
  if (sizes.length > 1) {
    titled(
      'Lobby size',
      new StringSelectMenuBuilder()
        .setCustomId(customId('lobby', VERB.shape, lobby.id))
        .addOptions(sizes.map((s) => ({ label: SHAPES[s], value: s, default: s === d.shape }))),
    );
  }
  if (lobby.teams) {
    const room = (team: number): boolean => teamOf(seats, team).length < SEATS[d.shape] / lobby.teams;
    const moves = seats.flatMap((p) =>
      Array.from({ length: lobby.teams }, (_, i) => i + 1)
        .filter((team) => team !== p.team && room(team))
        .map((team) => ({ label: fit(`${nameOfPlayer(p.discord_id)} to Team ${team}`, 100), value: `${p.discord_id}:${team}` })),
    );
    if (moves.length) {
      titled('Move a player', new StringSelectMenuBuilder().setCustomId(customId('lobby', VERB.move, lobby.id)).setPlaceholder('Choose\u2026').addOptions(moves.slice(0, 25)));
    }
  }
  const others = seats.filter((p) => p.discord_id !== lobby.host_id);
  if (others.length) {
    titled(
      'Remove a player',
      new StringSelectMenuBuilder()
        .setCustomId(customId('lobby', VERB.kick, lobby.id))
        .setPlaceholder('Choose\u2026')
        .addOptions(others.slice(0, 25).map((p) => ({ label: fit(nameOfPlayer(p.discord_id), 100), value: p.discord_id }))),
    );
  }
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Lobby settings',
    subtitle: `${SHAPES[d.shape]} · ${seats.length}/${SEATS[d.shape]} seated`,
    body: [text(seatLines(lobby, seats)), ...menus],
    actions: [row(button(lobby, VERB.view, 'Back', ButtonStyle.Secondary, 'main'))],
  };
}

export type EditorContext = Readonly<{ questions: readonly SettingQuestion[]; names: CivNames; playerNames: ReadonlyMap<string, string> }>;

export function editorPanel(d: EditorDraft, ctx: EditorContext): Panel {
  if (d.view === 'settings') return settingsView(d, ctx.questions);
  if (d.view === 'lobby') return lobbyView(d, ctx.playerNames);
  return mainView(d, ctx.questions, ctx.names);
}

export const closedEditor = (message: string): Panel => ({ tone: 'muted', surface: 'lobby', title: 'Lobby editor closed', body: [text(message)] });

// The host's ban form: /draft's ban menus, with the lobby's bans ticked.
export function lobbyBanForm(d: EditorDraft, data: CivDataResponse, names: CivNames): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId('lobby', VERB.bansForm, d.lobby.id))
    .setTitle('Leader bans for your lobby')
    .addLabelComponents(...banFields(LOBBY_BANS, data, names, new Set(d.bans)));
}
