import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';

import { isOutsider, trackReaction } from '../services/reactions.js';

export const name = Events.MessageReactionRemove;
export const once = false;

// A reaction taken back: counted a moment later when it is on an open vote.
// A non-voter's, taken off by the bot, was never counted.
export function execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): void {
  if (!user.bot && !isOutsider(reaction.message.id, user.id)) trackReaction(reaction.message.id, reaction.emoji, user.id, false);
}
