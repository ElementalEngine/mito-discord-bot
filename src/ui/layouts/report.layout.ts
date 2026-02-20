import { EmbedBuilder, userMention } from 'discord.js';

import type {
  UploadSaveResponse,
  GetMatchResponse,
  ParsedPlayer,
} from '../../api/types.js';
import { formatCiv6Leader, formatCiv7Civ, formatCiv7Leader } from '../../data/index.js';
import { EMOJI_REPORT, EMOJI_QUITTER } from '../../config/constants.js';
import { EMOJI_REPORT as EMOJI_REPORT_CONFIG } from '../../config/server-config.js';
import type { BaseReport } from '../../types/reports.js';

type AnyReport = GetMatchResponse | UploadSaveResponse | BaseReport;

export type BuildReportEmbedOptions = {
  header?: string;
  reporterId?: string;
  approverId?: string;
  now?: Date;
  isFinal?: boolean;
};

const REPORT_EMOJI = EMOJI_REPORT_CONFIG || EMOJI_REPORT;

const MEDAL_BY_POS: Record<number, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
};

export function buildReportEmbed(
  report: AnyReport,
  opts: BuildReportEmbedOptions = {}
): EmbedBuilder {
  const now = opts.now ?? new Date();

  const game = (report.game ?? '').toLowerCase();
  const isCiv7 = game === 'civ7';
  const isCiv6 = game === 'civ6';

  const modeStr =
    'game_mode' in report && report.game_mode ? String(report.game_mode) : '';
  const isTeamMode = modeStr.toLowerCase().includes('team');
  const normalizedMode =
    modeStr.toLowerCase() === 'teamer'
      ? 'Teamer'
      : modeStr.toLowerCase() === 'duel'
        ? 'Duel'
        : 'FFA';
  const gameModeStr = `${report.is_cloud ? 'PBC-' : ''}${normalizedMode}`;

  // Meta
  const meta: string[] = [];
  if (opts.header) meta.push(opts.header);
  meta.push(`Game: **${report.game ?? '—'}**`);
  if ('game_mode' in report && report.game_mode)
    meta.push(`Mode: **${gameModeStr}**`);
  if ('turn' in report && typeof report.turn === 'number')
    meta.push(`Turn: **${report.turn}**`);
  if ('age' in (report as any) && (report as any).age)
    meta.push(`Age: **${(report as any).age}**`);
  if ('map_type' in report && report.map_type)
    meta.push(`Map: **${report.map_type}**`);

  const details: string[] = [];
  details.push(
    `• MatchID: ${'match_id' in report && report.match_id ? report.match_id : '—'}`
  );
  const reporterId = report.reporter_discord_id ?? opts.reporterId;
  details.push(`• Reporter: ${reporterId ? userMention(reporterId) : '—'}`);
  if (opts.approverId) details.push(`• Approved by: ${userMention(opts.approverId)}`);

  const description = meta.join(' • ') + '\n' + details.join('\n');

  // Players sorted by placement
  const players = [...report.players] as ParsedPlayer[];
  players.sort((a, b) => (placement1(a) ?? 9e9) - (placement1(b) ?? 9e9));

  // NOTE: We intentionally omit the separate "ID" column; placement/rank is the primary index.
  const rankColumn: string[] = [];
  const nameCivLeaderColumn: string[] = [];

  if (isTeamMode) {
    // group by team → order by best placement
    const teamMap = new Map<number, ParsedPlayer[]>();
    for (const p of players) {
      const t = teamId(p);
      const arr = teamMap.get(t);
      if (arr) arr.push(p);
      else teamMap.set(t, [p]);
    }

    const teams = [...teamMap.entries()]
      .map(([id, members]) => {
        members.sort((a, b) => (placement1(a) ?? 9e9) - (placement1(b) ?? 9e9));
        const best = members.reduce(
          (m, q) => Math.min(m, placement1(q) ?? 9e9),
          9e9
        );
        return { id, members, best };
      })
      .sort((a, b) => a.best - b.best);

    teams.forEach((t, idx) => {
      // Team header row
      rankColumn.push(rankToken(idx + 1));
      nameCivLeaderColumn.push(`**Team ${t.id + 1}**`);

      // Team members (no rank token per member)
      for (const p of t.members) {
        let rankValue = `${fmtDelta(delta(p))}`.padEnd(10);
        if (report.is_cloud) {
          if (p.combined_delta !== undefined) {
            const combinedRankValue = fmtDelta(p.combined_delta);
            rankValue += `(${combinedRankValue})`.padStart(10);
          }
        } else {
          if (p.season_delta !== undefined) {
            const seasonRankValue = fmtDelta(p.season_delta);
            rankValue += `(${seasonRankValue})`.padStart(10);
          }
        }
        rankColumn.push(`\`${rankValue}\``);
        nameCivLeaderColumn.push(
          `${who(p)}${quit(p)}${subinfo(p)} ${civText(isCiv6, isCiv7, p)}`
        );
      }
    });
  } else {
    // FFA / Duel
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const pos = placement1(p) ?? i + 1;

      let rankValue = `${rankToken(pos)} ${fmtDelta(delta(p))}`.padEnd(10);
      if (report.is_cloud) {
        if (p.combined_delta !== undefined) {
          const combinedRankValue = fmtDelta(p.combined_delta);
          rankValue += `(${combinedRankValue})`.padStart(10);
        }
      } else {
        if (p.season_delta !== undefined) {
          const seasonRankValue = fmtDelta(p.season_delta);
          rankValue += `(${seasonRankValue})`.padStart(10);
        }
      }

      rankColumn.push(`\`${rankValue}\``);
      nameCivLeaderColumn.push(
        `${who(p)}${quit(p)}${subinfo(p)} ${civText(isCiv6, isCiv7, p)}`
      );
    }
  }

  const embedColor = getEmbedColor(report);
  const columnsStr = clampNColumns([rankColumn, nameCivLeaderColumn], 1024);
  const currentTime = Math.floor(now.getTime() / 1000);
  const rankEloColumnHeader = report.is_cloud
    ? 'Rank / ΔELO (Combined)'
    : 'Rank / ΔELO (Seasonal)';

  return new EmbedBuilder()
    .setTitle(`${REPORT_EMOJI} Match Report`)
    .setDescription(description || '—')
    .setColor(embedColor)
    .addFields(
      {
        name: rankEloColumnHeader,
        value: columnsStr.str[0] || '—',
        inline: true,
      },
      {
        name: 'Players / Civ / Leader',
        value: columnsStr.str[1] || '—',
        inline: true,
      }
    )
    .addFields({
      name: opts.isFinal ? 'Approved At' : 'Last Changed At',
      value: `<t:${currentTime}:F>`,
      inline: false,
    });
}

