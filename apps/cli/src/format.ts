/** Response shapes from /api/v1 that the text output reads (docs/api.md). */
export type Named = { id: string; name: string };
export type Person = { id: string; name: string; email: string | null };
export type Project = { id: string; key: string; name: string; state?: string; role?: string };
export type Issue = {
  id: string;
  key: string;
  jiraKey: string | null;
  project: { id: string; key: string };
  title: string;
  description?: string;
  status: Named & { category: string };
  priority: Named | null;
  type: Named | null;
  assignee: Person | null;
  author: Person | null;
  parent: { id: string; key: string } | null;
  tags?: string[];
  fields?: Record<string, unknown>;
  startAt: string | null;
  dueAt: string | null;
  estimateSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};
export type StoredFile = { id: string; filename: string; contentType: string; sizeBytes: number; createdAt: string; url: string };
export type Comment = {
  id: string;
  parentId: string | null;
  author: { id: string; name: string };
  body: string;
  mentions: Named[];
  attachments: StoredFile[];
  replyCount: number;
  createdAt: string;
  deletedAt: string | null;
};
export type ProjectDetail = Project & {
  statuses: (Named & { category: string; isDefault: boolean })[];
  priorities: Named[];
  types: Named[];
  tags: Named[];
  fields: (Named & { type: string })[];
  members: Person[];
};

export const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");
const minute = (value: string) => value.slice(0, 16).replace("T", " ");

export function duration(seconds: number | null) {
  if (seconds === null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(" ") || "0m";
}

/** `1h30m`, `90m`, `2h`, `45s`, or a bare number of seconds. */
export function parseDuration(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i.exec(value.trim());
  if (!match || !value.trim() || !(match[1] || match[2] || match[3])) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Aligned columns; the last column is cut to the terminal width when known. */
export function table(headers: string[], rows: string[][], width?: number) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((row) => (row[i] ?? "").length)));
  return all
    .map((row) => {
      const line = row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!)))
        .join("  ")
        .trimEnd();
      return width && line.length > width ? `${line.slice(0, Math.max(width - 1, 0))}…` : line;
    })
    .join("\n");
}

export function issueTable(issues: Issue[], width?: number) {
  return table(
    ["KEY", "STATUS", "ASSIGNEE", "DUE", "TITLE"],
    issues.map((i) => [i.key, i.status.name, i.assignee?.name ?? "", day(i.dueAt), i.title]),
    width,
  );
}

export function issueDetail(issue: Issue) {
  const facts = (pairs: [string, string | null | undefined][]) =>
    pairs
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`)
      .join(" · ");
  const lines = [
    `${issue.key}  ${issue.title}`,
    facts([
      ["Status", issue.status.name],
      ["Priority", issue.priority?.name],
      ["Type", issue.type?.name],
    ]),
    facts([
      ["Assignee", issue.assignee && personLabel(issue.assignee)],
      ["Author", issue.author?.name],
    ]),
    facts([
      ["Parent", issue.parent?.key],
      ["Tags", issue.tags?.join(", ")],
    ]),
    facts([
      ["Start", day(issue.startAt)],
      ["Due", day(issue.dueAt)],
      ["Estimate", duration(issue.estimateSeconds)],
    ]),
    facts([
      ["Created", day(issue.createdAt)],
      ["Updated", minute(issue.updatedAt)],
      ["Jira", issue.jiraKey],
    ]),
    issue.url,
  ].filter(Boolean);
  const custom = Object.entries(issue.fields ?? {}).filter(([, value]) => value !== null && value !== "");
  if (custom.length)
    lines.push("", ...custom.map(([name, value]) => `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`));
  if (issue.description?.trim()) lines.push("", issue.description.trimEnd());
  return lines.join("\n");
}

export const personLabel = (p: Person) => (p.email ? `${p.name} <${p.email}>` : p.name);

/** Mentions read as @Name in text output; --json keeps `<@member-id>`. */
export function commentText(comment: Comment) {
  const names = new Map(comment.mentions.map((m) => [m.id, m.name]));
  const body = comment.deletedAt
    ? "(deleted)"
    : comment.body.replace(/<@([^<>\s]+)>/g, (whole, id: string) => (names.has(id) ? `@${names.get(id)}` : whole));
  const replies = comment.replyCount ? ` · ${comment.replyCount} ${comment.replyCount === 1 ? "reply" : "replies"}` : "";
  return [
    `${comment.author.name} · ${minute(comment.createdAt)} · ${comment.id}${replies}`,
    ...(body ? [indent(body)] : []),
    ...comment.attachments.map((f) => `  Attachment: ${f.filename} (${size(f.sizeBytes)}) ${f.id}`),
  ].join("\n");
}

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

export function fileTable(files: StoredFile[], width?: number) {
  return table(
    ["ID", "SIZE", "ADDED", "NAME"],
    files.map((f) => [f.id, size(f.sizeBytes), day(f.createdAt), f.filename]),
    width,
  );
}

export function projectDetail(p: ProjectDetail) {
  const list = (label: string, items: string[]) => (items.length ? [`${label}: ${items.join(", ")}`] : []);
  return [
    `${p.key}  ${p.name}`,
    ...list(
      "Statuses",
      p.statuses.map((s) => `${s.name} (${s.category}${s.isDefault ? ", default" : ""})`),
    ),
    ...list("Priorities", p.priorities.map((x) => x.name)),
    ...list("Types", p.types.map((x) => x.name)),
    ...list("Tags", p.tags.map((x) => x.name)),
    ...list("Custom fields", p.fields.map((f) => `${f.name} (${f.type})`)),
    ...(p.members.length ? ["", "Members:", ...p.members.map((m) => `  ${personLabel(m)}  ${m.id}`)] : []),
  ].join("\n");
}
