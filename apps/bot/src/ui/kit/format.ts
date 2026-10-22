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

// Token -> what a player reads, with its portrait from the bot's own emoji:
// Discord renders an application's emoji only for that application.
export type CivNames = ReadonlyMap<string, string>;

export function civNamesOf(data: CivDataResponse, emojis: ReadonlyMap<string, string> = new Map()): CivNames {
  return new Map(
    [...data.leaders, ...data.civs].map((row): [string, string] => {
      const shown = row.display ?? pretty(row.token);
      const id = emojis.get(row.name);
      return [row.token, id ? `<:${row.name}:${id}> ${shown}` : shown];
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
