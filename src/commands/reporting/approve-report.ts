import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { config } from "../../config.js";
import { EMOJI_FAIL } from "../../config/constants.js";
import { approveMatch } from "../../services/reporting.service.js";
import { updateRankRolesForApprovedMatch } from "../../services/rank-role.service.js";
import { buildReportEmbed } from "../../ui/report.layout.js";
import { getPlayerListMessage } from "../../utils/convert-match-to-str.js";

import type { BaseReport } from "../../types/reports.js";

export const data = new SlashCommandBuilder()
  .setName("approve-report")
  .setDescription("Finalizes reporting a game.")
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

function getHistoryChannelId(channelId: string): string | null {
  const map: Record<string, string> = {
    [config.discord.channels.civ6realtimeUploads]:
      config.discord.channels.civ6realtimeReportingHistory,
    [config.discord.channels.civ6cloudUploads]:
      config.discord.channels.civ6cloudReportingHistory,
    [config.discord.channels.civ7realtimeUploads]:
      config.discord.channels.civ7realtimeReportingHistory,
    [config.discord.channels.civ7cloudUploads]:
      config.discord.channels.civ7cloudReportingHistory,
  };

  return map[channelId] ?? null;
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

  try {
    if (!memberHasRole(interaction, config.discord.roles.moderator)) {
      await interaction.editReply(`${EMOJI_FAIL} Only a moderator can approve a report`);
      return;
    }

    const historyChannelId = getHistoryChannelId(interaction.channelId);
    if (!historyChannelId) {
      await interaction.editReply(
        `${EMOJI_FAIL} This command can only be used in the designated reporting channels.`,
      );
      return;
    }

    const historyChannel = interaction.guild?.channels.cache.get(historyChannelId);
    if (!historyChannel || !historyChannel.isTextBased()) {
      await interaction.editReply(
        `${EMOJI_FAIL} History channel ${historyChannelId} not found or is not text-based.`,
      );
      return;
    }

    const res = (await approveMatch(matchId, interaction.user.id)) as BaseReport;

    const playerList = getPlayerListMessage(res, "", "\t");
    const embed = buildReportEmbed(res, {
      approverId: interaction.user.id,
      isFinal: true,
    });

    await historyChannel.send({ content: playerList, embeds: [embed] });

    // Best-effort cleanup of old report messages
    const ids = res.discord_messages_id_list ?? [];
    for (const messageId of ids) {
      try {
        const message = await interaction.channel?.messages.fetch(messageId);
        if (message) await message.delete();
      } catch {
        console.log(`Failed to delete message id ${messageId} for match ${matchId}`);
      }
    }

    await interaction.editReply(`Report is approved successfully!`);

    // Rank roles (best-effort; idempotent; bounded concurrency)
    const affected = res.affected_players;
    const guild = interaction.guild;
    if (guild && affected && affected.length > 0) {
      await updateRankRolesForApprovedMatch(guild, affected);
    }
  } catch (err: unknown) {
    const msg = errorMessage(err);

    await interaction
      .editReply(`${EMOJI_FAIL} Match approval failed: ${msg}`)
      .then((repliedMessage) => {
        setTimeout(() => void repliedMessage.delete().catch(() => {}), 60_000);
      })
      .catch(() => {});
  }
}