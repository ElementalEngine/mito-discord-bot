import type { PostAbout } from '../../utils/post-options.js';
import { channel, file, fit, mention, text, when, type Panel } from '../kit/index.js';

export type CoinSide = 'heads' | 'tails';

export function coinPanel(side: CoinSide): Panel {
  return { tone: 'info', surface: 'coin', title: 'Coin flip', body: [text(`It landed on **${side}**.`)] };
}

// Who and where a result is for, under it; the player tagged is notified.
export function taggedFooter(about: PostAbout): string | undefined {
  const tagged = [about.userId ? mention(about.userId) : null, about.channelId ? channel(about.channelId) : null].filter((x): x is string => x !== null);
  return tagged.length ? tagged.join(' \u00b7 ') : undefined;
}

const NOBODY: PostAbout = { label: '', userId: null, channelId: null };

// The seed is in code so it copies cleanly into the game's setup screen.
export function seedPanel(seed: string, about: PostAbout = NOBODY): Panel {
  const footer = taggedFooter(about);
  return {
    tone: 'info',
    surface: 'seed',
    title: about.label ? fit(`Map seed for ${about.label}`, 200) : 'Map seed',
    body: [text(`### \`${seed}\``)],
    ...(footer ? { footer } : {}),
  };
}

// A full draw reads as places, a turn order; a partial one as the numbers drawn.
export function rollPanel(drawn: readonly number[], max: number, about: PostAbout = NOBODY): Panel {
  const order = drawn.length === max;
  const footer = taggedFooter(about);
  return {
    tone: 'info',
    surface: 'roll',
    title: fit(about.label ? `Dice roll for ${about.label}` : 'Dice roll', 200),
    subtitle: order ? `${max} places, each drawn once` : `${drawn.length} of 1\u2013${max}, no repeats`,
    body: [text(order ? drawn.map((n, i) => `${i + 1}. **${n}**`).join('\n') : `### ${drawn.map((n) => `\`${n}\``).join(' ')}`)],
    ...(footer ? { footer } : {}),
  };
}

export type Reach = Readonly<{ ok: boolean; ms: number; dbMs: number | null }>;

// Discord's heartbeat is unknown for a moment after a start, and reads -1.
export function pingPanel(gatewayMs: number, league: Reach): Panel {
  const gateway = gatewayMs >= 0 ? `${Math.round(gatewayMs)} ms` : 'not measured yet';
  return {
    tone: league.ok ? 'success' : 'failed',
    surface: 'ping',
    title: 'Pong',
    body: [
      text(`**Discord** ${gateway}`),
      text(league.ok ? `**League server** ${league.ms} ms` : `**League server** not answering after ${league.ms} ms`),
      text(league.ok ? `**Database** ${league.dbMs === null ? 'ready' : `${Math.round(league.dbMs)} ms`}` : '**Database** unknown'),
    ],
  };
}

export type MemberCounts = Readonly<{ total: number; bots: number }>;

export function membersPanel(counts: MemberCounts, fileName: string, at: Date): Panel {
  return {
    tone: 'info',
    surface: 'users',
    title: 'Server members',
    subtitle: `Exported ${when(at)}`,
    body: [
      text(`**${counts.total}** members \u00b7 **${counts.total - counts.bots}** people \u00b7 **${counts.bots}** bots`),
      file(fileName),
    ],
  };
}
