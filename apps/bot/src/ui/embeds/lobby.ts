import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import type { LobbyDocument } from '../../api/types.js';

// custom_id carries the voice channel because Mite cannot read a lobby back:
// mite_router is create and claim-post only. Under Discord's 100-char limit.
export const openLobbyId = (lobby: LobbyDocument): string => `lobby:open:${lobby._id}:${lobby.voice_channel_id}`;
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
    .setTitle(`LOBBY OPEN — ${lobby.edition.toUpperCase()} ${lobby.game_type.toUpperCase()}`)
    .setDescription([lobby.host_rules?.trim() || null, rows.join('\n')].filter(Boolean).join('\n\n'))
    .setFooter({ text: `Be in the host's voice channel to take a seat · needs ${lobby.min_seats}` });
}

export function buildLobbyButtons(lobby: LobbyDocument): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(openLobbyId(lobby)).setLabel('Open lobby').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BROWSE_LOBBIES_ID).setLabel('Browse open lobbies').setStyle(ButtonStyle.Secondary),
  );
}

// Outcomes only: settings, bans, and every seat's pick. No vote counts.
export function buildLobbyCompleteEmbed(lobby: LobbyDocument): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`${lobby.edition.toUpperCase()} ${lobby.game_type.toUpperCase()} — ${lobby.phase.toUpperCase()}`);
  if (lobby.phase === 'cancelled') return embed.setDescription(lobby.cancel_reason ?? 'no reason recorded');
  const settings = Object.entries(lobby.settings ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '—';
  const banned = [...(lobby.bans?.leader ?? []), ...(lobby.bans?.civ ?? [])].map(pretty).join(', ') || 'none';
  const picks = [...lobby.seats].sort((a, b) => a.seat_index - b.seat_index)
    .map((s) => `${s.seat_index + 1}. <@${s.discord_id}> — ${s.pick ? pretty(String(s.pick)) : '—'}`).join('\n') || '—';
  return embed.addFields({ name: 'Settings', value: settings }, { name: 'Bans', value: banned }, { name: 'Picks', value: picks });
}
