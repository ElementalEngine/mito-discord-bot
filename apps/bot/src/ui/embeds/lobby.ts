import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import type { CivDataResponse, LobbyDocument } from '../../api/types.js';

export const openLobbyId = (lobby: LobbyDocument): string => `lobby:open:${lobby._id}`;
export const BROWSE_LOBBIES_ID = 'lobby:browse';

const pretty = (token: string): string =>
  token.replace(/^(LEADER|CIVILIZATION)_/, '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function buildLobbyOpenEmbed(lobby: LobbyDocument): EmbedBuilder {
  const seated = new Map(lobby.seats.map((s) => [s.seat_index, s.discord_id]));
  const rows = Array.from({ length: lobby.seat_count }, (_, i) => {
    const who = seated.get(i);
    return `${i + 1}. ${who ? `<@${who}>${who === lobby.host_discord_id ? ' (host)' : ''}` : '[empty]'}`;
  });
  return new EmbedBuilder()
    .setTitle(`LOBBY OPEN \u2014 ${lobby.edition.toUpperCase()} ${lobby.game_type.toUpperCase()}`)
    .setDescription([lobby.host_rules?.trim() || null, rows.join('\n')].filter(Boolean).join('\n\n'))
    .setFooter({ text: `Voice: the host's channel \u00b7 needs ${lobby.min_seats} to start` });
}

export function buildLobbyButtons(lobby: LobbyDocument): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(openLobbyId(lobby)).setLabel('Open lobby').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BROWSE_LOBBIES_ID).setLabel('Browse open lobbies').setStyle(ButtonStyle.Secondary),
  );
}

// Token -> what a player reads, with the portrait where the row has one.
export type CivNames = ReadonlyMap<string, string>;

export function civNamesOf(data: CivDataResponse): CivNames {
  return new Map(
    [...data.leaders, ...data.civs].map((row): [string, string] => {
      const shown = row.display ?? pretty(row.token);
      return [row.token, row.emoji_id ? `<:${row.name}:${row.emoji_id}> ${shown}` : shown];
    })
  );
}

// A field holds 1024 characters; a twelve-seat lobby with portraits passes it.
const fit = (text: string, limit = 1024): string => (text.length <= limit ? text : `${text.slice(0, limit - 1)}\u2026`);

// Outcomes only: every seat's pick, the settings by their ballot titles, and
// the bans. No vote counts. Names come from core-api's civ data; a token with
// no row falls back to its own spelling.
export function buildLobbyCompleteEmbed(lobby: LobbyDocument, names: CivNames = new Map()): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`${lobby.edition.toUpperCase()} ${lobby.game_type.toUpperCase()} \u2014 ${lobby.phase.toUpperCase()}`);
  if (lobby.phase === 'cancelled') return embed.setDescription(lobby.cancel_reason ?? 'no reason recorded');
  const nameOf = (token: string): string => names.get(token) ?? pretty(token);
  // The plain name, for a list where a portrait per entry would not fit.
  const plain = (token: string): string => nameOf(token).replace(/^<:[^>]+>\s*/, '');

  const chosen = lobby.settings ?? {};
  const asked = lobby.questions ?? [];
  const settings = [
    ...asked
      .filter((q) => q.id in chosen)
      .map((q) => `${q.title}: ${q.options.find((o) => o.id === chosen[q.id])?.label ?? chosen[q.id]}`),
    ...Object.entries(chosen)
      .filter(([id]) => !asked.some((q) => q.id === id))
      .map(([id, value]) => `${id.replace(/_/g, ' ')}: ${value.replace(/_/g, ' ')}`),
  ].join('\n') || '\u2014';
  const banned = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])].map(plain).join(', ') || 'none';
  // A civ7 pick carries its civ; a cwc draft's picks live on the teams.
  const withCiv = (leader: string, civ?: string | null): string => (civ ? `${nameOf(leader)} \u00b7 ${plain(civ)}` : nameOf(leader));
  const teams = lobby.teams ?? [];
  const picks = (teams.length
    ? teams.map((t) => `**Team ${t.team_index + 1}**: ${t.leaders.map((l, i) => withCiv(l, t.civs[i])).join(', ') || '\u2014'}`)
    : [...lobby.seats].sort((a, b) => a.seat_index - b.seat_index)
      .map((s) => `${s.seat_index + 1}. <@${s.discord_id}> \u2014 ${s.pick ? withCiv(String(s.pick), s.civ_pick) : '\u2014'}`)
  ).join('\n') || '\u2014';
  return embed
    .setDescription(fit(picks, 4096))
    .addFields({ name: 'Settings', value: fit(settings) }, { name: 'Bans', value: fit(banned) });
}