/* ───────────── helpers ───────────── */

function isValidSnowflake(id: string | undefined): id is string {
  return typeof id === 'string' && /^\d{15,20}$/.test(id);
}

function getEmbedColor(report: AnyReport): number {
  for (const p of report.players) {
    const id = (p as any).discord_id as string | undefined;
    if (!isValidSnowflake(id)) return 0xff0000;
  }
  return 0x00ff00;
}

function placement1(p: ParsedPlayer): number | undefined {
  const v = (p as any).placement;
  return typeof v === 'number' ? v + 1 : undefined;
}

function teamId(p: ParsedPlayer): number {
  const t = (p as any).team;
  return typeof t === 'number' ? t : 0;
}

function delta(p: ParsedPlayer): number {
  const any = p as any;
  const v =
    (typeof any.delta === 'number' ? any.delta : undefined) ??
    (typeof any.elo_delta === 'number' ? any.elo_delta : undefined) ??
    (typeof any.eloDelta === 'number' ? any.eloDelta : undefined) ??
    (typeof any.rating_delta === 'number' ? any.rating_delta : undefined) ??
    0;
  return Number(v) || 0;
}

function rankToken(pos: number): string {
  const medal = MEDAL_BY_POS[pos];
  return medal ? medal : `${String(pos).padStart(2, '0')}:`;
}

function fmtDelta(d: number): string {
  const s = (d >= 0 ? `+${Math.round(d)}` : `${Math.round(d)}`).padStart(3, ' ');
  return `[${s}]`;
}

function who(p: ParsedPlayer): string {
  const id = (p as any).discord_id as string | undefined;
  const name = (p as any).user_name as string | undefined;
  if (isValidSnowflake(id)) return userMention(id);
  return name ? `@${name}` : 'UnknownUser';
}

function civText(isCiv6: boolean, isCiv7: boolean, p: ParsedPlayer): string {
  if (isCiv7) {
    const civKey = (p as any).civ;
    const leaderKey = (p as any).leader;
    const civVal = civKey ? formatCiv7Civ(String(civKey)) : null;
    const leaderVal = leaderKey ? formatCiv7Leader(String(leaderKey)) : null;

    const parts: string[] = [];
    if (civVal && civVal !== '—') parts.push(civVal);
    if (leaderVal && leaderVal !== '—') parts.push(`(${leaderVal})`);
    return parts.join(' ') || '—';
  }

  if (isCiv6) {
    const leaderKey = (p as any).civ;
    const leaderVal = leaderKey ? formatCiv6Leader(String(leaderKey)) : null;
    return leaderVal && leaderVal !== '—' ? leaderVal : '—';
  }

  const cv = (p as any).civ as string | undefined;
  return cv || '—';
}

function quit(p: ParsedPlayer): string {
  return 'quit' in (p as any) && (p as any).quit ? ` ${EMOJI_QUITTER}` : '';
}

function subinfo(p: ParsedPlayer): string {
  if (p.subbed_out) return ' (subbed out)';
  if (p.is_sub) return ' (substitute)';
  return '';
}

function clampNColumns(columns: string[][], max = 1024): { str: string[] } {
  let n = Math.min(...columns.map((arr) => arr.length));
  while (n > 0) {
    const sliced = columns.map((arr) => arr.slice(0, n).join('\n'));
    if (sliced.every((str) => str.length <= max)) return { str: sliced };
    n--;
  }
  return { str: [] };
}