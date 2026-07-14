import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from '../types/global.js';
import { error as logError, log as logInfo, warn as logWarn } from '../core/logging.js';

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

const ROOT = path.join(__dirname, '..');

async function importCommand(
  filePath: string,
  label: string
): Promise<Command | null> {
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
      logWarn(`⚠️ Skipping invalid command module: ${label}`);
      return null;
    }

    return {
      data: maybe.data as Command['data'],
      execute: maybe.execute as Command['execute'],
    };
  } catch (err) {
    logError(`❌ Failed to load command ${label}:`, err);
    return null;
  }
}

async function loadCommandDir(
  subdir: string,
  label: string,
  origins: Map<string, string>
): Promise<number> {
  let loaded = 0;
  for (const file of await readdir(subdir)) {
    if (!isLoadable(file)) continue;

    const filePath = path.join(subdir, file);
    const command = await importCommand(filePath, `${label}/${file}`);
    if (!command) continue;

    const name = command.data.name;
    const prior = origins.get(name);
    if (prior) {
      // Dual-scan window (R1–R9): the same command in legacy and a feature
      // slice is a migration error — fail fast rather than shadow silently.
      throw new Error(
        `Duplicate command "${name}" loaded from both ${prior} and ${filePath}`
      );
    }
    origins.set(name, filePath);

    client.commands.set(name, command);
    loaded++;
  }
  return loaded;
}

async function loadCommands(): Promise<number> {
  const origins = new Map<string, string>();
  let loaded = 0;

  // Legacy zone: <dist>/commands/<group>/* — required until R9 empties it.
  const legacyPath = path.join(ROOT, 'commands');
  if (!existsSync(legacyPath)) {
    throw new Error(`Commands folder not found at: ${legacyPath}`);
  }
  for (const dirent of await readdir(legacyPath, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    loaded += await loadCommandDir(
      path.join(legacyPath, dirent.name),
      dirent.name,
      origins
    );
  }

  // Feature slices: <dist>/features/<slice>/commands/* — tolerated absent (fills in R3).
  const featuresPath = path.join(ROOT, 'features');
  if (existsSync(featuresPath)) {
    for (const dirent of await readdir(featuresPath, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const sliceCommands = path.join(featuresPath, dirent.name, 'commands');
      if (!existsSync(sliceCommands)) continue;
      loaded += await loadCommandDir(
        sliceCommands,
        `features/${dirent.name}`,
        origins
      );
    }
  }

  return loaded;
}

async function loadEvents(): Promise<number> {
  const eventsPath = path.join(ROOT, 'app', 'events');
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
        logWarn(`⚠️ Skipping invalid event module: ${file}`);
        continue;
      }

      const once = maybe.once === true;
      if (once) client.once(maybe.name as never, maybe.execute as never);
      else client.on(maybe.name as never, maybe.execute as never);

      loaded++;
    } catch (err) {
      logError(`❌ Failed to load event ${file}:`, err);
    }
  }

  return loaded;
}

export async function initClient(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const [commands, events] = await Promise.all([loadCommands(), loadEvents()]);
      logInfo(
        `✅ Loaded ${commands} commands and ${events} events (${RUNTIME_EXT})`
      );
    })();
  }

  return initPromise;
}

export default client;
