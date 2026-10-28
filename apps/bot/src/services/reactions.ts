import type { SendableChannels } from 'discord.js';

import type { LobbyBallot } from '../api/types.js';
import { log } from '../utils/log.js';
import { inLobbyTurn } from './lobby.service.js';

export type Reaction = Readonly<{ id: string | null; name: string | null; users: readonly string[] }>;
export type Emoji = Readonly<{ id: string | null; name: string | null }>;
// A leader or civ as civ data names it: its portrait's name, its own, its civ.
type Named = Readonly<{ token: string; name: string; display?: string | null; civ_display?: string | null }>;

// Added by the bot beside a bans message's reactions, pointing at the add-reaction button.
export const BAN_HINT = '➡️';

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

// What came in on each watched message, by its setup, so a count needs no
// read. A restart, or a new session that may have missed some, reads Discord.
type Tracked = Map<string, { id: string | null; name: string | null; users: Set<string> }>;
type Watch = { count: (reactions: ReadonlyMap<string, Reaction[]>) => Promise<void>; messages: Map<string, Tracked>; timer?: NodeJS.Timeout };
const watches = new Map<string, Watch>();
const setupOf = new Map<string, string>();
const missed = new Set<string>();
const COUNT_DELAY_MS = 1_000;

const listed = (tracked: Tracked): Reaction[] => [...tracked.values()].map((r) => ({ ...r, users: [...r.users] }));

// Messages' reactions: a watched one's as they came in, any other read fresh
// from Discord, several in one read. Only reactions others added are read further.
export async function reactionsOn(place: SendableChannels, messageIds: readonly (string | undefined)[]): Promise<Map<string, Reaction[]>> {
  const ids = messageIds.filter((id): id is string => Boolean(id));
  const known = new Map<string, Reaction[]>();
  for (const id of ids) {
    const tracked = watches.get(setupOf.get(id) ?? '')?.messages.get(id);
    if (tracked && !missed.has(id) && place.messages.cache.has(id)) known.set(id, listed(tracked));
  }
  const unread = ids.filter((id) => !known.has(id));
  if (!unread.length) return known;
  const after = (unread.map((id) => BigInt(id)).reduce((a, b) => (a < b ? a : b)) - 1n).toString();
  const batch = unread.length > 1 ? await place.messages.fetch({ after, limit: 100 }).catch(() => null) : null;
  const messages = await Promise.all(unread.map(async (id) => batch?.get(id) ?? place.messages.fetch({ message: id, force: true }).catch(() => null)));
  const read = await Promise.all(
    messages.map(async (message) =>
      Promise.all(
        [...(message?.reactions.cache.values() ?? [])].map(async (reaction): Promise<Reaction> => {
          const users = reaction.count <= (reaction.me ? 1 : 0) ? [] : [...(await reaction.users.fetch()).keys()];
          return { id: reaction.emoji.id, name: reaction.emoji.name, users };
        }),
      ),
    ),
  );
  unread.forEach((id, i) => known.set(id, read[i] ?? []));
  return known;
}

// A setup's messages are watched as each is posted; a burst of reactions on
// any of them is counted once, a second after the last, in the setup's turn.
export function watchReactions(setupId: string, messageId: string, count: Watch['count']): void {
  const watch = watches.get(setupId) ?? { count, messages: new Map() };
  watch.count = count;
  watch.messages.set(messageId, new Map());
  watches.set(setupId, watch);
  setupOf.set(messageId, setupId);
}

export function unwatchReactions(messageIds: readonly (string | undefined)[]): void {
  for (const id of messageIds) {
    const watch = watches.get(setupOf.get(id ?? '') ?? '');
    if (!id || !watch) continue;
    watch.messages.delete(id);
    if (!watch.messages.size) {
      clearTimeout(watch.timer);
      watches.delete(setupOf.get(id) ?? '');
    }
    setupOf.delete(id);
    missed.delete(id);
  }
}

// A new gateway session may have missed reactions, so final counts read Discord.
export function distrustReactions(): void {
  for (const id of setupOf.keys()) missed.add(id);
}

export function trackReaction(messageId: string, emoji: Emoji, userId: string, added: boolean): void {
  const setupId = setupOf.get(messageId);
  const watch = watches.get(setupId ?? '');
  const tracked = watch?.messages.get(messageId);
  const key = emoji.id ?? emoji.name;
  if (!setupId || !watch || !tracked || !key) return;
  const reaction = tracked.get(key) ?? { id: emoji.id, name: emoji.name, users: new Set<string>() };
  if (added) reaction.users.add(userId);
  else reaction.users.delete(userId);
  tracked.set(key, reaction);
  clearTimeout(watch.timer);
  watch.timer = setTimeout(() => {
    void inLobbyTurn(setupId, async () => {
      if (watches.get(setupId) === watch) await watch.count(new Map([...watch.messages].map(([id, t]) => [id, listed(t)])));
    }).catch((error: unknown) => log.warn('reaction count so far not sent', setupId, error));
  }, COUNT_DELAY_MS);
  watch.timer.unref();
}
