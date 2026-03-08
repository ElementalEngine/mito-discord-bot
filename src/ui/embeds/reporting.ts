import { EmbedBuilder, userMention } from "discord.js";
import type { BaseReport } from "../../types/reporting.types.js";
import type { UploadSaveResponse, GetMatchResponse, ParsedPlayer } from "../../api/types.js";
import { formatCiv6Leader, formatCiv7Civ, formatCiv7Leader } from "../../data/index.js";
import { EMOJI_QUITTER } from "../../config/constants.js";

type AnyReport = GetMatchResponse | UploadSaveResponse | BaseReport;

type BuildOpts = {
  header?: string;
  reporterId?: string;
  approverId?: string;
  apiMs?: number; // kept for back-compat (unused here)
  now?: Date;
  isFinal?: boolean;
};

type PlayerExt = ParsedPlayer & {
  placement?: number;
  team?: number;
  discord_id?: string;
  user_name?: string;
  quit?: boolean;
  delta?: number;
  season_delta?: number;
  combined_delta?: number;
  is_sub?: boolean;
  subbed_out?: boolean;
};

const RANK_DELTA_HEADER = "`Rank| ΔLT  |  ΔSS`";

const LT_CELL_WIDTH = 10;
const SS_CELL_WIDTH = 9;
const PLAYER_ROW_MAX_WIDTH = 26;

export function buildReportEmbed(report: AnyReport, opts: BuildOpts = {}): EmbedBuilder {
  const now = opts.now ?? new Date();

  const game = (report.game ?? "").toLowerCase();
  const isCiv7 = game === "civ7";
  const isCiv6 = game === "civ6";

  const rawMode = "game_mode" in report && report.game_mode ? String(report.game_mode) : "";
  const modeKey = rawMode.toLowerCase().replace(/^pbc-/, "");
  const isTeamMode = modeKey.includes("team"); // matches "team" + "teamer"
  const normalizedMode =
    modeKey === "teamer" || modeKey === "team" ? "Teamer" : modeKey === "duel" ? "Duel" : "FFA";
  const gameModeStr = `${report.is_cloud ? "PBC-" : ""}${normalizedMode}`;

  const meta: string[] = [];
  if (opts.header) meta.push(opts.header);
  meta.push(`Game: **${report.game ?? "—"}**`);
  if ("game_mode" in report && report.game_mode) meta.push(`Mode: **${gameModeStr}**`);
  if ("turn" in report && typeof report.turn === "number") meta.push(`Turn: **${report.turn}**`);
  if ("age" in (report as object) && (report as { age?: unknown }).age) {
    meta.push(`Age: **${String((report as { age: unknown }).age)}**`);
  }
  if ("map_type" in report && report.map_type) meta.push(`Map: **${report.map_type}**`);

  const matchId = "match_id" in report && report.match_id ? report.match_id : "—";
  const reporterId = report.reporter_discord_id ?? opts.reporterId;

  const details: string[] = [];
  details.push(`• MatchID: ${matchId}`);
  details.push(`• Reporter: ${reporterId ? userMention(reporterId) : "—"}`);
  if (opts.approverId) details.push(`• Approved by: ${userMention(opts.approverId)}`);

  const description = `${meta.join(" • ")}` + "\n" + details.join("\n");

  const idByRef = new Map<ParsedPlayer, number>();
  for (let i = 0; i < report.players.length; i++) idByRef.set(report.players[i], i + 1);

  const players = [...(report.players as PlayerExt[])];
  players.sort((a, b) => (placement1(a) ?? 9e9) - (placement1(b) ?? 9e9));

  const idColumn: string[] = [];
  const rankColumn: string[] = [];
  const nameCivLeaderColumn: string[] = [];

  if (isTeamMode) {
    const teamMap = new Map<number, PlayerExt[]>();
    for (const p of players) {
      const t = teamId(p);
      const arr = teamMap.get(t);
      if (arr) arr.push(p);
      else teamMap.set(t, [p]);
    }

    const teams = [...teamMap.entries()]
      .map(([teamNum, members]) => {
        members.sort((a, b) => (placement1(a) ?? 9e9) - (placement1(b) ?? 9e9));
        const best = members.reduce((m, q) => Math.min(m, placement1(q) ?? 9e9), 9e9);
        return { teamNum, members, best };
      })
      .sort((a, b) => a.best - b.best);

    teams.forEach((t, idx) => {
      const teamRank = idx + 1;

      idColumn.push(`\`${`T${t.teamNum + 1}`.padStart(2, " ")}\``);
      rankColumn.push(formatTeamHeaderRank(teamRank));
      nameCivLeaderColumn.push(`**Team ${t.teamNum + 1}**`);

      for (const p of t.members) {
        idColumn.push(`\`${String(idByRef.get(p) ?? "—").padStart(2, " ")}\``);

        const lt = deltaLT(p);
        const ss = deltaSS(report.is_cloud, p);
        rankColumn.push(formatRankDelta(numRank(teamRank), lt, ss));

        const civ = civText(isCiv6, isCiv7, p);
        const prefix = `${who(p)}${quit(p)}${subinfo(p)}`;
        nameCivLeaderColumn.push(clampPlayerRow(prefix, civ));
      }
    });
  } else {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const pos = placement1(p) ?? i + 1;

      idColumn.push(`\`${String(idByRef.get(p) ?? "—").padStart(2, " ")}\``);

      const lt = deltaLT(p);
      const ss = deltaSS(report.is_cloud, p);
      rankColumn.push(formatRankDelta(numRank(pos), lt, ss));

      const civ = civText(isCiv6, isCiv7, p);
      const prefix = `${who(p)}${quit(p)}${subinfo(p)}`;
      nameCivLeaderColumn.push(clampPlayerRow(prefix, civ));
    }
  }

  const embedColor = getEmbedColor(report);
  const columnsStr = clampNColumns([idColumn, rankColumn, nameCivLeaderColumn], 1024);
  const currentTime = Math.floor(now.getTime() / 1000);

  let resultEmbed = new EmbedBuilder()
    .setTitle("Match Report")
    .setDescription(description || "—")
    .setColor(embedColor)
    .addFields(
      { name: "ID", value: columnsStr.str[0] || "—", inline: true },
      { name: RANK_DELTA_HEADER, value: columnsStr.str[1] || "—", inline: true },
      { name: "Players / Civ / Leader", value: columnsStr.str[2] || "—", inline: true }
    )
    .addFields({
      name: opts.isFinal ? "Approved At" : "Last Changed At",
      value: `<t:${currentTime}:F>`,
      inline: false,
    });
    if (report.contest_report_list && report.contest_report_list.length > 0) {
      const contestReasons = report.contest_report_list.map(cr => `• ${userMention(cr.contestor_discord_id)}: ${cr.reason}`).join("\n");
      resultEmbed = resultEmbed.addFields({
        name: "Players contesting report",
        value: contestReasons,
        inline: false,
      });
    }
    return resultEmbed;
}

