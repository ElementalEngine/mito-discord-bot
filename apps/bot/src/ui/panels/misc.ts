import type { PostAbout } from '../../utils/post-options.js';
import { channel, fit, mention, text, type Panel } from '../kit/index.js';

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

// Dice read as the numbers rolled, with their total; a unique draw of every
// number reads as places, a turn order; a partial one as the numbers drawn.
export function rollPanel(drawn: readonly number[], sides: number, unique: boolean, about: PostAbout = NOBODY): Panel {
  const order = unique && drawn.length === sides;
  const numbers = `### ${drawn.map((n) => `\`${n}\``).join(' ')}`;
  const total = drawn.reduce((sum, n) => sum + n, 0);
  const dice = drawn.length === 1 ? `1 die with ${sides} sides` : `${drawn.length} dice with ${sides} sides`;
  const footer = taggedFooter(about);
  return {
    tone: 'info',
    surface: 'roll',
    title: fit(about.label ? `Dice roll for ${about.label}` : 'Dice roll', 200),
    subtitle: order ? `${sides} places, each drawn once` : unique ? `${drawn.length} of 1\u2013${sides}, no repeats` : dice,
    body: [
      text(
        order
          ? drawn.map((n, i) => `${i + 1}. **${n}**`).join('\n')
          : unique || drawn.length === 1
            ? numbers
            : `${numbers}\n-# Total ${total}`,
      ),
    ],
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
