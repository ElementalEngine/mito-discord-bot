import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from 'discord.js';

import type { LobbyDocument } from '../../api/types.js';
import {
  channel,
  customId,
  divider,
  field,
  mention,
  nameOf,
  plainNameOf,
  pretty,
  text,
  type ButtonRow,
  type CivNames,
  type Panel,
} from '../kit/index.js';

// The ids a posted lobby carries. Their spelling is what old messages hold,
// so it does not change.
export const openLobbyId = (lobby: LobbyDocument): string => customId('lobby', 'open', lobby._id);
export const BROWSE_LOBBIES_ID = customId('lobby', 'browse');

// What players call a lobby: "Civ6 FFA", "Civ7 Teamer 3v3", "Civ6 CWC 4v4".
export function lobbyLabel(lobby: LobbyDocument): string {
  const edition = lobby.edition === 'civ7' ? 'Civ7' : 'Civ6';
  if (lobby.game_type === 'ffa') return `${edition} FFA`;
  if (lobby.game_type === 'duel') return `${edition} Duel`;
  if (lobby.game_type === 'teamer') {
    const side = Math.max(1, Math.floor(lobby.seat_count / 2));
    const kind = lobby.settings?.draft_mode === 'cwc' ? 'CWC' : 'Teamer';
    return `${edition} ${kind} ${side}v${side}`;
  }
  return `${edition} ${pretty(lobby.game_type)}`;
}

const PHASE: Readonly<Record<string, string>> = {
  lobby: 'filling',
  settings: 'voting',
  bans: 'banning',
  draft: 'drafting',
};

const CANCEL_REASON: Readonly<Record<string, string>> = {
  host: 'The host or staff cancelled it.',
  timeout: 'Nobody acted before the timer ran out.',
  abandoned: 'It sat idle too long and was closed.',
  no_pool: 'The bans left no leaders to draft.',
  no_pick: 'The draft ran out of time with picks missing.',
};

function seatList(lobby: LobbyDocument): string {
  const seated = new Map(lobby.seats.map((s) => [s.seat_index, s.discord_id]));
  return Array.from({ length: lobby.seat_count }, (_, i) => {
    const who = seated.get(i);
    if (!who) return `${i + 1}. *open*`;
    return `${i + 1}. ${mention(who)}${who === lobby.host_discord_id ? ' \u00b7 host' : ''}`;
  }).join('\n');
}

export function lobbyButtons(lobby: LobbyDocument): ButtonRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(openLobbyId(lobby)).setLabel('Open lobby').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BROWSE_LOBBIES_ID).setLabel('Browse open lobbies').setStyle(ButtonStyle.Secondary),
  );
}

// Posted when a lobby opens. Seats are taken in the Activity.
export function lobbyOpenPanel(lobby: LobbyDocument): Panel {
  const rules = lobby.host_rules?.trim();
  return {
    tone: 'info',
    surface: 'lobby',
    title: `${lobbyLabel(lobby)} lobby`,
    subtitle: `Hosted by ${mention(lobby.host_discord_id)} \u00b7 needs ${lobby.min_seats} to start`,
    body: [...(rules ? [field('Host rules', rules)] : []), text(seatList(lobby))],
    actions: [lobbyButtons(lobby)],
    footer: 'Voice is the host\u2019s channel. Open the lobby to take a seat.',
  };
}

// The open lobbies a player may join, one line each.
export function lobbyListPanel(lobbies: readonly LobbyDocument[]): Panel {
  const lines = lobbies.map(
    (l) =>
      `**${lobbyLabel(l)}** \u00b7 ${l.seats.length}/${l.seat_count} seated \u00b7 ${PHASE[l.phase] ?? l.phase}\n` +
      `-# Hosted by ${mention(l.host_discord_id)} in ${channel(l.channel_id)}`,
  );
  return {
    tone: 'info',
    surface: 'lobby',
    title: 'Open lobbies',
    subtitle: `${lobbies.length} open in this server`,
    body: [text(lines.join('\n'))],
  };
}

// Outcomes only: every seat's pick, the settings by their ballot titles, and
// the bans. No vote counts. A token with no civ-data row keeps its spelling.
export function lobbyDonePanel(lobby: LobbyDocument, names: CivNames = new Map()): Panel {
  const label = lobbyLabel(lobby);
  if (lobby.phase === 'cancelled') {
    const reason = lobby.cancel_reason ?? '';
    return {
      tone: 'muted',
      surface: 'lobby',
      title: `${label} lobby cancelled`,
      body: [text(CANCEL_REASON[reason] ?? (reason ? `Reason: ${reason.replace(/_/g, ' ')}.` : 'No reason was recorded.'))],
    };
  }

  const chosen = lobby.settings ?? {};
  const asked = lobby.questions ?? [];
  const settings =
    [
      ...asked
        .filter((q) => q.id in chosen)
        .map((q) => `${q.title}: ${q.options.find((o) => o.id === chosen[q.id])?.label ?? chosen[q.id]}`),
      ...Object.entries(chosen)
        .filter(([id]) => !asked.some((q) => q.id === id))
        .map(([id, value]) => `${id.replace(/_/g, ' ')}: ${value.replace(/_/g, ' ')}`),
    ].join('\n') || '\u2014';
  const banned =
    [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])].map((t) => plainNameOf(names, t)).join(', ') || 'None';

  // A civ7 pick carries its civ; a cwc draft's picks live on the teams.
  const withCiv = (leader: string, civ?: string | null): string =>
    civ ? `${nameOf(names, leader)} \u00b7 ${plainNameOf(names, civ)}` : nameOf(names, leader);
  const teams = lobby.teams ?? [];
  const picks =
    (teams.length
      ? teams.map(
          (t) => `**Team ${t.team_index + 1}**: ${t.leaders.map((l, i) => withCiv(l, t.civs[i])).join(', ') || '\u2014'}`,
        )
      : [...lobby.seats]
          .sort((a, b) => a.seat_index - b.seat_index)
          .map((s) => `${s.seat_index + 1}. ${mention(s.discord_id)} \u2014 ${s.pick ? withCiv(String(s.pick), s.civ_pick) : '\u2014'}`)
    ).join('\n') || '\u2014';

  return {
    tone: 'success',
    surface: 'lobby',
    title: `${label} draft complete`,
    subtitle: `Hosted by ${mention(lobby.host_discord_id)}`,
    body: [text(picks), divider(), field('Settings', settings), field('Bans', banned)],
  };
}
