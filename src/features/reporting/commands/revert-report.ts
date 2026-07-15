import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { memberHasRole } from "../access.js";
import { error as logError } from "../../../core/logging.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { config } from "../../../core/config/index.js";
import { EMOJI_FAIL } from "../../../core/config/constants.js";
import { revertMatch } from "../service.js";
import { getPlayerListMessage } from "../format.js";
import { logCommand } from "../../../core/discord/index.js";
import { ApiError } from "../../../core/api/errors.js";

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
  if (err instanceof Error) return err.message + (err instanceof ApiError ? `: ${JSON.stringify(err.body)}` : "");
  return typeof err === "string" ? err : "Unknown error";
}


async function safeDefer(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return true;
  } catch (e: unknown) {
    logError("/revert-report deferReply failed:", e);
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
    if (!memberHasRole(interaction, config.discord.roles.admin) && !memberHasRole(interaction, config.discord.roles.developer)) {
      await interaction.editReply(`${EMOJI_FAIL} Only user with admin or developer role can revert a report`);
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