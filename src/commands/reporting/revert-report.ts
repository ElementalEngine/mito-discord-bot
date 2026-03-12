import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { config } from "../../config.js";
import { EMOJI_FAIL } from "../../config/constants.js";
import { revertMatch } from "../../services/reporting.service.js";
import { getPlayerListMessage } from "../../utils/convert-match-to-str.js";
import { logCommand } from "../../utils/log-command.js";

export const data = new SlashCommandBuilder()
  .setName("revert-report")
  .setDescription("Revert reporting a game.")
  .addStringOption((option) =>
    option
      .setName("match-id")
      .setDescription("ID of the match to finalize")
      .setRequired(true),
  );

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

function memberHasRole(interaction: ChatInputCommandInteraction, roleId: string): boolean {
  const member = interaction.member;
  if (!member || typeof member !== "object") return false;

  if ("roles" in member && Array.isArray((member as { roles: unknown }).roles)) {
    return (member as { roles: string[] }).roles.includes(roleId);
  }

  if ("roles" in member) {
    const roles = (member as { roles: unknown }).roles;
    if (roles && typeof roles === "object" && "cache" in roles) {
      const cache = (roles as { cache: { has: (id: string) => boolean } }).cache;
      return cache.has(roleId);
    }
  }

  return false;
}

async function safeDefer(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (e: unknown) {
    console.error("/approve-report deferReply failed:", e);
    return false;
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: `${EMOJI_FAIL} This command must be used in a server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await safeDefer(interaction))) return;

  const matchId = interaction.options.getString("match-id", true);
  await logCommand(interaction, 
    config.discord.channels.reportLogChannel,
    data.name,
    {
      matchId: matchId,
    }
  );

  try {
    if (!memberHasRole(interaction, config.discord.roles.developer)) {
      await interaction.editReply(`${EMOJI_FAIL} Only user with developer role can revert a report`);
      return;
    }

    const res = (await revertMatch(matchId));
    const playerList = getPlayerListMessage(res, "", "\t");

    await interaction.editReply(`Report is reverted successfully!`);
    await interaction.followUp({
      content: `Match reverted!\n**Match ID:** ${matchId}\n**Players:**\n${playerList}`,
    });

  } catch (err: unknown) {
    const msg = errorMessage(err);

    await interaction
      .editReply(`${EMOJI_FAIL} Match revert failed: ${msg}`)
      .then((repliedMessage) => {
        setTimeout(() => void repliedMessage.delete().catch(() => {}), 60_000);
      })
      .catch(() => {});
  }
}