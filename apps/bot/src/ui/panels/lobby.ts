import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';

import type { CivDataResponse, Lobby, LobbyEdit, LobbyShape, SettingQuestion } from '../../api/types.js';
import { channel, customId, field, fit, mention, nameOf, row as inBody, text, when, type Block, type ButtonRow, type CivNames, type Panel } from '../kit/index.js';
import { banFields, pickLines } from './draft.js';

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
const DRAFT_MODES: Readonly<Record<string, string>> = { standard: 'Standard', random: 'Random', blind: 'Blind' };

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

// Each setting with its option's emoji, as the host set it.
function settingLines(chosen: Readonly<Record<string, string>>, questions: readonly SettingQuestion[]): string {
  return questions
    .map((q) => {
      const option = q.options.find((o) => o.id === chosen[q.id]);
      return option ? `${option.emoji} ${q.title}: ${option.label}` : `\u2b1c ${q.title}: not set`;
    })
    .join('\n');
}

// Every lobby message carries its host and code, so players can tell it is theirs.
export const lobbyFooter = (lobby: Lobby): string => `Hosted by ${mention(lobby.host_id)} · code ${lobby.code}`;

const banLine = (names: CivNames, bans: readonly string[]): string => bans.map((t) => nameOf(names, t)).join(' · ') || 'None';

const settingsOf = (lobby: Lobby): Record<string, string> => Object.fromEntries(lobby.settings.map((s) => [s.id, s.value]));

const draftModeOf = (lobby: Lobby): string => (lobby.draft_mode ? `${DRAFT_MODES[lobby.draft_mode] ?? lobby.draft_mode} draft` : 'Draft not set');

// The settings the draft leaves unset; the lobby opens only once none are.
const unsetOf = (settings: Readonly<Record<string, string>>, questions: readonly SettingQuestion[]): SettingQuestion[] =>
  questions.filter((q) => settings[q.id] === undefined);

// A lobby as drawn: its names, settings, Steam link, and the LFG role it pings
// when asked; null for none.
export type LobbyView = Readonly<{ lobby: Lobby; names: CivNames; questions: readonly SettingQuestion[]; link: string | null; lfgRole: string | null }>;

// The vote's status message, in the voting channel.
const voteLinkOf = (lobby: Lobby): string | null => {
  const status = lobby.vote?.messages[VOTE_STATUS];
  return lobby.vote?.channel_id && status ? `https://discord.com/channels/${lobby.guild_id}/${lobby.vote.channel_id}/${status}` : null;
};

function whereItDrafts(lobby: Lobby): Block[] {
  const voteLink = voteLinkOf(lobby);
  if (lobby.status === 'done' && lobby.vote?.channel_id) return [text(`### Drafted in ${channel(lobby.vote.channel_id)}`)];
  if (lobby.phase === 'voting' && voteLink) return [text(`### [Voting on bans](${voteLink})`)];
  if (lobby.phase === 'picking' && voteLink) return [text(`### [Picking blind](${voteLink})`)];
  return [];
}

// The lobby's post, edited in place as it fills and drafts; a closed one is
// deleted. Seats lock once its host starts it or its countdown ends.
export function lobbyPanel({ lobby, names, questions, link, lfgRole }: LobbyView): Panel {
  const title = `Civ6 ${SHAPES[lobby.shape]} lobby`;
  const footer = lobbyFooter(lobby);
  const open = lobby.status === 'open';
  const live = open && lobby.phase === 'live';
  const actions = [
    row(
      button(lobby, VERB.join, 'Join', ButtonStyle.Success),
      button(lobby, VERB.leave, 'Leave', ButtonStyle.Secondary),
      button(lobby, VERB.start, 'Start', ButtonStyle.Primary),
    ),
  ];
  const countdown = live && lobby.deadline ? [text(`### Full: the bans vote starts ${when(Date.parse(lobby.deadline), 'R')}\n-# Or sooner, when the host presses Start.`)] : [];
  return {
    tone: open ? 'info' : 'success',
    surface: 'lobby',
    title: open ? title : `${title}: drafted`,
    subtitle: `${lobby.players.length}/${lobby.seats} seats · ${draftModeOf(lobby)}`,
    body: [
      ...(live && lfgRole && !lobby.deadline ? [text(`<@&${lfgRole}> looking for players`)] : []),
      ...(link ? [text(`### [Join the Steam lobby](${link})`)] : []),
      ...countdown,
      ...whereItDrafts(lobby),
      ...(lobby.message ? [field('From the host', lobby.message)] : []),
      field(live ? 'Seats' : 'Players', seatLines(lobby)),
      field('Settings', settingLines(settingsOf(lobby), questions)),
      field('Leader bans', banLine(names, lobby.bans.map((b) => b.token))),
    ],
    ...(live ? { actions } : {}),
    footer: live ? `${footer} · closes after 2.5 hours with no activity` : footer,
  };
}

