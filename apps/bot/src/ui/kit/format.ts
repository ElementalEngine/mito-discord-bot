import type { CivDataResponse } from '../../api/types.js';

export const mention = (id: string): string => `<@${id}>`;
export const channel = (id: string): string => `<#${id}>`;

export type TimeStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

export function when(at: Date | number, style: TimeStyle = 'f'): string {
  const ms = typeof at === 'number' ? at : at.getTime();
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function signed(n: number, digits = 0): string {
  const text = Math.abs(n).toFixed(digits);
  if (Number(text) === 0) return `\u00b1${text}`;
  return n > 0 ? `+${text}` : `\u2212${text}`;
}

// A token's own spelling, for when no civ-data row names it.
export function pretty(token: string): string {
  return token
    .replace(/^(LEADER|CIVILIZATION)_/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Token -> what a player reads, with the portrait where the row has one.
export type CivNames = ReadonlyMap<string, string>;

export function civNamesOf(data: CivDataResponse): CivNames {
  return new Map(
    [...data.leaders, ...data.civs].map((row): [string, string] => {
      const shown = row.display ?? pretty(row.token);
      return [row.token, row.emoji_id ? `<:${row.name}:${row.emoji_id}> ${shown}` : shown];
    }),
  );
}

export function nameOf(names: CivNames, token: string): string {
  return names.get(token) ?? pretty(token);
}

// The name without its portrait, for lists where one per entry would crowd.
export function plainNameOf(names: CivNames, token: string): string {
  return nameOf(names, token).replace(/^<:[^>]+>\s*/, '');
}
