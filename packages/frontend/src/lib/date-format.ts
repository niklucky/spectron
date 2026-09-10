/** Use a regional browser locale; English falls back to European conventions. */
export function dateLocale(languages: readonly string[]): string {
  const preferred = languages[0];
  return !preferred || /^en(?:-US)?$/i.test(preferred) ? "en-GB" : preferred;
}

export function formatDateTime(value: string | Date): string {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  return new Intl.DateTimeFormat(dateLocale(languages), {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
