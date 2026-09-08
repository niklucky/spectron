type FieldType = "text" | "date" | "number" | "user";
type Named = {
  id: string;
  name?: string;
  display?: string;
  key?: string;
  type?: string;
  schema?: { type?: string };
};
const aliases: Record<string, string[][]> = {
  statuses: [
    ["open", "todo", "to do", "открыт", "открыта", "открыто"],
    ["in progress", "inprogress", "в работе"],
    ["done", "resolved", "решен", "решена", "решено", "готово"],
    ["closed", "закрыт", "закрыта", "закрыто"],
    ["cancelled", "canceled", "отменен", "отменена", "отменено"],
  ],
  priorities: [
    ["blocker", "блокер", "блокирующий"],
    ["critical", "критический", "критичный"],
    ["high", "высокий", "важный"],
    ["normal", "medium", "средний", "нормальный"],
    ["low", "низкий"],
    ["minor", "незначительный"],
    ["trivial", "тривиальный"],
  ],
  fields: [
    ["start date", "startdate", "start", "дата начала"],
    ["due date", "duedate", "дедлайн", "срок исполнения"],
    ["end date", "enddate", "end", "дата окончания", "дата завершения"],
    ["original estimate", "originalestimation", "первоначальная оценка"],
    ["estimate", "estimation", "оценка"],
    ["story points", "storypoints", "стори поинты"],
  ],
};
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[_\-\s]+/g, " ")
    .trim();

export function trackerFieldType(field: Named): FieldType | undefined {
  const type = field.schema?.type ?? field.type;
  if (type === "string" || type === "text") return "text";
  if (type === "integer" || type === "float" || type === "number")
    return "number";
  if (type === "date") return "date";
  if (type === "user") return "user";
  return undefined;
}

/** Preserve explicit ignores and choices; suggest only unique, type-compatible pairs. */
export function matchTrackerMappings(
  kind: "statuses" | "priorities" | "fields",
  remote: Named[],
  local: Named[],
  existing: Record<string, string | null>,
) {
  const canonical = (value: string) => {
    const name = normalize(value);
    return aliases[kind]?.find((group) => group.includes(name))?.[0] ?? name;
  };
  const names = (item: Named) =>
    new Set(
      [item.name, item.display, item.key]
        .filter((s): s is string => !!s)
        .map(canonical),
    );
  const remotes = [...new Map(remote.map((r) => [r.id, r])).values()];
  const candidates = remotes.map((r) => ({
    remote: r,
    local: local.filter((l) => {
      if (
        kind === "fields" &&
        (!trackerFieldType(r) || trackerFieldType(r) !== l.type)
      )
        return false;
      const targets = names(l);
      return [...names(r)].some((n) => n && targets.has(n));
    }),
  }));
  const remoteIds = new Set(remotes.map((r) => r.id));
  const result = Object.fromEntries(
    Object.entries(existing).filter(([id]) => remoteIds.has(id)),
  );
  const used = new Set(Object.values(result));
  for (const pair of candidates) {
    if (Object.hasOwn(existing, pair.remote.id) || pair.local.length !== 1)
      continue;
    const id = pair.local[0]!.id;
    if (
      used.has(id) ||
      candidates.filter((p) => p.local.some((l) => l.id === id)).length !== 1
    )
      continue;
    result[pair.remote.id] = id;
    used.add(id);
  }
  return result;
}
