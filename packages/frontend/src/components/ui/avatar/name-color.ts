/** Stable across sessions, scripts and theme changes. */
export function nameHue(name: string): number {
  let hash = 0;
  for (const letter of name.normalize('NFKC').trim().toLowerCase()) {
    hash = (Math.imul(hash, 31) + letter.codePointAt(0)!) | 0;
  }
  return ((hash % 360) + 360) % 360;
}
