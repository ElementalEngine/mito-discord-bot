import type { EmbedBuilder } from 'discord.js';

export type DraftModeOutput = Readonly<{
  content?: string;
  embeds?: readonly EmbedBuilder[];
  allowedMentions?: Readonly<{ parse: readonly [] }>;
}>;

export type BlindDraftAssignment = Readonly<{
  voterId: string;
  leaders: readonly string[];
  civs?: readonly string[];
}>;

export type BlindDraftLaunch =
  | Readonly<{ ok: true; assignments: readonly BlindDraftAssignment[] }>
  | Readonly<{ ok: false; message: string }>;
