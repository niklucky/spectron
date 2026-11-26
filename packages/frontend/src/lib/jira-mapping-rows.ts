type MappingRow = { id: string; name: string };

/** Keep provider order independent of which rows have been mapped. */
export function jiraMappingRows(
  available: readonly MappingRow[],
  savedIds: readonly string[],
): MappingRow[] {
  const rows = new Map(available.map((row) => [row.id, row]));
  // Retain saved options that Jira no longer returns, without moving known rows.
  for (const id of savedIds) {
    if (!rows.has(id)) rows.set(id, { id, name: id });
  }
  return [...rows.values()];
}

/** Build the occupied set once per section. Existing assignments stay editable. */
export function availableMappingOptions(mappings: Record<string, string | null> = {}) {
  const occupied = new Set(Object.values(mappings));
  return (options: readonly MappingRow[], current: string) =>
    options.filter(option => option.id === current || !occupied.has(option.id));
}