function isValidSnowflake(id: string | undefined): id is string {
  return typeof id === "string" && /^\d{15,20}$/.test(id);
}

function getEmbedColor(report: AnyReport): number {
  for (const raw of report.players as PlayerExt[]) {
    if (!isValidSnowflake(raw.discord_id)) return 0xff0000;
  }
  return 0x00ff00;
}

function placement1(p: PlayerExt): number | undefined {
  const v = p.placement;
  return typeof v === "number" ? v + 1 : undefined;
}

function teamId(p: PlayerExt): number {
  const t = p.team;
  return typeof t === "number" ? t : 0;
}

function deltaLT(p: PlayerExt): number {
  const v =
    (typeof p.delta === "number" ? p.delta : undefined) ??
    (typeof (p as unknown as { elo_delta?: unknown }).elo_delta === "number"
      ? (p as unknown as { elo_delta: number }).elo_delta
      : undefined) ??
    (typeof (p as unknown as { eloDelta?: unknown }).eloDelta === "number"
      ? (p as unknown as { eloDelta: number }).eloDelta
      : undefined) ??
    (typeof (p as unknown as { rating_delta?: unknown }).rating_delta === "number"
      ? (p as unknown as { rating_delta: number }).rating_delta
      : undefined) ??
    0;

  return Number(v) || 0;
}

function deltaSS(isCloud: boolean, p: PlayerExt): number | undefined {
  const v = isCloud ? p.combined_delta : p.season_delta;
  return typeof v === "number" ? v : undefined;
}

function numRank(pos: number): string {
  return `${String(pos).padStart(2, "0")}:`;
}

function fmtDelta(d: number): string {
  const rounded = Math.round(d);
  const sign = rounded >= 0 ? "+" : "-";
  const abs = Math.abs(rounded);
  return `[${sign}${String(abs).padStart(3, " ")}]`;
}

