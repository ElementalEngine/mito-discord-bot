import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from 'discord.js';

import type { CivDataResponse, Lobby, LobbyShape, SettingQuestion } from '../../api/types.js';
import { customId, field, fit, mention, nameOf, text, type ButtonRow, type CivNames, type Panel } from '../kit/index.js';
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

export const VERB = {
  join: 'join',
  leave: 'leave',
  start: 'start',
  cancel: 'cancel',
  settings: 'settings',
  setting: 'setting',
  bans: 'bans',
  bansForm: 'bansform',
  teams: 'teams',
  move: 'move',
} as const;

// A setting the host leaves open.
export const NOT_FIXED = '-';
export const LOBBY_BANS = { edition: 'civ6', age: null } as const;
const STEAM_LINK = /^steam:\/\/joinlobby\/289070\/([0-9]+)\/(7656119[0-9]+)$/;

// Discord links only http(s), so the Steam link goes out through the redirect
// host, which accepts nothing but a lobby. Null for anything else.
export function lobbyLinkOf(steamLink: string, redirectUrl: string): string | null {
  const m = STEAM_LINK.exec(steamLink.trim());
  return m ? `${redirectUrl}/civ6/${m[1]}/${m[2]}` : null;
}

const button = (lobby: Lobby, verb: string, label: string, style: ButtonStyle): ButtonBuilder =>
  new ButtonBuilder().setCustomId(customId('lobby', verb, lobby.id)).setLabel(label).setStyle(style);

const row = (...items: MessageActionRowComponentBuilder[]): ButtonRow => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...items);

const teamOf = (lobby: Lobby, team: number): string[] => lobby.players.filter((p) => p.team === team).map((p) => p.discord_id);

function seatLines(lobby: Lobby): string {
  const name = (id: string): string => (id === lobby.host_id ? `${mention(id)} (host)` : mention(id));
  if (!lobby.teams) return lobby.players.map((p, i) => `${i + 1}. ${name(p.discord_id)}`).join('\n');
  return Array.from({ length: lobby.teams }, (_, i) => {
    const team = teamOf(lobby, i + 1);
    return `**Team ${i + 1}** · ${team.length ? team.map(name).join(', ') : 'empty'}`;
  }).join('\n');
}

function settingsLine(lobby: Lobby, questions: readonly SettingQuestion[]): string {
  if (!lobby.settings.length) return 'None fixed';
  return lobby.settings
    .map((s) => {
      const q = questions.find((x) => x.id === s.id);
      return `${q?.title ?? s.id}: ${q?.options.find((o) => o.id === s.value)?.label ?? s.value}`;
    })
    .join('\n');
}

const CLOSED: Readonly<Record<string, string>> = {
  host: 'Cancelled by the host',
  staff: 'Cancelled by staff',
  idle: 'Closed after 2.5 hours with no activity',
};

export type LobbyView = Readonly<{ lobby: Lobby; names: CivNames; questions: readonly SettingQuestion[]; link: string | null }>;

// The lobby's post, edited in place as it fills, drafts or closes.
export function lobbyPanel({ lobby, names, questions, link }: LobbyView): Panel {
  const title = `Civ6 ${SHAPES[lobby.shape]} lobby`;
  if (lobby.status === 'cancelled') {
    return { tone: 'muted', surface: 'lobby', title, subtitle: CLOSED[lobby.cancel_reason ?? ''] ?? 'Closed', footer: `Hosted by ${mention(lobby.host_id)}` };
  }
  const open = lobby.status === 'open';
  const bans = lobby.bans.map((b) => nameOf(names, b.token)).join(' · ') || 'None';
  const body = [
    ...(link ? [text(`### [Join the Steam lobby](${link})`)] : []),
    ...(lobby.rules ? [field('Host rules', lobby.rules)] : []),
    field(open ? 'Seats' : 'Players', seatLines(lobby)),
    field('Settings', settingsLine(lobby, questions)),
    field('Leader bans', bans),
  ];
  const actions = [
    row(
      button(lobby, VERB.join, 'Join', ButtonStyle.Success),
      button(lobby, VERB.leave, 'Leave', ButtonStyle.Secondary),
      button(lobby, VERB.start, 'Start', ButtonStyle.Primary),
    ),
    row(
      button(lobby, VERB.settings, 'Settings', ButtonStyle.Secondary),
      button(lobby, VERB.bans, 'Bans', ButtonStyle.Secondary),
      ...(lobby.teams ? [button(lobby, VERB.teams, 'Teams', ButtonStyle.Secondary)] : []),
      button(lobby, VERB.cancel, 'Cancel', ButtonStyle.Danger),
    ),
  ];
  return {
    tone: open ? 'info' : 'success',
    surface: 'lobby',
    title: open ? title : `${title}: drafted`,
    subtitle: `${lobby.players.length}/${lobby.seats} seats · ${DRAFT_MODES[lobby.draft_mode as DraftMode] ?? lobby.draft_mode} draft`,
    body,
    ...(open ? { actions } : {}),
    footer: open ? `Hosted by ${mention(lobby.host_id)} · closes after 2.5 hours with no activity` : `Hosted by ${mention(lobby.host_id)}`,
  };
}

