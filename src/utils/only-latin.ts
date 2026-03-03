export function isOnlyLatinCharacters(str: string): boolean {
  // Regex explanation:
  // ^      - Start of the string
  // []     - Character set
  // \\p{L} - Matches any character in the latin alphabet (both uppercase and lowercase)
  // 0-9    - Matches digits
  // _!&.\\s - Matches underscore, slash, plus, exclamation, ampersand, dot, and whitespace
  // +      - Matches one or more of the preceding characters
  // $      - End of the string
  // u      - Enables Unicode property escapes (required for \\p{})
  const regex = /^[\p{L}0-9_!&.\s]+$/u;
  console.log(str, regex.test(str));
  return regex.test(str);
}