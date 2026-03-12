import { ChatInputCommandInteraction, TextChannel } from "discord.js";

export async function logCommand(interaction: ChatInputCommandInteraction, logChannelID: string, commandName: string, additionalInfo: Record<string, unknown> = {}): Promise<void> {
  const baseInfo = {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    commandName,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
  };
  const logInfo = { ...baseInfo, ...additionalInfo };
  const logChannel = interaction.client.channels.cache.get(logChannelID);
  if (logChannel && logChannel.isTextBased()) {
    await (logChannel as TextChannel).send({ content: `Command executed: \`${commandName}\` by <@${interaction.user.id}> in <#${interaction.channelId}> with info: \`${JSON.stringify(logInfo)}\`` });
  } else {
    console.warn(`Log channel with ID ${logChannelID} not found or is not text-based. Log info:`, logInfo);
  }
}