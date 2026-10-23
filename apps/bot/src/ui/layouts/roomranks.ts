
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

type Rows = Readonly<{
  realtimeRows: readonly RoomRanksRow[];
  cloudLifetimeRows: readonly RoomRanksLifetimeRow[] | null;
}>;

function renderAll({ realtimeRows, cloudLifetimeRows }: Rows): string {
  const out: string[] = [];
  out.push('**Realtime \u00b7 lifetime**');
  out.push(renderTable(realtimeRows, (r) => r.lifetime));
  out.push('**Realtime \u00b7 season**');
  out.push(renderTable(realtimeRows, (r) => r.season));
  if (cloudLifetimeRows && cloudLifetimeRows.length > 0) {
    out.push('**Cloud \u00b7 lifetime**');
    out.push(renderTable(cloudLifetimeRows, (r) => r.lifetime));
  }
  return out.join('\n');
}

// The tables as pages of at most `limit` characters, each page a slice of the
// same players across every table.
export function formatRoomRanksPages(rows: Rows, limit: number): string[] {
  const { realtimeRows, cloudLifetimeRows } = rows;
  const full = renderAll(rows);
  if (full.length <= limit) return [full];

  const pages: string[] = [];
  let start = 0;
  while (start < realtimeRows.length) {
    let end = Math.min(realtimeRows.length, start + 25);
    let page = '';
    for (; end > start; end -= 1) {
      page = renderAll({
        realtimeRows: realtimeRows.slice(start, end),
        cloudLifetimeRows: cloudLifetimeRows ? cloudLifetimeRows.slice(start, end) : null,
      });
      if (page.length <= limit) break;
    }
    if (end === start) {
      pages.push(full.slice(0, limit));
      break;
    }
    pages.push(page);
    start = end;
  }
  return pages;
}
