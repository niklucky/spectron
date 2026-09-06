import { load } from "cheerio";
import { fetchPublicFile, type FetchRemote } from "./safe-fetch";
import { normalizeLogo } from "./images";

export function iconCandidates(html: string, pageURL: string) {
  const $ = load(html);
  let base = pageURL;
  try {
    const href = $("base[href]").first().attr("href");
    if (href) base = new URL(href, pageURL).href;
  } catch {
    /* Use page URL. */
  }
  const icons: { url: string; priority: number }[] = [];
  $("link[href]").each((_, element) => {
    const rel = ($(element).attr("rel") || "").toLowerCase().split(/\s+/);
    if (
      !rel.includes("icon") &&
      !rel.includes("apple-touch-icon") &&
      !rel.includes("apple-touch-icon-precomposed")
    )
      return;
    try {
      const url = new URL($(element).attr("href")!, base);
      if (!["https:", "http:"].includes(url.protocol)) return;
      const size = Number.parseInt($(element).attr("sizes") || "0") || 0;
      icons.push({
        url: url.href,
        priority: (rel.includes("icon") ? 1000 : 0) + Math.min(size, 512),
      });
    } catch {
      /* Ignore invalid links. */
    }
  });
  return [
    ...new Set([
      ...icons
        .sort((a, b) => b.priority - a.priority)
        .map((item) => item.url)
        .slice(0, 5),
      new URL("/favicon.ico", pageURL).href,
    ]),
  ];
}

export async function discoverProjectLogo(
  url: string,
  fetcher: FetchRemote = fetchPublicFile,
): Promise<{ logo: string | null }> {
  const signal = AbortSignal.timeout(12_000);
  let candidates = [new URL("/favicon.ico", url).href];
  try {
    const page = await fetcher(url, signal);
    if (page.contentType.startsWith("image/"))
      return { logo: await normalizeLogo(page.body) };
    candidates = iconCandidates(page.body.toString("utf8"), page.url);
  } catch {
    /* An unavailable page can still have a root icon. */
  }
  for (const candidate of candidates) {
    if (signal.aborted) break;
    try {
      const icon = await fetcher(candidate, signal);
      return { logo: await normalizeLogo(icon.body) };
    } catch {
      /* Try the next declared icon, then the root fallback. */
    }
  }
  return { logo: null };
}
