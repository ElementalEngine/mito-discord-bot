import type { Interaction } from 'discord.js';

import { Refusal } from './reply.js';

// A read before a form opens must beat Discord's 3 second window, counted from
// the press itself, so a slow league server is said plainly, not left to time out.
export async function beforeForm<T>(interaction: Interaction, read: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const left = Math.max(0, interaction.createdTimestamp + 2_500 - Date.now());
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Refusal('The league server is slow right now. Try again in a moment.')), left);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}
