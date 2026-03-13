import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function buildSecretVoteButtons(
  voteId: string,
  voterId: string
): ActionRowBuilder<ButtonBuilder> {
  const yes = new ButtonBuilder()
    .setCustomId(`sv:${voteId}:${voterId}:YES`)
    .setLabel('YES')
    .setStyle(ButtonStyle.Success);

  const no = new ButtonBuilder()
    .setCustomId(`sv:${voteId}:${voterId}:NO`)
    .setLabel('NO')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(yes, no);
}
