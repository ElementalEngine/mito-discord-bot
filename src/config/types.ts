import type { DraftMode } from '../types/drafting.types.js';

export type CivEdition = 'CIV6' | 'CIV7';

export type VoteEmoji = string;

export type VoteOption = Readonly<{
  id: string;
  label: string;
  emoji?: VoteEmoji;
}>;

export type VoteQuestion = Readonly<{
  id: string;
  title: string;
  options: readonly VoteOption[];
  defaultOptionId: string;
  maxSelections?: number;
}>;

export type DraftModeId = DraftMode;

export type GameVoteConfig = Readonly<{
  questions: readonly VoteQuestion[];
}>;
