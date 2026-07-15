export function* chunkByLength(s: string, maxLen: number): Generator<string> {
  if (maxLen <= 0) return;
  if (s.length <= maxLen) {
    yield s;
    return;
  }

  const lines = s.split("\n");
  let buf = "";

  for (const line of lines) {
    if (buf.length && (buf.length + line.length + 1) > maxLen) {
      yield buf;
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }

  if (buf) yield buf;
}