import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';

import { ApiClient } from '../api/index.js';
import { trackBanReaction } from '../services/lobby-vote.service.js';

const api = new ApiClient();

export const name = Events.MessageReactionRemove;
export const once = false;

// A reaction taken back: counted at once when it is a ban on an open vote.
export function execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): void {
  if (!user.bot) trackBanReaction(reaction.client, reaction.message.id, reaction.emoji, user.id, false, api);
}
