const ALL_CAPS_RE = /^(?:[IVX]+|[A-Z]{2,}|[A-Z]\d+)$/;

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (ALL_CAPS_RE.test(word)) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

export function humanizeGameId(value: string): string {
  const normalized = value
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return value;

  return normalized
    .split(' ')
    .filter(Boolean)
    .map(titleCaseWord)
    .join(' ');
}
