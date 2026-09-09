/** Exact ADF references only: ambiguous filenames must remain standalone. */
export function referencedAttachmentIds(
  document: unknown,
  files: { id: string; externalId: string | null; filename: string }[],
): string[] {
  const result = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if ((node.type === "media" || node.type === "mediaInline") && node.attrs) {
      const matches = files.filter((f) => f.externalId === node.attrs!.id || f.filename === node.attrs!.alt);
      if (matches.length === 1) result.add(matches[0]!.id);
    }
    node.content?.forEach(visit);
  }
  visit(document);
  return [...result];
}
