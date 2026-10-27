import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';

import type { CivDataResponse, Lobby, LobbyEdit, LobbyShape, SettingQuestion } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, text, when, type ButtonRow, type CivNames, type Panel } from '../kit/index.js';
import { banFields, pickLines } from './draft.js';

export const SHAPES: Readonly<Record<LobbyShape, string>> = {
  'ffa-8': 'FFA, 8 seats',
  'ffa-10': 'FFA, 10 seats',
  'ffa-12': 'FFA, 12 seats',
  'ffa-14': 'FFA, 14 seats',
  duel: 'Duel',
  'teamer-2v2': 'Teamer 2v2',
  'teamer-3v3': 'Teamer 3v3',
  'teamer-4v4': 'Teamer 4v4',
  'teamer-5v5': 'Teamer 5v5',
  'teamer-2v2v2v2': 'Teamer 2v2v2v2',
};
export const DRAFT_MODES = { standard: 'Standard', random: 'Random' } as const;
export type DraftMode = keyof typeof DRAFT_MODES;

// A lobby keeps its mode and its number of teams; only its size changes.
const SIZES: readonly (readonly LobbyShape[])[] = [
  ['ffa-8', 'ffa-10', 'ffa-12', 'ffa-14'],
  ['duel'],
  ['teamer-2v2', 'teamer-3v3', 'teamer-4v4', 'teamer-5v5'],
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
  'teamer-2v2v2v2': 8,
};

export const VERB = {
  join: 'join',
  leave: 'leave',
  start: 'start',
  cancel: 'cancel',
  edit: 'edit',
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
} as const;

// The vote's messages by key: its status, the bans, and one per open setting.
export const VOTE_STATUS = 'status';
export const VOTE_BANS = 'bans';

// A setting the host leaves open, to be voted.
export const NOT_FIXED = '-';
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

export const row = (...items: MessageActionRowComponentBuilder[]): ButtonRow => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...items);

type Seat = Readonly<{ discord_id: string; team: number | null }>;

const teamOf = (players: readonly Seat[], team: number): string[] => players.filter((p) => p.team === team).map((p) => p.discord_id);

function seatLines(lobby: Lobby, players: readonly Seat[] = lobby.players): string {
  const name = (id: string): string => (id === lobby.host_id ? `${mention(id)} (host)` : mention(id));
  if (!lobby.teams) return players.map((p, i) => `${i + 1}. ${name(p.discord_id)}`).join('\n');
  return Array.from({ length: lobby.teams }, (_, i) => {
    const team = teamOf(players, i + 1);
    return `**Team ${i + 1}** · ${team.length ? team.map(name).join(', ') : 'empty'}`;
  }).join('\n');
}

function settingLines(chosen: Readonly<Record<string, string>>, questions: readonly SettingQuestion[]): string {
  const lines = questions
    .filter((q) => chosen[q.id] !== undefined)
    .map((q) => `${q.title}: ${q.options.find((o) => o.id === chosen[q.id])?.label ?? chosen[q.id]}`);
  return lines.join('\n') || 'None fixed';
}

const banLine = (names: CivNames, bans: readonly string[]): string => bans.map((t) => nameOf(names, t)).join(' · ') || 'None';

const fixedOf = (lobby: Lobby): Record<string, string> => Object.fromEntries(lobby.settings.map((s) => [s.id, s.value]));

const CLOSED: Readonly<Record<string, string>> = {
  host: 'Cancelled by the host',
  staff: 'Cancelled by staff',
  idle: 'Closed after 2.5 hours with no activity',
};

export type LobbyView = Readonly<{ lobby: Lobby; names: CivNames; questions: readonly SettingQuestion[]; link: string | null }>;

// Where the vote's players go: its status message, in the thread or channel.
const voteLinkOf = (lobby: Lobby): string | null => {
  const status = lobby.vote?.messages[VOTE_STATUS];
  return lobby.vote?.channel_id && status ? `https://discord.com/channels/${lobby.guild_id}/${lobby.vote.channel_id}/${status}` : null;
};

