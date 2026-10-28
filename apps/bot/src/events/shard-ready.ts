import { Events } from 'discord.js';

import { distrustReactions } from '../services/reactions.js';

export const name = Events.ShardReady;
export const once = false;

// A new session may have missed reactions, so a vote's final count reads Discord.
export function execute(): void {
  distrustReactions();
}
