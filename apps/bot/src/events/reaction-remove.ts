import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';

import { trackReaction } from '../services/reactions.js';

export const name = Events.MessageReactionRemove;
export const once = false;

// A reaction taken back: counted at once when it is on an open vote.
export function execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): void {
  if (!user.bot) trackReaction(reaction.message.id, reaction.emoji, user.id, false);
}