// Each player's or team's draft as its own message, named by who it is for.
export function lobbyDraftPanels(lobby: Lobby, names: CivNames): Panel[] {
  return lobby.pools.map((pool) => ({
    tone: 'info',
    title: pool.player_id ? mention(pool.player_id) : `Team ${pool.team}`,
    body: [text(pool.player_id ? pickLines(names, pool.leaders) : `-# ${teamOf(lobby, pool.team ?? 0).map(mention).join(', ')}\n${pickLines(names, pool.leaders)}`)],
  }));
}

// /lobby browse: every open lobby here, linked to its post.
export function openLobbiesPanel(lobbies: readonly Lobby[]): Panel {
  const line = (l: Lobby): string => {
    const post = l.message_id ? ` · [open](https://discord.com/channels/${l.guild_id}/${l.channel_id}/${l.message_id})` : '';
    return `**${SHAPES[l.shape]}** · ${l.players.length}/${l.seats} · hosted by ${mention(l.host_id)}${post}`;
  };
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Open lobbies',
    body: [text(lobbies.length ? lobbies.map(line).join('\n') : 'No lobby is open here. Host one with /lobby host.')],
  };
}

// The host's settings: each one fixed, or left open.
export function settingsPanel(lobby: Lobby, questions: readonly SettingQuestion[]): Panel {
  const fixed = new Map(lobby.settings.map((s) => [s.id, s.value]));
  const menus = questions.map((q) =>
    row(
      new StringSelectMenuBuilder()
        .setCustomId(customId('lobby', VERB.setting, lobby.id, q.id))
        .setPlaceholder(fit(q.title, 150))
        .addOptions(
          { label: fit(`${q.title}: not fixed`, 100), value: NOT_FIXED, default: !fixed.has(q.id) },
          ...q.options.map((o) => ({
            label: fit(`${q.title}: ${o.label}`, 100),
            value: o.id,
            default: fixed.get(q.id) === o.id,
            emoji: { name: o.emoji },
          })),
        ),
    ),
  );
  return { tone: 'info', surface: 'lobby', title: 'Lobby settings', subtitle: 'Fix any setting; the rest stay open', actions: menus };
}

export const settingsAfter = (lobby: Lobby, question: string, value: string): Record<string, string> => {
  const chosen: Record<string, string> = Object.fromEntries(lobby.settings.map((s) => [s.id, s.value]));
  if (value === NOT_FIXED) delete chosen[question];
  else chosen[question] = value;
  return chosen;
};

// The host's team moves: every player onto every other team with room.
export function teamsPanel(lobby: Lobby, playerNames: ReadonlyMap<string, string>): Panel {
  const room = (team: number): boolean => teamOf(lobby, team).length < lobby.seats / lobby.teams;
  const moves = lobby.players.flatMap((p) =>
    Array.from({ length: lobby.teams }, (_, i) => i + 1)
      .filter((team) => team !== p.team && room(team))
      .map((team) => ({ label: fit(`${playerNames.get(p.discord_id) ?? p.discord_id} to Team ${team}`, 100), value: `${p.discord_id}:${team}` })),
  );
  const head = { tone: 'info' as const, surface: 'lobby' as const, title: 'Teams' };
  if (!moves.length) return { ...head, body: [text('No move is open: every other team is full.')] };
  return {
    ...head,
    body: [text(seatLines(lobby))],
    actions: [
      row(new StringSelectMenuBuilder().setCustomId(customId('lobby', VERB.move, lobby.id)).setPlaceholder('Move a player').addOptions(moves.slice(0, 25))),
    ],
  };
}

// /draft's ban menus, with what the host has banned already ticked.
export function lobbyBanForm(lobby: Lobby, data: CivDataResponse, names: CivNames): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId('lobby', VERB.bansForm, lobby.id))
    .setTitle('Leader bans for your lobby')
    .addLabelComponents(...banFields(LOBBY_BANS, data, names, new Set(lobby.bans.map((b) => b.token))));
}

