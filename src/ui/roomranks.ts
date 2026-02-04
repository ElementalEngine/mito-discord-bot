import type { StatSet } from '../api/types.js';
import { MAX_DISCORD_LEN } from '../config/constants.js';

export type RoomRanksRow = {
  name: string;
  lifetime: StatSet;
  season: StatSet;
};

type BuildOpts = {
  title: string;
  includeSeason: boolean;
};

function fmtMu(v: number | null | undefined): string {
  return typeof v === 'number' ? String(v) : '—';
}

function clampName(name: string, max: number): string {
  const n = name.trim();
  if (n.length <= max) return n;
  if (max <= 1) return n.slice(0, max);
  return `${n.slice(0, max - 1)}…`;
}

function buildTable(
  title: string,
  rows: { name: string; set: StatSet }[],
  nameWidth: number
): string {
  const NAME_MAX = 18;

  const header = `${'Name'.padEnd(nameWidth)} | ${'FFA'.padStart(5)} | ${'Teamer'.padStart(6)} | ${'Duel'.padStart(5)}`;
  const sep = `${'-'.repeat(nameWidth)}-+-${'-'.repeat(5)}-+-${'-'.repeat(6)}-+-${'-'.repeat(5)}`;

  const lines: string[] = [title, '```', header, sep];
  for (const r of rows) {
    const name = clampName(r.name, NAME_MAX).padEnd(nameWidth);
    const ffa = fmtMu(r.set.ffa?.mu).padStart(5);
    const teamer = fmtMu(r.set.teamer?.mu).padStart(6);
    const duel = fmtMu(r.set.duel?.mu).padStart(5);
    lines.push(`${name} | ${ffa} | ${teamer} | ${duel}`);
  }
  lines.push('```');
  return lines.join('\n');
}

export function buildRoomRanksMessages(rows: RoomRanksRow[], opts: BuildOpts): string[] {
  const NAME_MAX = 18;
  const nameWidth = Math.min(
    NAME_MAX,
    Math.max(4, ...rows.map((r) => clampName(r.name, NAME_MAX).length))
  );

  const buildChunkMessage = (chunk: RoomRanksRow[]): string => {
    const lifetimeRows = chunk.map((r) => ({ name: r.name, set: r.lifetime }));
    const seasonRows = chunk.map((r) => ({ name: r.name, set: r.season }));

    const blocks: string[] = [
      buildTable(`${opts.title} — Lifetime`, lifetimeRows, nameWidth),
    ];
    if (opts.includeSeason) {
      blocks.push(buildTable(`${opts.title} — Season`, seasonRows, nameWidth));
    }
    return blocks.join('\n\n');
  };

  const out: string[] = [];
  let chunk: RoomRanksRow[] = [];

  for (const row of rows) {
    const candidate = [...chunk, row];
    const msg = buildChunkMessage(candidate);
    if (msg.length > MAX_DISCORD_LEN && chunk.length > 0) {
      out.push(buildChunkMessage(chunk));
      chunk = [row];
      continue;
    }
    chunk = candidate;
  }

  if (chunk.length > 0) {
    out.push(buildChunkMessage(chunk));
  }

  return out.length > 0 ? out : [buildChunkMessage(rows)];
}