// The lobby's post, edited in place as it fills, votes, drafts or closes.
export function lobbyPanel({ lobby, names, questions, link }: LobbyView): Panel {
  const title = `Civ6 ${SHAPES[lobby.shape]} lobby`;
  if (lobby.status === 'cancelled') {
    return { tone: 'muted', surface: 'lobby', title, subtitle: CLOSED[lobby.cancel_reason ?? ''] ?? 'Closed', footer: `Hosted by ${mention(lobby.host_id)}` };
  }
  const open = lobby.status === 'open';
  const vote = open ? lobby.vote : null;
  const voteLink = voteLinkOf(lobby);
  const body = [
    ...(link ? [text(`### [Join the Steam lobby](${link})`)] : []),
    ...(vote && voteLink ? [text(`### [Vote on the settings and bans](${voteLink})`)] : []),
    field(open ? 'Seats' : 'Players', seatLines(lobby)),
    field('Settings', settingLines(fixedOf(lobby), questions)),
    field('Leader bans', banLine(names, lobby.bans.map((b) => b.token))),
  ];
  const cancel = button(lobby, VERB.cancel, 'Cancel', ButtonStyle.Danger);
  const actions = vote
    ? [row(cancel)]
    : [
        row(
          button(lobby, VERB.join, 'Join', ButtonStyle.Success),
          button(lobby, VERB.leave, 'Leave', ButtonStyle.Secondary),
          button(lobby, VERB.start, 'Start', ButtonStyle.Primary),
        ),
        row(button(lobby, VERB.edit, 'Edit lobby', ButtonStyle.Secondary), cancel),
      ];
  const footer = `Hosted by ${mention(lobby.host_id)}`;
  const draft = `${DRAFT_MODES[lobby.draft_mode as DraftMode] ?? lobby.draft_mode} draft`;
  return {
    tone: open ? 'info' : 'success',
    surface: 'lobby',
    title: open ? title : `${title}: drafted`,
    subtitle: `${lobby.players.length}/${lobby.seats} seats · ${draft}${vote ? ` · voting until ${when(Date.parse(vote.ends_at), 't')}` : ''}`,
    body,
    ...(open ? { actions, footer: `${footer} · closes after 2.5 hours with no activity` } : { footer }),
  };
}

// Each player's or team's draft as its own message, named by who it is for.
export function lobbyDraftPanels(lobby: Lobby, names: CivNames): Panel[] {
  return lobby.pools.map((pool) => ({
    tone: 'info',
    title: pool.player_id ? mention(pool.player_id) : `Team ${pool.team}`,
    body: [
      text(
        pool.player_id
          ? pickLines(names, pool.leaders)
          : `-# ${teamOf(lobby.players, pool.team ?? 0).map(mention).join(', ')}\n${pickLines(names, pool.leaders)}`,
      ),
    ],
  }));
}

// /lobby browse: every open lobby here, linked to its post.
export function openLobbiesPanel(lobbies: readonly Lobby[]): Panel {
  const line = (l: Lobby): string => {
    const post = l.message_id ? ` · [open](https://discord.com/channels/${l.guild_id}/${l.channel_id}/${l.message_id})` : '';
    return `**${SHAPES[l.shape]}** · ${l.players.length}/${l.seats}${l.vote ? ' · voting' : ''} · hosted by ${mention(l.host_id)}${post}`;
  };
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Open lobbies',
    body: [text(lobbies.length ? lobbies.map(line).join('\n') : 'No lobby is open here. Host one with /lobby host.')],
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
  settings: fixedOf(lobby),
  bans: lobby.bans.map((b) => b.token),
  teams: {},
  removed: [],
});

export const editOf = (d: EditorDraft): LobbyEdit => ({ shape: d.shape, settings: { ...d.settings }, bans: [...d.bans], teams: { ...d.teams }, removed: [...d.removed] });

// The players as the draft leaves them.
const seatsOf = (d: EditorDraft): Seat[] =>
  d.lobby.players.filter((p) => !d.removed.includes(p.discord_id)).map((p) => ({ ...p, team: d.teams[p.discord_id] ?? p.team }));

