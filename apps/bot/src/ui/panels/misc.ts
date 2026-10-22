import { channel, file, fit, mention, text, when, type Panel } from '../kit/index.js';

export type CoinSide = 'heads' | 'tails';

export function coinPanel(side: CoinSide): Panel {
  return { tone: 'info', surface: 'coin', title: 'Coin flip', body: [text(`It landed on **${side}**.`)] };
}

export type SeedFor = Readonly<{ label?: string; userId?: string | null; channelId?: string | null }>;

// The seed is in code so it copies cleanly into the game's setup screen.
export function seedPanel(seed: string, about: SeedFor = {}): Panel {
  const label = about.label?.trim();
  const tagged = [about.userId ? mention(about.userId) : null, about.channelId ? channel(about.channelId) : null]
    .filter((x): x is string => x !== null)
    .join(' \u00b7 ');
  return {
    tone: 'info',
    surface: 'seed',
    title: label ? fit(`Map seed for ${label}`, 200) : 'Map seed',
    body: [text(`### \`${seed}\``)],
    ...(tagged ? { footer: tagged } : {}),
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
