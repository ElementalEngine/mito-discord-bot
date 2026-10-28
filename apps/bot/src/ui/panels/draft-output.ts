import type { Lobby, SettingQuestion } from '../../api/types.js';
import { field, mention, nameOf, text, type CivNames, type Panel } from '../kit/index.js';
import { pickLines } from './draft.js';

const DRAFT_MODES: Readonly<Record<string, string>> = { standard: 'Standard', random: 'Random', blind: 'Blind' };

export const draftModeName = (mode: string | null): string => (mode ? `${DRAFT_MODES[mode] ?? mode} draft` : 'Draft not set');

// Each setting with its option's emoji, as chosen; one not chosen yet says so.
export function settingLines(chosen: Readonly<Record<string, string>>, questions: readonly SettingQuestion[]): string {
  return questions
    .map((q) => {
      const option = q.options.find((o) => o.id === chosen[q.id]);
      return option ? `${option.emoji} ${q.title}: ${option.label}` : `⬜ ${q.title}: not set`;
    })
    .join('\n');
}

export const banLine = (names: CivNames, bans: readonly string[]): string => bans.map((t) => nameOf(names, t)).join(' · ') || 'None';

// What a lobby or a vote drafted, as both post it.
export type DraftOutput = Readonly<{
  title: string;
  footer: string;
  draftMode: string | null;
  teams: number;
  players: Lobby['players'];
  pools: Lobby['pools'];
  picks: Lobby['picks'];
  settings: Readonly<Record<string, string>>;
  questions: readonly SettingQuestion[];
  bans: Lobby['bans'];
  banKinds: readonly ('leader' | 'civ')[];
}>;

// One message for a blind or random draft, each player with their pick; a
// standard draft's pool size, then each pool as its own message to trade from.
export function draftOutputPanels(out: DraftOutput, names: CivNames): Panel[] {
  const bans = out.banKinds.map((kind) =>
    field(kind === 'civ' ? 'Civ bans' : 'Leader bans', banLine(names, out.bans.filter((b) => b.kind === kind).map((b) => b.token))),
  );
  const game = [field('Settings', settingLines(out.settings, out.questions)), ...bans];
  const head = { tone: 'info', surface: 'draft', title: out.title, footer: out.footer } as const;
  const civOf = (civ: string | null | undefined): string => (civ ? ` · ${nameOf(names, civ)}` : '');
  const team = (team: number | null): string => (out.teams && team ? `Team ${team} · ` : '');
  if (out.draftMode === 'blind') {
    const picks = out.picks.map((p) => `${mention(p.player_id)} · ${nameOf(names, p.leader)}${civOf(p.civ)}${p.by === 'auto' ? ' (auto pick)' : ''}`);
    return [{ ...head, subtitle: draftModeName(out.draftMode), body: [field('Picks', picks.join('\n')), ...game] }];
  }
  if (out.draftMode === 'random') {
    const picks = out.pools.map((p) => `${team(p.team)}${mention(p.player_id ?? '')} · ${nameOf(names, p.leaders[0] ?? '')}${civOf(p.civs[0])}`);
    return [{ ...head, subtitle: draftModeName(out.draftMode), body: [field('Picks', picks.join('\n')), ...game] }];
  }
  const size = out.pools[0]?.leaders.length ?? 0;
  const civs = out.pools[0]?.civs.length ?? 0;
  const sizes = `${size} leader${size === 1 ? '' : 's'}${civs ? ` and ${civs} civ${civs === 1 ? '' : 's'}` : ''} ${out.teams ? 'a team' : 'each'}`;
  const members = (n: number | null): string => {
    const ids = out.players.filter((p) => p.team === n).map((p) => p.discord_id);
    return ids.length ? `-# ${ids.map(mention).join(', ')}\n` : '';
  };
  return [
    { ...head, subtitle: `${draftModeName(out.draftMode)} · ${sizes}`, body: game },
    ...out.pools.map(
      (pool): Panel => ({
        tone: 'info',
        title: pool.player_id ? mention(pool.player_id) : `Team ${pool.team}`,
        body: [
          text(
            `${pool.player_id ? '' : members(pool.team)}${pickLines(names, pool.leaders)}${pool.civs.length ? `\n-# Civs\n${pickLines(names, pool.civs)}` : ''}`,
          ),
        ],
        footer: out.footer,
      }),
    ),
  ];
}
