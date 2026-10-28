import type { Client, Message, SendableChannels } from 'discord.js';

import type { Lobby, Vote } from '../api/types.js';
import { deleteMessages, refuse } from '../ui/reply.js';
import { dropDeadline } from './deadlines.js';
import { unwatchReactions } from './reactions.js';

// What a lobby's bans vote and a /vote share: their messages and blind picks.
type Setup = Lobby | Vote;

export async function sendableIn(client: Client, id: string | null | undefined): Promise<SendableChannels | null> {
  const channel = id ? await client.channels.fetch(id).catch(() => null) : null;
  return channel?.isSendable() ? channel : null;
}

// A posted message recorded on its setup; one that cannot be is deleted.
export async function recorded<T>(posted: Message, record: () => Promise<T>): Promise<T> {
  try {
    return await record();
  } catch (error) {
    await posted.delete().catch(() => undefined);
    throw error;
  }
}

// A setup's vote or blind-pick messages deleted, no longer watched or timed.
export async function closeMessages(client: Client, setupId: string, channelId: string | null | undefined, ids: readonly string[]): Promise<void> {
  dropDeadline(setupId);
  unwatchReactions(ids);
  const place = await sendableIn(client, channelId);
  if (place) await deleteMessages(place, ids);
}

export const allFinished = (setup: Setup): boolean => setup.players.every((p) => setup.vote?.finished.includes(p.discord_id));

export const allPicked = (setup: Setup): boolean => setup.pools.every((pool) => setup.picks.some((p) => p.player_id === pool.player_id));

// A setup still taking blind picks, and this player one of its pickers.
export function pickingBy<T extends Setup>(setup: T, playerId: string, noun: 'lobby' | 'vote'): T {
  if (setup.status !== 'open' || setup.phase !== 'picking') refuse('The blind picks are closed.');
  if (!setup.pools.some((p) => p.player_id === playerId)) refuse(`Only the ${noun}'s players pick.`);
  return setup;
}
