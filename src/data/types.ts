export type AgePool = 'Antiquity_Age' | 'Exploration_Age' | 'Modern_Age';
export type Civ7StartingAge = AgePool | 'None';

export type LeaderType =
  | 'Industrial'
  | 'War'
  | 'Naval'
  | 'Culture'
  | 'Religious'
  | 'Science'
  | 'None';

export type LeaderMeta = Readonly<{
  gameId: string;
  emojiId?: string;
  type: LeaderType;
}>;

export type CivMeta = Readonly<{
  gameId: string;
  emojiId?: string;
  agePool: AgePool;
}>;

export type Civ6LeaderKey = keyof typeof import('./civ6.data.js').CIV6_LEADERS;
export type Civ7LeaderKey = keyof typeof import('./civ7.data.js').CIV7_LEADERS;
export type Civ7CivKey = keyof typeof import('./civ7.data.js').CIV7_CIVS;