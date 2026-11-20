import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';

import { isOutsider, trackReaction } from '../services/reactions.js';
import { isUnknownMessage } from '../ui/reply.js';
import { log } from '../utils/log.js';

export const name = Events.MessageReactionAdd;
export const once = false;

// Long enough for a member not in the vote to see their reaction go.
const OUTSIDER_DELAY_MS = 2_000;

// A reaction added: counted a moment later when it is on an open vote, or
// taken off then when the member is not voting in it.
export function execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): void {
  if (user.bot) return;
  if (!isOutsider(reaction.message.id, user.id)) {
    trackReaction(reaction.message.id, reaction.emoji, user.id, true);
    return;
  }
  setTimeout(() => {
    reaction.users.remove(user.id).catch((error: unknown) => {
      if (!isUnknownMessage(error)) log.warn('reaction not removed', reaction.message.id, error instanceof Error ? error.message : error);
    });
  }, OUTSIDER_DELAY_MS).unref();
}
