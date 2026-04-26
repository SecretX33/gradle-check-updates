export type Token = { kind: "num"; value: number } | { kind: "qual"; value: string };

const SEPARATOR = /[-._+]/;

export function tokenize(version: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < version.length) {
    const ch = version[i]!;
    if (SEPARATOR.test(ch)) {
      i++;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < version.length && /\d/.test(version[j]!)) j++;
      out.push({ kind: "num", value: Number(version.slice(i, j)) });
      i = j;
    } else {
      let j = i;
      while (
        j < version.length &&
        !/\d/.test(version[j]!) &&
        !SEPARATOR.test(version[j]!)
      )
        j++;
      out.push({ kind: "qual", value: version.slice(i, j).toLowerCase() });
      i = j;
    }
  }
  return out;
}
