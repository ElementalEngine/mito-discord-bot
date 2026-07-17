import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { config } from "../../../core/config/index.js";
import { EMOJI_CONFIRM, EMOJI_FAIL, EMOJI_REPORT } from "../../../core/config/constants.js";
import { contestReport, getMatch } from "../service.js";
import { buildReportEmbed } from "../ui/reporting.embed.js";
import { deleteLater, safeDelete } from "../../../core/discord/index.js";
import { errorMessage } from "../../../core/errors.js";
import { logCommand } from "../../../core/discord/index.js";

import type { BaseReport } from "../types.js";
import { isOnlyLatinCharacters } from "../only-latin.js";

export const data = new SlashCommandBuilder()
  .setName("contest-report")
  .setDescription("Contest a report with a reason.")
  .addStringOption(option =>
    option.setName("match-id")
      .setDescription("ID of the match to change the order for")
      .setRequired(true),
  )
  .addStringOption(option =>
    option.setName("reason")
      .setDescription("The reason for contesting the report (max 100 characters)")
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: `${EMOJI_FAIL} This command must be used in a server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const matchId = interaction.options.getString("match-id", true) as string;
  const reason = interaction.options.getString("reason", true) as string;
  if (reason.length > 100) {
    await interaction.reply({
      content: `${EMOJI_FAIL} Reason is too long. Please keep it under 100 characters.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await logCommand(interaction, 
    config.discord.channels.reportLogChannel,
    data.name,
    {
      matchId: matchId,
      reason: reason,
    }
  );
  if (!isOnlyLatinCharacters(reason)) {
    await interaction.reply({
      content: `${EMOJI_FAIL} Reason has invalid characters. Please only include latin characters.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  let interactionReply: Awaited<ReturnType<typeof interaction.followUp>> | null = null;

  try {
    await interaction.editReply(`Processing contest report request...`);
    const getMatchRes = await getMatch(matchId);
    if (!interaction.inCachedGuild()) throw new Error('Not a cached guild');

    const contestReportMsg =
      `${EMOJI_REPORT} Processing contest report by <@${interaction.user.id}>\n` +
      `Match ID: **${matchId}** Reporter: <@${getMatchRes.reporter_discord_id}>\n`;
    interactionReply = await interaction.followUp({ content: contestReportMsg });
    const contestReportMsgId = interactionReply.id;

    const res = await contestReport(matchId, interaction.user.id, reason, contestReportMsgId);

    const confirmMsg =
      `${EMOJI_CONFIRM} Contest report by <@${interaction.user.id}> successfully applied\n` +
      `Match ID: **${matchId}** Reporter: <@${getMatchRes.reporter_discord_id}>\n` + 
      `Reason: ${reason}`;
    await interactionReply.edit(confirmMsg);

    const updatedEmbed = buildReportEmbed(res, {
      reporterId: interaction.user.id,
    });
    const embedMsgId = (res as BaseReport).discord_messages_id_list[0];
    if (embedMsgId && interaction.channel?.isTextBased()) {
      const message = await interaction.channel.messages.fetch(embedMsgId).catch(() => null);
      if (message) await message.edit({ embeds: [updatedEmbed] }).catch(() => undefined);
    }
    await interaction.editReply({ content: `${EMOJI_CONFIRM} Contest report successful!` });

  } catch (err: unknown) {
    if (interactionReply) await safeDelete(interactionReply);
    const msg = await interaction.editReply(`${EMOJI_FAIL} Contest report failed: ${errorMessage(err)}`).catch(() => null);
    if (msg) deleteLater(msg, 60_000);
  }
}