import { REST } from "@discordjs/rest";
import { Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { Command } from "./types/global.js";
import { config } from "./config.js";
import { COMMAND_ACCESS } from "./config/command-access.js";
import { log } from './utils/log.js';

// Staff-only commands are hidden from everyone until Integrations grants a role.
export function payloadOf(commands: ReadonlyMap<string, Command>): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return Array.from(commands.values()).map((cmd) => {
    const json = cmd.data.toJSON();
    return COMMAND_ACCESS[json.name]?.staffOnly ? { ...json, default_member_permissions: '0' } : json;
  });
}

export async function deployCommands(
  commands: ReadonlyMap<string, Command>,
  guildId: string = config.discord.guildId
): Promise<void> {
  const payload = payloadOf(commands);
  if (payload.length === 0) {
    log.info("ℹ️ No commands to deploy.");
    return;
  }

  const { token, clientId } = config.discord;
  if (!token || !clientId || !guildId) {
    throw new Error("Missing discord token/clientId/guildId.");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  log.info(
    `🔄 Deploying ${payload.length} slash commands to guild ${guildId}...`
  );
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: payload,
    });
    log.info("✅ Commands deployed successfully");
  } catch (error: unknown) {
    const detail =
      typeof error === "object" && error !== null && "rawError" in error
        ? JSON.stringify((error as { rawError: unknown }).rawError)
        : String(error);
    log.error("❌ Failed to deploy commands:", detail);
    throw error;
  }
}