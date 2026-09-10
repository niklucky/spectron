/** Use a regional browser locale; English falls back to European conventions. */
export function dateLocale(languages: readonly string[]): string {
  return languages.find(language => !/^en(?:-US)?$/i.test(language)) ?? "en-GB";
}

export function formatDateTime(value: string | Date): string {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  return new Intl.DateTimeFormat(dateLocale(languages), {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
