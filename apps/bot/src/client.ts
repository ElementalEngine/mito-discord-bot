import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from './types/global.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection<string, Command>();

const RUNTIME_EXT = path.extname(__filename) === '.ts' ? '.ts' : '.js';

const isLoadable = (f: string) =>
  f.endsWith(RUNTIME_EXT) && !f.endsWith('.d.ts') && !f.endsWith('.map');

let initPromise: Promise<void> | null = null;

async function loadCommands(): Promise<number> {
  const commandsPath = path.join(__dirname, 'commands');
  if (!existsSync(commandsPath)) {
    throw new Error(`Commands folder not found at: ${commandsPath}`);
  }

  let loaded = 0;

  for (const dirent of await readdir(commandsPath, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;

    const subdir = path.join(commandsPath, dirent.name);
    for (const file of await readdir(subdir)) {
      if (!isLoadable(file)) continue;

      const filePath = path.join(subdir, file);
      try {
        const mod = (await import(pathToFileURL(filePath).href)) as unknown;
        const maybe = mod as Partial<Command> & { data?: { name?: unknown } };

        if (
          !maybe ||
          typeof maybe !== 'object' ||
          typeof maybe.execute !== 'function' ||
          !maybe.data ||
          typeof maybe.data.name !== 'string'
        ) {
          console.warn(
            `⚠️ Skipping invalid command module: ${dirent.name}/${file}`
          );
          continue;
        }

        client.commands.set(maybe.data.name, {
          data: maybe.data as Command['data'],
          execute: maybe.execute as Command['execute'],
        });
        loaded++;
      } catch (err) {
        console.error(`❌ Failed to load command ${dirent.name}/${file}:`, err);
      }
    }
  }

  return loaded;
}

async function loadEvents(): Promise<number> {
  const eventsPath = path.join(__dirname, 'events');
  if (!existsSync(eventsPath)) {
    throw new Error(`Events folder not found at: ${eventsPath}`);
  }

  let loaded = 0;

  for (const file of await readdir(eventsPath)) {
    if (!isLoadable(file)) continue;

    const filePath = path.join(eventsPath, file);
    try {
      const mod = (await import(pathToFileURL(filePath).href)) as unknown;
      const maybe = mod as {
        name?: unknown;
        once?: unknown;
        execute?: unknown;
      };

      if (
        !maybe ||
        typeof maybe !== 'object' ||
        typeof maybe.name !== 'string' ||
        typeof maybe.execute !== 'function'
      ) {
        console.warn(`⚠️ Skipping invalid event module: ${file}`);
        continue;
      }

      const once = maybe.once === true;
      if (once) client.once(maybe.name as never, maybe.execute as never);
      else client.on(maybe.name as never, maybe.execute as never);

      loaded++;
    } catch (err) {
      console.error(`❌ Failed to load event ${file}:`, err);
    }
  }

  return loaded;
}

export async function initClient(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const [commands, events] = await Promise.all([loadCommands(), loadEvents()]);
      console.log(
        `✅ Loaded ${commands} commands and ${events} events (${RUNTIME_EXT})`
      );
    })();
  }

  return initPromise;
}

export default client;
