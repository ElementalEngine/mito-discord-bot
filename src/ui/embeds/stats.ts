import { EmbedBuilder } from 'discord.js';

import type { CivVersion, StatRow, StatSet, StatsGameType } from '../../api/types.js';
import { EMOJI_LIFETIME, EMOJI_SEASONAL } from '../../config/server-config.js';
import {
  EMOJI_ROOM_RANKINGS,
  RANK_DEFS_CIV6,
} from '../../config/constants.js';

type BuildStatsEmbedOpts = Readonly<{
  civVersion: CivVersion;
  mode: StatsGameType;
  targetMention: string;
  lifetime: StatSet;
  season: StatSet;
}>;

const DEFAULT_COLOR = 0x9d7cc4; // Scout-ish fallback

function hexToInt(hex: string): number | null {
  const v = hex.trim();
  if (!v.startsWith('#') || (v.length !== 7 && v.length !== 4)) return null;

  const expanded =
    v.length === 4
      ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
      : v;

  const n = Number.parseInt(expanded.slice(1), 16);
  return Number.isFinite(n) ? n : null;
}

function rankColorFromMu(mu: number | null): number {
  if (mu == null || !Number.isFinite(mu)) return DEFAULT_COLOR;

  for (const rank of RANK_DEFS_CIV6) {
    if (mu >= rank.threshold) {
      return hexToInt(rank.color) ?? DEFAULT_COLOR;
    }
  }

  return DEFAULT_COLOR;
}

function fmtRow(row: StatRow | null | undefined): string {
  if (!row) return '—';

  const lines = [
    `Skill: ${row.mu}`,
    `TS Mu: ${row.mu}`,
    `TS Sigma: ${Math.round(row.sigma)}`,
    `Games: ${row.games}`,
    `Wins: ${row.wins}`,
    `1st: ${row.first}`,
    `Sub In: ${row.subbedIn}`,
    `Sub Out: ${row.subbedOut}`,
  ];

  return '```\n' + lines.join('\n') + '\n```';
}

function addSectionHeader(embed: EmbedBuilder, emoji: string, title: string): void {
  // Using the value line for the header avoids an extra "blank" line and tightens spacing.
  embed.addFields({ name: '\u200b', value: `${emoji} **${title}**`, inline: false });
}

function addRealtimeFields(embed: EmbedBuilder, set: StatSet): void {
  embed.addFields(
    { name: 'FFA', value: fmtRow(set.ffa), inline: true },
    { name: 'Teamer', value: fmtRow(set.teamer), inline: true },
    { name: 'Duel', value: fmtRow(set.duel), inline: true }
  );
}

function addCloudFields(embed: EmbedBuilder, set: StatSet): void {
  embed.addFields(
    { name: 'PBC', value: fmtRow(set.ffa), inline: true },
    { name: 'PBC-Teamer', value: fmtRow(set.teamer), inline: true },
    { name: 'PBC-Duel', value: fmtRow(set.duel), inline: true }
  );
}

export function buildStatsEmbed(opts: BuildStatsEmbedOpts): EmbedBuilder {
  const header = `${opts.civVersion} • ${opts.mode}`;

  // Rank color source of truth: lifetime FFA mu (civ6 or civ7).
  const ffaMu = opts.lifetime.ffa?.mu ?? null;
  const color = rankColorFromMu(ffaMu);

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI_ROOM_RANKINGS} Stats`)
    .setDescription(`Stats for ${opts.targetMention}\n${header}`)
    .setColor(color);

  addSectionHeader(embed, EMOJI_LIFETIME, 'Lifetime');
  if (opts.mode === 'cloud') {
    addCloudFields(embed, opts.lifetime);
    return embed;
  }

  addRealtimeFields(embed, opts.lifetime);
  addSectionHeader(embed, EMOJI_SEASONAL, 'Season');
  addRealtimeFields(embed, opts.season);

  return embed;
}
