/** Tracker's relative inline images; never interpret arbitrary remote URLs. */
export function trackerImages(text: string) {
  return [...text.matchAll(/!\[([^\]\n]*)\]\(\/ajax\/v2\/attachments\/(\d+)(?:\?[^\s)]*)?(?:\s+=(\d+)x(\d+))?\)/g)].map(match => ({
    markup: match[0], id: match[2]!, filename: match[1]!,
    width: match[3] ? Number(match[3]) : undefined,
    height: match[4] ? Number(match[4]) : undefined,
  }));
}
