import { LIMITS } from './limits.js';

// Every button and menu id is `surface:verb[:arg...]`. The id carries all the
// state a press needs, so a button still works after a restart.
export type ParsedId = Readonly<{ surface: string; verb: string; args: readonly string[] }>;

const PART = /^[A-Za-z0-9_-]+$/;

export function customId(surface: string, verb: string, ...args: string[]): string {
  const parts = [surface, verb, ...args];
  for (const part of parts) {
    if (!PART.test(part)) throw new Error(`custom id part ${JSON.stringify(part)} is not [A-Za-z0-9_-]+`);
  }
  const id = parts.join(':');
  if (id.length > LIMITS.customId) throw new Error(`custom id over ${LIMITS.customId} characters: ${id}`);
  return id;
}

export function parseId(id: string): ParsedId | null {
  const [surface, verb, ...args] = id.split(':');
  if (!surface || !verb) return null;
  return { surface, verb, args };
}