// The draft in the voting channel: one message for a blind or random draft; a
// standard one's pool size, then each pool as its own message to trade from.
export function lobbyDraftPanels({ lobby, names, questions }: LobbyView): Panel[] {
  const game = [field('Settings', settingLines(settingsOf(lobby), questions)), field('Leader bans', banLine(names, lobby.bans.map((b) => b.token)))];
  const head = { tone: 'info', surface: 'draft', title: `Civ6 ${SHAPES[lobby.shape]} draft`, footer: lobbyFooter(lobby) } as const;
  const team = (team: number | null): string => (lobby.teams && team ? `Team ${team} · ` : '');
  if (lobby.draft_mode === 'blind') {
    const picks = lobby.picks.map((p) => `${mention(p.player_id)} · ${nameOf(names, p.leader)}${p.by === 'auto' ? ' (auto pick)' : ''}`);
    return [{ ...head, subtitle: draftModeOf(lobby), body: [field('Picks', picks.join('\n')), ...game] }];
  }
  if (lobby.draft_mode === 'random') {
    const picks = lobby.pools.map((p) => `${team(p.team)}${mention(p.player_id ?? '')} · ${nameOf(names, p.leaders[0] ?? '')}`);
    return [{ ...head, subtitle: draftModeOf(lobby), body: [field('Picks', picks.join('\n')), ...game] }];
  }
  const size = lobby.pools[0]?.leaders.length ?? 0;
  return [
    { ...head, subtitle: `${draftModeOf(lobby)} · ${size} leader${size === 1 ? '' : 's'} ${lobby.teams ? 'a team' : 'each'}`, body: game },
    ...lobby.pools.map((pool): Panel => ({
      tone: 'info',
      title: pool.player_id ? mention(pool.player_id) : `Team ${pool.team}`,
      body: [
        text(
          pool.player_id
            ? pickLines(names, pool.leaders)
            : `-# ${teamOf(lobby.players, pool.team ?? 0).map(mention).join(', ')}\n${pickLines(names, pool.leaders)}`,
        ),
      ],
      footer: lobbyFooter(lobby),
    })),
  ];
}

const BROWSE: Readonly<Record<string, string>> = { live: '', voting: ' · voting on bans', picking: ' · picking blind' };

// /lobby browse: every open lobby here, linked to its post.
export function openLobbiesPanel(lobbies: readonly Lobby[]): Panel {
  const line = (l: Lobby): string => {
    const post = l.message_id ? ` · [open](https://discord.com/channels/${l.guild_id}/${l.channel_id}/${l.message_id})` : '';
    return `**${SHAPES[l.shape]}** · ${l.players.length}/${l.seats}${BROWSE[l.phase] ?? ''} · hosted by ${mention(l.host_id)}${post}`;
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

// Each setting under its title, its menu showing the draft's choice.
function settingsView(d: EditorDraft, questions: readonly SettingQuestion[]): Panel {
  const unset = unsetOf(d.settings, questions).length;
  const menus = questions.flatMap((q) => [
    text(`**${q.title}**`),
    inBody(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(customId('lobby', VERB.setting, d.lobby.id, q.id))
          .setPlaceholder('Choose\u2026')
          .addOptions(q.options.map((o) => ({ label: fit(o.label, 100), value: o.id, default: d.settings[q.id] === o.id, emoji: { name: o.emoji } }))),
      ),
    ),
  ]);
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Game settings',
    subtitle: unset ? `Every one must be set before the lobby opens; ${unset} still to set` : 'Every setting is set',
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
