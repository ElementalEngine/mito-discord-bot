import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';

import { config } from '../../../core/config/index.js';
import { replyEphemeral } from '../../../core/discord/index.js';
import { getActivityBridge } from '../../../core/activity-bridge.js';
import { error as logError } from '../../../core/logging.js';

/**
 * /launch-activity (R6.4) — dev-guild-gated launch bridge. Creates a session with the
 * launching user as HOST and replies (ephemeral) with a URL that opens the Activity page
 * already authenticated as the host. Thin slice of R9: just enough to open the flow from
 * Discord. Gated to the activity dev-guild allowlist (config.activity.devGuildIds).
 */

export const data = new SlashCommandBuilder()
  .setName('launch-activity')
  .setDescription('Launch an Activity draft session (dev).')
  .addStringOption((opt) =>
    opt
      .setName('game-type')
      .setDescription('FFA, Teamer, or Duel')
      .setRequired(true)
      .addChoices(
        { name: 'FFA', value: 'FFA' },
        { name: 'Teamer', value: 'Teamer' },
        { name: 'Duel', value: 'Duel' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('draft-mode')
      .setDescription('standard, snake, blind, or cwc')
      .setRequired(true)
      .addChoices(
        { name: 'standard', value: 'standard' },
        { name: 'snake', value: 'snake' },
        { name: 'blind', value: 'blind' },
        { name: 'cwc', value: 'cwc' },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName('edition')
      .setDescription('CIV6 or CIV7 (default CIV6)')
      .setRequired(false)
      .addChoices({ name: 'CIV6', value: 'CIV6' }, { name: 'CIV7', value: 'CIV7' }),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Dev-guild gate: only allowed guilds may launch (empty allowlist ⇒ disabled).
    const guildId = interaction.guildId ?? '';
    const allowed = config.activity.devGuildIds;
    if (allowed.length === 0 || !allowed.includes(guildId)) {
      await replyEphemeral(interaction, 'Activity launch is not enabled in this server.');
      return;
    }

    const bridge = getActivityBridge();
    if (!bridge) {
      await replyEphemeral(interaction, 'The Activity server is not running.');
      return;
    }

    const result = bridge.launch({
      guildId,
      hostUserId: interaction.user.id,
      edition: interaction.options.getString('edition') ?? 'CIV6',
      gameType: interaction.options.getString('game-type', true),
      draftMode: interaction.options.getString('draft-mode', true),
    });

    if (!result) {
      await replyEphemeral(interaction, 'Could not build a launch link (ACTIVITY_PUBLIC_URL not set).');
      return;
    }

    await replyEphemeral(
      interaction,
      `🎮 Activity session created — you are the host.\nOpen: ${result.url}`,
    );
  } catch (err) {
    logError('[activity] /launch-activity failed', err);
    await replyEphemeral(interaction, 'Launch failed due to an unexpected error.');
  }
}
