import { EmbedBuilder } from 'discord.js';

import type { StatRow, StatSet, StatsGameType } from '../../api/types.js';

type BuildStatsEmbedsOpts = {
  title: string;
  discordId: string;
  civVersion: string;
  gameType: StatsGameType;
  lifetime: StatSet;
  season: StatSet;
};

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

function addModeFields(embed: EmbedBuilder, set: StatSet): EmbedBuilder {
  return embed.addFields(
    { name: 'FFA', value: fmtRow(set.ffa), inline: true },
    { name: 'Teamer', value: fmtRow(set.teamer), inline: true },
    { name: 'Duel', value: fmtRow(set.duel), inline: true }
  );
}

export function buildStatsEmbeds(opts: BuildStatsEmbedsOpts): EmbedBuilder[] {
  const header = `${opts.civVersion} • ${opts.gameType}`;
  const who = `<@${opts.discordId}>`;

  const lifetime = addModeFields(
    new EmbedBuilder()
      .setTitle(`${opts.title} — Lifetime`)
      .setDescription(`Stats for ${who}\n${header}`)
      .setColor(0x00ff00),
    opts.lifetime
  );

  const season = addModeFields(
    new EmbedBuilder()
      .setTitle(`${opts.title} — Season`)
      .setDescription(`Stats for ${who}\n${header}`)
      .setColor(0x00ff00),
    opts.season
  );

  return [lifetime, season];
}
