/** T3's preview loads custom protocols as pages instead of dispatching to the OS. */
export function isT3Preview(userAgent: string) {
  return /\bT3Code(?:\([^)]*\))?\//i.test(userAgent);
}