export function withSetting(d: EditorDraft, question: string, value: string): EditorDraft {
  const settings: Record<string, string> = { ...d.settings };
  if (value === NOT_FIXED) delete settings[question];
  else settings[question] = value;
  return { ...d, settings };
}

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
  const live = d.lobby.live;
  const lobby = d.lobby;
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
        : row(button(lobby, VERB.confirm, 'Confirm', ButtonStyle.Success), button(lobby, VERB.discard, 'Cancel lobby', ButtonStyle.Danger)),
    ],
  };
}

function settingsView(d: EditorDraft, questions: readonly SettingQuestion[]): Panel {
  const menus = questions.map((q) =>
    row(
      new StringSelectMenuBuilder()
        .setCustomId(customId('lobby', VERB.setting, d.lobby.id, q.id))
        .addOptions(
          { label: fit(`${q.title}: not fixed`, 100), value: NOT_FIXED, default: d.settings[q.id] === undefined },
          ...q.options.map((o) => ({ label: fit(`${q.title}: ${o.label}`, 100), value: o.id, default: d.settings[q.id] === o.id, emoji: { name: o.emoji } })),
        ),
    ),
  );
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Game settings',
    subtitle: 'Fix any setting; the rest are voted',
    actions: [...menus, row(button(d.lobby, VERB.view, 'Back', ButtonStyle.Secondary, 'main'))],
  };
}

function lobbyView(d: EditorDraft, playerNames: ReadonlyMap<string, string>): Panel {
  const lobby = d.lobby;
  const seats = seatsOf(d);
  const nameOfPlayer = (id: string): string => playerNames.get(id) ?? id;
  const fits = (s: LobbyShape): boolean =>
    SEATS[s] >= seats.length && Array.from({ length: lobby.teams }, (_, i) => teamOf(seats, i + 1).length).every((n) => n <= SEATS[s] / lobby.teams);
  const sizes = sizesLike(d.shape).filter(fits);
  const menus: ButtonRow[] = [];
  if (sizes.length > 1) {
    menus.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(customId('lobby', VERB.shape, lobby.id))
          .addOptions(sizes.map((s) => ({ label: SHAPES[s], value: s, default: s === d.shape }))),
      ),
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
      menus.push(row(new StringSelectMenuBuilder().setCustomId(customId('lobby', VERB.move, lobby.id)).setPlaceholder('Move a player').addOptions(moves.slice(0, 25))));
    }
  }
  const others = seats.filter((p) => p.discord_id !== lobby.host_id);
  if (others.length) {
    menus.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(customId('lobby', VERB.kick, lobby.id))
          .setPlaceholder('Remove a player')
          .addOptions(others.slice(0, 25).map((p) => ({ label: fit(nameOfPlayer(p.discord_id), 100), value: p.discord_id }))),
      ),
    );
  }
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Lobby settings',
    subtitle: `${SHAPES[d.shape]} · ${seats.length}/${SEATS[d.shape]} seated`,
    body: [text(seatLines(lobby, seats))],
    actions: [...menus, row(button(lobby, VERB.view, 'Back', ButtonStyle.Secondary, 'main'))],
  };
}

export type EditorContext = Readonly<{ questions: readonly SettingQuestion[]; names: CivNames; playerNames: ReadonlyMap<string, string> }>;

export function editorPanel(d: EditorDraft, ctx: EditorContext): Panel {
  if (d.view === 'settings') return settingsView(d, ctx.questions);
  if (d.view === 'lobby') return lobbyView(d, ctx.playerNames);
  return mainView(d, ctx.questions, ctx.names);
}

export const closedEditor = (message: string): Panel => ({ tone: 'muted', surface: 'lobby', title: 'Lobby editor closed', body: [text(message)] });

// /draft's ban menus, with the draft's bans ticked.
export function lobbyBanForm(d: EditorDraft, data: CivDataResponse, names: CivNames): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId('lobby', VERB.bansForm, d.lobby.id))
    .setTitle('Leader bans for your lobby')
    .addLabelComponents(...banFields(LOBBY_BANS, data, names, new Set(d.bans)));
}
