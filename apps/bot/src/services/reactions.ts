import type { SendableChannels } from 'discord.js';

import type { LobbyBallot } from '../api/types.js';
import { log } from '../utils/log.js';
import { inLobbyTurn } from './lobby.service.js';

export type Reaction = Readonly<{ id: string | null; name: string | null; users: readonly string[] }>;
export type Emoji = Readonly<{ id: string | null; name: string | null }>;
// A leader or civ as civ data names it: its portrait's name, its own, its civ.
type Named = Readonly<{ token: string; name: string; display?: string | null; civ_display?: string | null }>;

const keyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Each leader or civ under any name a server's emoji may give it: the portrait
// name, its own, or with the civ either side. A name two of them share is dropped.
function tokensByName(rows: readonly Named[]): ReadonlyMap<string, string> {
  const found = new Map<string, string | null>();
  for (const row of rows) {
    const own = row.display ?? '';
    const civ = row.civ_display ?? '';
    for (const key of new Set([row.name, own, civ && own ? civ + own : '', civ && own ? own + civ : ''].filter(Boolean).map(keyOf))) {
      found.set(key, found.has(key) && found.get(key) !== row.token ? null : row.token);
    }
  }
  return new Map([...found].flatMap(([key, token]): [string, string][] => (token ? [[key, token]] : [])));
}

// The ban reactions per server emoji, matched by name: the players banning
// each. Others are left out; custom emoji naming none of them come back.
export function ballotOf(reactions: readonly Reaction[], players: readonly string[], rows: readonly Named[]): { ballot: LobbyBallot; unmatched: string[] } {
  const voters = new Set(players);
  const tokenOf = tokensByName(rows);
  const bans: Record<string, string[]> = {};
  const unmatched: string[] = [];
  for (const { id, name, users } of reactions) {
    if (!id || !name) continue;
    const token = tokenOf.get(keyOf(name));
    if (!token) unmatched.push(name);
    const backing = users.filter((u) => voters.has(u));
    if (!token || !backing.length) continue;
    bans[token] = [...new Set([...(bans[token] ?? []), ...backing])];
  }
  return { ballot: { bans }, unmatched };
}

// A message's reactions, read fresh from Discord rather than the cache. One
// only the bot has added needs no read.
export async function reactionsOn(place: SendableChannels, messageId: string | undefined): Promise<Reaction[]> {
  const message = messageId ? await place.messages.fetch({ message: messageId, force: true }).catch(() => null) : null;
  const reactions: Reaction[] = [];
  for (const reaction of message?.reactions.cache.values() ?? []) {
    const users = reaction.count <= (reaction.me ? 1 : 0) ? [] : [...(await reaction.users.fetch()).keys()];
    reactions.push({ id: reaction.emoji.id, name: reaction.emoji.name, users });
  }
  return reactions;
}

// Each open ban message's reactions as they come in, counted without a read.
// A restart loses them; the final count reads Discord itself.
type Watched = {
  setupId: string;
  reactions: Map<string, { id: string; name: string; users: Set<string> }>;
  count: (reactions: Reaction[]) => Promise<void>;
  timer?: NodeJS.Timeout;
};
const watched = new Map<string, Watched>();
const COUNT_DELAY_MS = 1_000;

export function watchBans(messageId: string, setupId: string, count: (reactions: Reaction[]) => Promise<void>): void {
  watched.set(messageId, { setupId, reactions: new Map(), count });
}

export function unwatchBans(messageIds: readonly (string | undefined)[]): void {
  for (const id of messageIds) {
    if (!id) continue;
    clearTimeout(watched.get(id)?.timer);
    watched.delete(id);
  }
}

// A ban reaction added or taken back; the count so far is sent, in its
// setup's turn, a second after the last one, so a burst is one call.
export function trackBanReaction(messageId: string, emoji: Emoji, userId: string, added: boolean): void {
  const ban = watched.get(messageId);
  if (!ban || !emoji.id || !emoji.name) return;
  const reaction = ban.reactions.get(emoji.id) ?? { id: emoji.id, name: emoji.name, users: new Set<string>() };
  if (added) reaction.users.add(userId);
  else reaction.users.delete(userId);
  ban.reactions.set(emoji.id, reaction);
  clearTimeout(ban.timer);
  ban.timer = setTimeout(() => {
    const reactions = [...ban.reactions.values()].map((r) => ({ ...r, users: [...r.users] }));
    void inLobbyTurn(ban.setupId, () => (watched.has(messageId) ? ban.count(reactions) : Promise.resolve())).catch((error: unknown) =>
      log.warn('ban count so far not sent', ban.setupId, error),
    );
  }, COUNT_DELAY_MS);
  ban.timer.unref();
}
