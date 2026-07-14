const TIE_RE = /^tie$/i;
const MENTION_RE = /^<@!?(\d{17,20})>$/;

function tokenToDiscordId(token: string): string {
  const m = token.match(MENTION_RE);
  return m ? m[1] : token;
}

export function normalizePlayerList(playerOrder: string): string {
  return playerOrder
    .trim()
    .split(/\s+|<|>/)
    .filter((token) => token.length > 0)
    .map((token) => (token.startsWith('@') ? token.substring(1) : token))
    .map((token) => {
      if (TIE_RE.test(token)) return 'TIE';
      return tokenToDiscordId(token);
    })
    .join(' ');
}
