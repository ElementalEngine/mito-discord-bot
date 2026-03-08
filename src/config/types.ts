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
}>;

export type DraftModeId = 'standard' | 'snake' | 'random' | 'cwc' | 'blind';

export type GameVoteConfig = Readonly<{
  questions: readonly VoteQuestion[];
}>;