function formatRankDelta(rankTok: string, lt: number, ss?: number): string {
  const ltPart = `${rankTok} ${fmtDelta(lt)}`.padEnd(LT_CELL_WIDTH, " ");
  const ssPart = typeof ss === "number" ? `(${fmtDelta(ss)})` : "";
  const ssPadded = ssPart.padStart(SS_CELL_WIDTH, " ");
  return `\`${ltPart}${ssPadded}\``;
}

function formatTeamHeaderRank(teamRank: number): string {
  return `\`${numRank(teamRank)}\``;
}

function who(p: PlayerExt): string {
  const id = p.discord_id;
  const name = p.user_name;
  return isValidSnowflake(id) ? userMention(id) : name ? `@${name}` : "UnknownUser";
}

function civText(isCiv6: boolean, isCiv7: boolean, p: PlayerExt): string {
  if (isCiv7) {
    const civVal = p.civ ? formatCiv7Civ(String(p.civ)) : null;
    const leaderVal = p.leader ? formatCiv7Leader(String(p.leader)) : null;

    const parts: string[] = [];
    if (civVal && civVal !== "—") parts.push(civVal);
    if (leaderVal && leaderVal !== "—") parts.push(leaderVal);
    return parts.join(" ") || "—";
  }

  if (isCiv6) {
    const leaderKey = (p as unknown as { civ?: unknown }).civ;
    const leaderVal = leaderKey ? formatCiv6Leader(String(leaderKey)) : null;
    return leaderVal && leaderVal !== "—" ? leaderVal : "—";
  }

  return typeof p.civ === "string" && p.civ ? p.civ : "—";
}

function quit(p: PlayerExt): string {
  return p.quit ? ` ${EMOJI_QUITTER}` : "";
}

function subinfo(p: PlayerExt): string {
  if (p.subbed_out) return " (subbed out)";
  if (p.is_sub) return " (substitute)";
  return "";
}

function clampNColumns(columns: string[][], max = 1024): { str: string[] } {
  let n = Math.min(...columns.map((arr) => arr.length));
  while (n > 0) {
    const sliced = columns.map((arr) => arr.slice(0, n).join("\n"));
    if (sliced.every((str) => str.length <= max)) return { str: sliced };
    n--;
  }
  return { str: [] };
}

function clampPlayerRow(prefix: string, civ: string): string {
  const cleanPrefix = prefix.trim();
  const cleanCiv = civ.trim();

  if (!cleanPrefix) return truncateToWidth(cleanCiv, PLAYER_ROW_MAX_WIDTH);
  if (!cleanCiv) return truncateToWidth(cleanPrefix, PLAYER_ROW_MAX_WIDTH);

  const tail = ` ${cleanCiv}`;
  const tailWidth = estimatedWidth(tail);

  if (tailWidth >= PLAYER_ROW_MAX_WIDTH) return truncateToWidth(cleanCiv, PLAYER_ROW_MAX_WIDTH);

  const budget = PLAYER_ROW_MAX_WIDTH - tailWidth;
  const head = truncateToWidth(cleanPrefix, budget);
  return `${head}${tail}`.trimEnd();
}

function estimatedWidth(input: string): number {
  let w = 0;
  let i = 0;

  while (i < input.length) {
    const rest = input.slice(i);

    const emojiMatch = rest.match(/^<a?:[^:>]+:\d+>/);
    if (emojiMatch) {
      w += 2;
      i += emojiMatch[0].length;
      continue;
    }

    const mentionMatch = rest.match(/^<@!?\d+>/);
    if (mentionMatch) {
      w += 8;
      i += mentionMatch[0].length;
      continue;
    }

    w += 1;
    i += 1;
  }

  return w;
}

function truncateToWidth(input: string, maxWidth: number): string {
  const s = input.trimEnd();
  if (maxWidth <= 0) return "…";
  if (estimatedWidth(s) <= maxWidth) return s;

  let w = 0;
  let i = 0;

  while (i < s.length) {
    const rest = s.slice(i);

    const emojiMatch = rest.match(/^<a?:[^:>]+:\d+>/);
    if (emojiMatch) {
      const token = emojiMatch[0];
      if (w + 2 > maxWidth) break;
      w += 2;
      i += token.length;
      continue;
    }

    const mentionMatch = rest.match(/^<@!?\d+>/);
    if (mentionMatch) {
      const token = mentionMatch[0];
      if (w + 8 > maxWidth) break;
      w += 8;
      i += token.length;
      continue;
    }

    if (w + 1 > maxWidth) break;
    w += 1;
    i += 1;
  }

  const out = s.slice(0, i).trimEnd();
  return out.length ? `${out}…` : "…";
}