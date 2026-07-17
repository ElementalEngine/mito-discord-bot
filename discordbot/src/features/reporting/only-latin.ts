export function isOnlyLatinCharacters(str: string): boolean {
  const regex = /^[\p{Script=Latin}0-9_!&.\s]+$/u;
  return regex.test(str);
}