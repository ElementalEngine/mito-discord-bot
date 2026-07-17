import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import type { Command } from "../types/global.js";
import { config } from "../core/config/index.js";
import { error as logError, log as logInfo } from '../core/logging.js';

export async function deployCommands(
  commands: ReadonlyMap<string, Command>,
  guildId: string = config.discord.guildId
): Promise<void> {
  const payload = Array.from(commands.values()).map((cmd) => cmd.data.toJSON());
  if (payload.length === 0) {
    logInfo("ℹ️ No commands to deploy.");
    return;
  }

  const { token, clientId } = config.discord;
  if (!token || !clientId || !guildId) {
    throw new Error("Missing discord token/clientId/guildId.");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  logInfo(
    `🔄 Deploying ${payload.length} slash commands to guild ${guildId}...`
  );
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: payload,
    });
    logInfo("✅ Commands deployed successfully");
  } catch (error: unknown) {
    const detail =
      typeof error === "object" && error !== null && "rawError" in error
        ? JSON.stringify((error as { rawError: unknown }).rawError)
        : String(error);
    logError("❌ Failed to deploy commands:", detail);
    throw error;
  }
}
