import { MAX_DISCORD_LEN } from '../../config/constants.js';

type ModeCols = Readonly<{
  ffa?: number | null;
  teamer?: number | null;
  duel?: number | null;
}>;

export type RoomRanksRow = Readonly<{
  name: string;
  lifetime: ModeCols;
  season: ModeCols;
}>;

export type RoomRanksLifetimeRow = Readonly<{
  name: string;
  lifetime: ModeCols;
}>;

const NAME_MIN_W = 10;
const NAME_MAX_W = 16;
const ANSI_BLUE = '\u001b[34m';
const ANSI_RESET = '\u001b[0m';

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function clampName(name: string, maxLen: number): string {
  const clean = cleanName(name);
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1))}…`;
}

function fmtCell(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return String(Math.round(n));
}

function blue(text: string): string {
  return `${ANSI_BLUE}${text}${ANSI_RESET}`;
}

function computeNameWidth(names: readonly string[]): number {
  const maxLen = names.reduce((acc, n) => Math.max(acc, n.length), 0);
  return Math.min(NAME_MAX_W, Math.max(NAME_MIN_W, maxLen, 'Name'.length));
}

type Widths = Readonly<{
  name: number;
  ffa: number;
  teamer: number;
  duel: number;
}>;

function computeWidths<T extends { name: string }>(
  rows: readonly T[],
  getCols: (row: T) => ModeCols
): Widths {
  const names = rows.map((r) => clampName(r.name, NAME_MAX_W));
  const nameW = computeNameWidth(names);

  const header = { ffa: 'FFA', teamer: 'Teamer', duel: 'Duel' } as const;
  const modeWidths = {
    ffa: header.ffa.length,
    teamer: header.teamer.length,
    duel: header.duel.length,
  };

  for (const r of rows) {
    const cols = getCols(r);
    modeWidths.ffa = Math.max(modeWidths.ffa, fmtCell(cols.ffa).length);
    modeWidths.teamer = Math.max(modeWidths.teamer, fmtCell(cols.teamer).length);
    modeWidths.duel = Math.max(modeWidths.duel, fmtCell(cols.duel).length);
  }

  return { name: nameW, ...modeWidths };
}

function buildSeparator(widths: Widths): string {
  const nameSeg = '-'.repeat(widths.name + 1);
  const ffaSeg = '-'.repeat(widths.ffa + 2);
  const teamerSeg = '-'.repeat(widths.teamer + 2);
  const duelSeg = '-'.repeat(widths.duel + 1);
  return `${nameSeg}+${ffaSeg}+${teamerSeg}+${duelSeg}`;
}

function buildHeader(widths: Widths): string {
  return `${'Name'.padEnd(widths.name)} | ${'FFA'.padStart(widths.ffa)} | ${'Teamer'.padStart(widths.teamer)} | ${'Duel'.padStart(widths.duel)}`.trimEnd();
}

function buildRow(name: string, cols: ModeCols, widths: Widths): string {
  const n = clampName(name, widths.name).padEnd(widths.name);

  const ffaPlain = fmtCell(cols.ffa).padStart(widths.ffa);
  const teamerPlain = fmtCell(cols.teamer).padStart(widths.teamer);
  const duelPlain = fmtCell(cols.duel).padStart(widths.duel);

  const ffa =
    typeof cols.ffa === 'number' && Number.isFinite(cols.ffa) ? blue(ffaPlain) : ffaPlain;
  const teamer =
    typeof cols.teamer === 'number' && Number.isFinite(cols.teamer)
      ? blue(teamerPlain)
      : teamerPlain;
  const duel =
    typeof cols.duel === 'number' && Number.isFinite(cols.duel) ? blue(duelPlain) : duelPlain;

  return `${n} | ${ffa} | ${teamer} | ${duel}`.trimEnd();
}

function wrapAnsi(lines: readonly string[]): string {
  const cleaned = lines.map((l) => l.trimEnd());
  return `\`\`\`ansi\n${cleaned.join('\n')}\n\`\`\``;
}

function renderTable<T extends { name: string }>(
  rows: readonly T[],
  getCols: (row: T) => ModeCols
): string {
  const widths = computeWidths(rows, getCols);
  const lines: string[] = [];

  lines.push(buildHeader(widths));
  lines.push(buildSeparator(widths));
  for (const r of rows) lines.push(buildRow(r.name, getCols(r), widths));

  return wrapAnsi(lines);
}

function renderAll(args: Readonly<{
  titleEmoji?: string;
  subtitle?: string;
  realtimeRows: readonly RoomRanksRow[];
  cloudLifetimeRows: readonly RoomRanksLifetimeRow[] | null;
}>): string {
  const { titleEmoji, subtitle, realtimeRows, cloudLifetimeRows } = args;

  const emoji = titleEmoji ?? '📊';

  const out: string[] = [];
  out.push(`**${emoji} Room Rankings**`);
  if (subtitle) out.push(subtitle);

  out.push('**Realtime — Lifetime ELO**');
  out.push(renderTable(realtimeRows, (r) => r.lifetime));

  out.push('**Realtime — Season ELO**');
  out.push(renderTable(realtimeRows, (r) => r.season));

  if (cloudLifetimeRows && cloudLifetimeRows.length > 0) {
    out.push('**Cloud — Lifetime ELO**');
    out.push(renderTable(cloudLifetimeRows, (r) => r.lifetime));
  }

  return out.join('\n');
}

export function formatRoomRanksPages(args: Readonly<{
  titleEmoji?: string;
  subtitle?: string;
  realtimeRows: readonly RoomRanksRow[];
  cloudLifetimeRows: readonly RoomRanksLifetimeRow[] | null;
}>): string[] {
  const { realtimeRows } = args;

  if (realtimeRows.length === 0) {
    const emoji = args.titleEmoji ?? '📊';
    return [`**${emoji} Room Rankings**\nNo users.`];
  }

  const full = renderAll(args);
  if (full.length <= MAX_DISCORD_LEN) return [full];

  const pages: string[] = [];
  let start = 0;

  while (start < realtimeRows.length) {
    let end = Math.min(realtimeRows.length, start + 25);
    let page = '';

    for (; end > start; end -= 1) {
      const rtChunk = realtimeRows.slice(start, end);
      const cloudChunk = args.cloudLifetimeRows ? args.cloudLifetimeRows.slice(start, end) : null;

      page = renderAll({
        titleEmoji: args.titleEmoji,
        subtitle: args.subtitle,
        realtimeRows: rtChunk,
        cloudLifetimeRows: cloudChunk,
      });

      if (page.length <= MAX_DISCORD_LEN) break;
    }

    if (!page || page.length > MAX_DISCORD_LEN) {
      pages.push(full.slice(0, MAX_DISCORD_LEN));
      break;
    }

    pages.push(page);
    start = end;
  }

  return pages;
}
