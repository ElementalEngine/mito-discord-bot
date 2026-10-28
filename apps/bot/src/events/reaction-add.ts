import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';

import { trackBanReaction } from '../services/reactions.js';

export const name = Events.MessageReactionAdd;
export const once = false;

// A reaction added: counted at once when it is a ban on an open vote.
export function execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): void {
  if (!user.bot) trackBanReaction(reaction.message.id, reaction.emoji, user.id, true);
}
