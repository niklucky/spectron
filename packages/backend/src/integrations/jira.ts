import { ISSUE_TITLE_MAX_LENGTH, ISSUE_DESCRIPTION_MAX_LENGTH } from "@spectron/shared";
import { exportWorklog } from "./export-worklogs";
import { historyChanges } from "../history-changes";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, eq, isNull, or, lt, sql } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
import {
  builtInIssueField,
  issueTimestamp,
  validateIssueTiming,
  createId,
  matchJiraStatuses,
  commentText,
  type JiraConfigInput,
  type JiraMappings,
  type FieldValues,
} from "@spectron/shared";
import { importBuiltIn, exportBuiltIn } from "./jira-fields";
import { issueAccess, IssueInputError, IssueConflictError, issueTagIds, setIssueTags } from "../issues";
import { validateFieldValues } from "../fields";
import type { FileService } from "../files";
import {
  JiraClient,
  JiraApiError,
  adfToText,
  textToAdf,
  type JiraIssue,
  type JiraUser,
} from "./jira-client";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = typeof s.jiraIntegration.$inferSelect;
type RecordRow = typeof s.integrationRecord.$inferSelect;
const emptyMappings = (): JiraMappings => ({
  statuses: {},
  priorities: {},
  fields: {},
  users: {},
});
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
function key(secret?: string) {
  if (!secret || secret.length < 32)
    throw new IssueInputError(
      "Configure INTEGRATION_SECRET (at least 32 characters) on the API server.",
    );
  return createHash("sha256").update(`spectron:jira:${secret}`).digest();
}
export function encryptToken(token: string, secret?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  return Buffer.concat([
    iv,
    cipher.update(token, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function decryptToken(value: string, secret?: string) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    cipher.update(data.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
const publicConnection = (c: Connection) => ({
  createdAt: c.createdAt.toISOString(),
  id: c.id,
  scheduleMinutes: c.scheduleMinutes,
  nextImportAt: c.nextImportAt?.toISOString() ?? null,
  lastScheduledAt: c.lastScheduledAt?.toISOString() ?? null,
  lastScheduleResult: c.lastScheduleResult,
  importRunId: c.importRunId,
  importCancelled: c.importCancelled,
  baseUrl: c.baseUrl,
  projectKey: c.projectKey,
  email: c.email,
  issueTypeId: c.issueTypeId,
  mappings: c.mappings,
  lastImportedAt: c.lastImportedAt?.toISOString() ?? null,
});
const localIssue = (row: typeof s.issue.$inferSelect, tagIds: string[] = []) => ({
  issueTypeId: row.issueTypeId ?? null,
  tagIds: [...tagIds].sort(),
  estimateTime: row.estimateTime,
  startAt: issueTimestamp(row.startAt),
  finishAt: issueTimestamp(row.finishAt),
  title: row.title,
  description: row.description,
  stateId: row.stateId,
  priorityId: row.priorityId,
  assigneeId: row.assigneeId ?? row.externalAssigneeId,
  fieldValues: row.fieldValues,
});
function remoteIssue(row: JiraIssue, mappings: JiraMappings) {
  const f = row.fields;
  return {
    ...(Object.keys(mappings.issueTypes ?? {}).length ? { issuetype: (f.issuetype as { id?: string } | undefined)?.id ?? null } : {}),
    summary: f.summary ?? "",
    description: f.description ?? null,
    status: f.status?.id ?? null,
    priority: f.priority?.id ?? null,
    assignee: f.assignee?.accountId ?? null,
    ...Object.fromEntries(
      Object.keys(mappings.fields)
        .filter((id) => mappings.fields[id])
        .map((id) => [id, f[id] ?? null]),
    ),
  };
}
function reverse(
  map: Record<string, string | null>,
  value: string,
  label: string,
) {
  const matches = Object.entries(map).filter(([, v]) => v === value);
  if (matches.length !== 1)
    throw new IssueInputError(
      `Map exactly one Jira ${label} to this local value before sending.`,
    );
  return matches[0]![0];
}
async function record(
  tx: Tx | Database,
  integrationId: string,
  kind: RecordRow["kind"],
  field: "localId" | "externalId",
  id: string,
) {
  return (
    await tx
      .select()
      .from(s.integrationRecord)
      .where(
        and(
          eq(s.integrationRecord.integrationId, integrationId),
          eq(s.integrationRecord.kind, kind),
          eq(s.integrationRecord[field], id),
        ),
      )
  )[0];
}
async function remember(
  tx: Tx | Database,
  c: Connection,
  kind: RecordRow["kind"],
  localId: string,
  externalId: string,
  local: unknown,
  remote: unknown,
) {
  const values = {
    externalId,
    localHash: stable(local),
    remoteHash: stable(remote),
    pendingCreate: false,
  };
  await tx
    .insert(s.integrationRecord)
    .values({ integrationId: c.id, kind, localId, ...values })
    .onConflictDoUpdate({
      target: [
        s.integrationRecord.integrationId,
        s.integrationRecord.kind,
        s.integrationRecord.localId,
      ],
      set: values,
    });
}
export function shouldImport(
  rec: RecordRow | undefined,
  local: unknown,
  remote: unknown,
) {
  if (!rec) return true;
  if (rec.pendingCreate)
    throw new IssueConflictError(
      "A Jira create needs reconciliation in Settings before syncing.",
    );
  const baseline =
    rec.kind === "issue" && rec.localHash
      ? stable({
          issueTypeId: null,
          tagIds: [],
          estimateTime: null,
          startAt: null,
          finishAt: null,
          ...JSON.parse(rec.localHash),
        })
      : rec.localHash;
  if (baseline !== stable(local)) {
    if (rec.remoteHash !== stable(remote))
      throw new IssueConflictError(
        "Both Spectron and Jira changed. Resolve the conflicting edits before importing.",
      );
    return false;
  }
  return true;
}
export function createJiraService(
  db: Database,
  files: FileService,
  secret?: string,
) {
  const client = (c: Connection) =>
    new JiraClient(c.baseUrl, c.email, decryptToken(c.encryptedToken, secret));
  async function connection(userId: string, projectId: string, write = false) {
    return db.transaction(async (tx) => {
      await issueAccess(tx, userId, projectId, write, true);
      const [c] = await tx
        .select()
        .from(s.jiraIntegration)
        .where(eq(s.jiraIntegration.projectId, projectId));
      if (!c)
        throw new IssueInputError("Connect Jira in project Settings first.");
      return c;
    });
  }
  async function locked<T>(
    userId: string,
    projectId: string,
    fn: (c: Connection, api: JiraClient) => Promise<T>,
    runId?: string,
  ) {
    const c = await connection(userId, projectId, true);
    const controller = new AbortController();
    const check = async () => {
      if (!runId) return;
      const [state] = await db
        .select({
          runId: s.jiraIntegration.importRunId,
          cancelled: s.jiraIntegration.importCancelled,
        })
        .from(s.jiraIntegration)
        .where(eq(s.jiraIntegration.id, c.id));
      if (!state || state.runId !== runId || state.cancelled) {
        controller.abort();
        throw new IssueInputError(
          "Import stopped. Completed records are saved; you can start again.",
        );
      }
    };
    await check();
    const lease = createId();
    const [claimed] = await db
      .update(s.jiraIntegration)
      .set({ lease, leaseUntil: new Date(Date.now() + 15 * 60_000) })
      .where(
        and(
          eq(s.jiraIntegration.id, c.id),
          or(
            isNull(s.jiraIntegration.leaseUntil),
            lt(s.jiraIntegration.leaseUntil, new Date()),
          ),
        ),
      )
      .returning();
    if (!claimed)
      throw new IssueConflictError(
        "Another Jira operation is running. Try again when it finishes.",
      );
    const heartbeat = setInterval(() => {
      void db
        .update(s.jiraIntegration)
        .set({ leaseUntil: new Date(Date.now() + 15 * 60_000) })
        .where(
          and(
            eq(s.jiraIntegration.id, c.id),
            eq(s.jiraIntegration.lease, lease),
          ),
        )
        .catch(() => {});
    }, 60_000);
    heartbeat.unref();
    const cancellationPoll = runId
      ? setInterval(() => {
          void check().catch(() => controller.abort());
        }, 250)
      : null;
    cancellationPoll?.unref();
    try {
      const api = runId
        ? new JiraClient(
            claimed.baseUrl,
            claimed.email,
            decryptToken(claimed.encryptedToken, secret),
            { signal: controller.signal, check },
          )
        : client(claimed);
      await api.checkpoint();
      return await fn(claimed, api);
    } catch (error) {
      if (controller.signal.aborted)
        throw new IssueInputError(
          "Import stopped. Completed records are saved; you can start again.",
        );
      throw error;
    } finally {
      if (cancellationPoll) clearInterval(cancellationPoll);
      clearInterval(heartbeat);
      await db
        .update(s.jiraIntegration)
        .set({ lease: null, leaseUntil: null })
        .where(
          and(
            eq(s.jiraIntegration.id, c.id),
            eq(s.jiraIntegration.lease, lease),
          ),
        );
    }
  }
  async function mappedUser(
    tx: Tx,
    c: Connection,
    person: JiraUser | null | undefined,
    fallback?: string,
  ) {
    if (!person)
      return {
        userId: fallback ?? null,
        identityId: null,
        reference: fallback ?? null,
      };
    const localUserId = c.mappings.users[person.accountId] ?? null;
    if (localUserId) {
      const [member] = await tx
        .select()
        .from(s.projectMember)
        .where(
          and(
            eq(s.projectMember.projectId, c.projectId),
            eq(s.projectMember.userId, localUserId),
          ),
        );
      if (!member)
        throw new IssueInputError(
          "A mapped user is no longer a project member. Remove or update their mapping.",
        );
    }
    const [identity] = await tx
      .insert(s.externalIdentity)
      .values({
        projectId: c.projectId,
        integrationId: c.id,
        externalId: person.accountId,
        displayName: person.displayName || person.accountId,
        avatarUrl: person.avatarUrls?.["48x48"] ?? null,
        localUserId,
      })
      .onConflictDoUpdate({
        target: [
          s.externalIdentity.integrationId,
          s.externalIdentity.externalId,
        ],
        set: {
          displayName: person.displayName || person.accountId,
          avatarUrl: person.avatarUrls?.["48x48"] ?? null,
          localUserId,
        },
      })
      .returning();
    return { userId: null, identityId: identity!.id, reference: identity!.id };
  }

  async function externalUser(c: Connection, id: string) {
    const [identity] = await db
      .select()
      .from(s.externalIdentity)
      .where(
        and(
          eq(s.externalIdentity.id, id),
          eq(s.externalIdentity.integrationId, c.id),
        ),
      );
    return identity?.externalId ?? reverse(c.mappings.users, id, "user");
  }
  async function option(
    tx: Tx,
    c: Connection,
    kind: "statuses" | "priorities",
    ref:
      | { id: string; name: string; statusCategory?: { key?: string } }
      | null
      | undefined,
  ) {
    if (!ref) return null;
    const table = kind === "statuses" ? s.issueState : s.issuePriority;
    const mapped = c.mappings[kind][ref.id];
    const [existing] = await tx
      .select()
      .from(table)
      .where(
        and(
          eq(table.projectId, c.projectId),
          mapped ? eq(table.id, mapped) : eq(table.externalId, ref.id),
          isNull(table.deletedAt),
        ),
      );
    if (mapped && !existing)
      throw new IssueInputError(
        `The mapped ${kind} was deleted. Update the mapping.`,
      );
    let id = existing?.id;
    if (!id) {
      if (kind === "statuses") {
        const [created] = await tx
          .insert(s.issueState)
          .values({
            projectId: c.projectId,
            externalId: ref.id,
            name: ref.name,
            position: 1000,
            trigger:
              ref.statusCategory?.key === "done"
                ? "finished"
                : ref.statusCategory?.key === "indeterminate"
                  ? "in_progress"
                  : "opened",
          })
          .returning();
        id = created!.id;
      } else {
        const [created] = await tx
          .insert(s.issuePriority)
          .values({
            projectId: c.projectId,
            externalId: ref.id,
            name: ref.name,
            position: 1000,
          })
          .returning();
        id = created!.id;
      }
    }
    c.mappings[kind][ref.id] = id;
    await tx
      .update(table)
      .set({ externalId: ref.id })
      .where(and(eq(table.id, id), isNull(table.externalId)));
    await tx
      .update(s.jiraIntegration)
      .set({ mappings: c.mappings })
      .where(eq(s.jiraIntegration.id, c.id));
    return id;
  }
  async function importIssue(
    userId: string,
    c: Connection,
    api: JiraClient,
    externalId: string,
    overwriteLocal = false,
  ) {
    const remote = await api.getIssue(externalId);
    // Verify caller-supplied IDs belong to the configured project.
    const remoteProject = remote.fields.project as { key?: string } | undefined;
    if (remoteProject?.key !== c.projectKey)
      throw new IssueInputError(
        "This Jira issue belongs to a different project.",
      );
    const [comments, worklogs] = await Promise.all([
      api.getComments(remote.id),
      api.getWorklogs(remote.id),
    ]);
    const local = await db.transaction(async (tx) => {
      await api.checkpoint();
      const project = await issueAccess(tx, userId, c.projectId, true, true);
      const rec = await record(tx, c.id, "issue", "externalId", remote.id);
      const existing = rec
        ? (
            await tx
              .select()
              .from(s.issue)
              .where(
                and(
                  eq(s.issue.id, rec.localId),
                  eq(s.issue.projectId, c.projectId),
                ),
              )
          )[0]
        : undefined;
      if (existing?.deletedAt)
        throw new IssueConflictError(
          "Restore the local issue before importing it.",
        );
      const author = await mappedUser(tx, c, remote.fields.reporter, userId);
      const assignee = await mappedUser(tx, c, remote.fields.assignee);
      const stateId = await option(tx, c, "statuses", remote.fields.status);
      if (!stateId) throw new IssueInputError("Jira issue has no status.");
      const priorityId = await option(
        tx,
        c,
        "priorities",
        remote.fields.priority,
      );
      const oldTagIds = existing ? await issueTagIds(tx, existing.id) : [];
      let tagIds = oldTagIds;
      let issueTypeId = existing?.issueTypeId ?? null;
      const remoteType = remote.fields.issuetype as { id?: string } | undefined;
      if (remoteType?.id && c.mappings.issueTypes?.[remoteType.id]) {
        issueTypeId = c.mappings.issueTypes[remoteType.id]!;
        const [type] = await tx.select().from(s.issueType).where(and(eq(s.issueType.id, issueTypeId), eq(s.issueType.projectId, c.projectId), isNull(s.issueType.deletedAt)));
        if (!type) throw new IssueInputError("Mapped issue type is unavailable.");
      }
      if (c.mappings.fields.labels === "issue:tags") {
        const labels = remote.fields.labels ?? [];
        if (!Array.isArray(labels) || labels.length > 100 || labels.some(label => typeof label !== "string" || !label.trim() || label.length > 80)) throw new IssueInputError("Jira labels must be up to 100 nonempty strings of at most 80 characters.");
        tagIds = [];
        for (const name of [...new Set((labels as string[]).map(label => label.trim()))]) {
          let [tag] = await tx.select().from(s.tag).where(and(eq(s.tag.projectId, c.projectId), eq(s.tag.name, name), isNull(s.tag.deletedAt)));
          if (!tag) [tag] = await tx.insert(s.tag).values({ projectId: c.projectId, name, position: 0 }).returning();
          tagIds.push(tag!.id);
        }
        tagIds.sort();
      }
      const timing = {
        estimateTime: existing?.estimateTime ?? null,
        startAt: issueTimestamp(existing?.startAt),
        finishAt: issueTimestamp(existing?.finishAt),
      };
      const fieldValues: FieldValues = { ...existing?.fieldValues };
      for (const [external, localId] of Object.entries(c.mappings.fields)) {
        if (!localId || localId === "issue:tags") continue;
        const native = builtInIssueField(localId);
        if (native) {
          const converted = importBuiltIn(localId, remote.fields[external]);
          if (native.key === "estimateTime")
            timing.estimateTime = converted as number | null;
          else timing[native.key] = converted as string | null;
          continue;
        }
        const [field] = await tx
          .select()
          .from(s.projectField)
          .where(
            and(
              eq(s.projectField.id, localId),
              eq(s.projectField.projectId, c.projectId),
              isNull(s.projectField.deletedAt),
            ),
          );
        if (!field)
          throw new IssueInputError("A mapped project field no longer exists.");
        const value = remote.fields[external];
        if (value == null) fieldValues[localId] = null;
        else if (field.type === "user")
          fieldValues[localId] = (
            await mappedUser(tx, c, value as JiraUser)
          ).reference;
        else if (field.type === "text") {
          if (
            typeof value !== "string" &&
            !(
              typeof value === "object" &&
              "type" in value &&
              value.type === "doc"
            )
          )
            throw new IssueInputError(
              `Jira field ${external} cannot be imported as Text. Ignore it or change its mapping.`,
            );
          fieldValues[localId] =
            typeof value === "string" ? value : adfToText(value);
        } else fieldValues[localId] = value as string | number;
      }
      try {
        validateIssueTiming(timing);
      } catch (e) {
        throw new IssueInputError((e as Error).message);
      }
      await validateFieldValues(tx, c.projectId, fieldValues);
      const values = {
        ...timing,
        issueTypeId,
        title: remote.fields.summary ?? remote.key,
        description: adfToText(remote.fields.description),
        assigneeId: assignee.userId,
        externalAssigneeId: assignee.identityId,
        stateId,
        priorityId,
        fieldValues,
        externalId: remote.id,
        externalKey: remote.key,
      };
      if (values.title.length > ISSUE_TITLE_MAX_LENGTH)
        throw new IssueInputError(`Jira title has ${values.title.length} characters; Spectron allows ${ISSUE_TITLE_MAX_LENGTH}.`);
      if (values.description.length > ISSUE_DESCRIPTION_MAX_LENGTH)
        throw new IssueInputError(`Jira description has ${values.description.length} characters; Spectron allows ${ISSUE_DESCRIPTION_MAX_LENGTH.toLocaleString("en-US")}.`);
      const snapshot = remoteIssue(remote, c.mappings);
      if (
        existing &&
        !overwriteLocal &&
        !shouldImport(rec, localIssue(existing, oldTagIds), snapshot)
      )
        return existing;
      let row: typeof s.issue.$inferSelect;
      if (existing) {
        if (
          existing.externalKey === remote.key &&
          stable(localIssue(existing, oldTagIds)) ===
            stable({
              ...timing,
              issueTypeId,
              tagIds,
              title: values.title,
              description: values.description,
              assigneeId: assignee.reference,
              stateId,
              priorityId,
              fieldValues,
            })
        )
          row = existing;
        else
          [row] = (await tx
            .update(s.issue)
            .set(values)
            .where(eq(s.issue.id, existing.id))
            .returning()) as [typeof s.issue.$inferSelect];
      } else {
        await tx
          .update(s.project)
          .set({ issueCounter: project.issueCounter + 1 })
          .where(eq(s.project.id, c.projectId));
        [row] = (await tx
          .insert(s.issue)
          .values({
            ...values,
            projectId: c.projectId,
            number: project.issueCounter + 1,
            authorId: author.userId,
            externalAuthorId: author.identityId,
            createdAt: new Date(remote.fields.created ?? Date.now()),
            updatedAt: new Date(
              remote.fields.updated ?? remote.fields.created ?? Date.now(),
            ),
          })
          .returning()) as [typeof s.issue.$inferSelect];
      }
      await setIssueTags(tx, c.projectId, row.id, tagIds);
      if (!existing || stable(localIssue(existing, oldTagIds)) !== stable(localIssue(row, tagIds)))
        await tx.insert(s.issueHistory).values({
          issueId: row.id,
          actorUserId: userId,
          action: existing ? "updated" : "created",
          changes: historyChanges(
            existing ? localIssue(existing, oldTagIds) : {},
            localIssue(row, tagIds),
          ),
        });
      await remember(
        tx,
        c,
        "issue",
        row.id,
        remote.id,
        localIssue(row, tagIds),
        snapshot,
      );
      return row;
    });
    for (const remoteComment of comments)
      await db.transaction(async (tx) => {
        await api.checkpoint();
        await issueAccess(tx, userId, c.projectId, true, true);
        const rec = await record(
          tx,
          c.id,
          "comment",
          "externalId",
          remoteComment.id,
        );
        const existing = rec
          ? (
              await tx
                .select()
                .from(s.issueComment)
                .where(eq(s.issueComment.id, rec.localId))
            )[0]
          : undefined;
        if (existing?.deletedAt) return;
        const body = [
          { type: "text" as const, text: adfToText(remoteComment.body) },
        ];
        if (
          existing &&
          !overwriteLocal &&
          !shouldImport(rec, existing.body, remoteComment.body)
        )
          return;
        const author = (await mappedUser(tx, c, remoteComment.author, userId))!;
        let row = existing;
        if (!existing)
          [row] = await tx
            .insert(s.issueComment)
            .values({
              projectId: c.projectId,
              issueId: local.id,
              externalId: remoteComment.id,
              authorId: author.userId,
              externalAuthorId: author.identityId,
              body,
              createdAt: new Date(remoteComment.created ?? Date.now()),
              updatedAt: new Date(
                remoteComment.updated ?? remoteComment.created ?? Date.now(),
              ),
            })
            .returning();
        else if (stable(existing.body) !== stable(body))
          [row] = await tx
            .update(s.issueComment)
            .set({ body })
            .where(eq(s.issueComment.id, existing.id))
            .returning();
        if (!existing || stable(existing.body) !== stable(body))
          await tx.insert(s.issueHistory).values({
            issueId: local.id,
            entityType: "comment",
            entityId: row!.id,
            actorUserId: userId,
            action: existing ? "updated" : "created",
            changes: {
              body: { before: existing?.body ?? null, after: body },
            },
          });
        await remember(
          tx,
          c,
          "comment",
          row!.id,
          remoteComment.id,
          row!.body,
          remoteComment.body,
        );
      });
    for (const remoteLog of worklogs)
      await db.transaction(async (tx) => {
        await api.checkpoint();
        await issueAccess(tx, userId, c.projectId, true, true);
        const rec = await record(
          tx,
          c.id,
          "worklog",
          "externalId",
          remoteLog.id,
        );
        const existing = rec
          ? (
              await tx
                .select()
                .from(s.issueWorklog)
                .where(eq(s.issueWorklog.id, rec.localId))
            )[0]
          : undefined;
        if (existing?.deletedAt) return;
        const projectLog = (r: typeof s.issueWorklog.$inferSelect) => ({
          workerUserId: r.workerUserId ?? r.externalWorkerId,
          startedAt: r.startedAt.toISOString(),
          durationSeconds: r.durationSeconds,
          description: r.description,
        });
        if (
          existing &&
          !overwriteLocal &&
          !shouldImport(rec, projectLog(existing), remoteLog)
        )
          return;
        const worker = await mappedUser(tx, c, remoteLog.author, userId);
        const values = {
          workerUserId: worker.userId,
          externalWorkerId: worker.identityId,
          startedAt: new Date(remoteLog.started),
          durationSeconds: remoteLog.timeSpentSeconds ?? 0,
          description: adfToText(remoteLog.comment),
        };
        if (
          !Number.isInteger(values.durationSeconds) ||
          values.durationSeconds <= 0 ||
          values.durationSeconds > 2147483647 ||
          !Number.isFinite(values.startedAt.getTime())
        )
          throw new IssueInputError(`Invalid Jira worklog ${remoteLog.id}.`);
        let row = existing;
        if (!existing)
          [row] = await tx
            .insert(s.issueWorklog)
            .values({
              ...values,
              projectId: c.projectId,
              issueId: local.id,
              externalId: remoteLog.id,
              recordedBy: userId,
              createdAt: new Date(remoteLog.created ?? Date.now()),
              updatedAt: new Date(
                remoteLog.updated ?? remoteLog.created ?? Date.now(),
              ),
            })
            .returning();
        else if (
          stable(projectLog(existing)) !==
          stable({
            workerUserId: worker.reference,
            startedAt: values.startedAt.toISOString(),
            durationSeconds: values.durationSeconds,
            description: values.description,
          })
        )
          [row] = await tx
            .update(s.issueWorklog)
            .set(values)
            .where(eq(s.issueWorklog.id, existing.id))
            .returning();
        if (
          !existing ||
          stable(projectLog(existing)) !== stable(projectLog(row!))
        )
          await tx.insert(s.issueHistory).values({
            issueId: local.id,
            entityType: "worklog",
            entityId: row!.id,
            actorUserId: userId,
            action: existing ? "updated" : "created",
            changes: historyChanges(
              existing ? projectLog(existing) : {},
              projectLog(row!),
            ),
          });
        await remember(
          tx,
          c,
          "worklog",
          row!.id,
          remoteLog.id,
          projectLog(row!),
          remoteLog,
        );
      });
    for (const attachment of remote.fields.attachment ?? []) {
      await api.checkpoint();
      const rec = await record(
        db,
        c.id,
        "attachment",
        "externalId",
        attachment.id,
      );
      if (rec) continue;
      // Persist the file association before linking, so a failed link can be retried without another download.
      const [saved] = await db
        .select()
        .from(s.projectFile)
        .where(
          and(
            eq(s.projectFile.projectId, c.projectId),
            eq(s.projectFile.externalId, attachment.id),
          ),
        );
      let projectFileId = saved?.id;
      if (!projectFileId) {
        const uploader = await db.transaction(async (tx) => {
          await api.checkpoint();
          await issueAccess(tx, userId, c.projectId, true, true);
          return mappedUser(tx, c, attachment.author, userId);
        });
        const body = await api.downloadAttachment(attachment);
        const uploaded = await files.upload(
          userId,
          c.projectId,
          attachment.filename,
          body,
          attachment.size,
        );
        projectFileId = uploaded.projectFileId;
        await db
          .update(s.projectFile)
          .set({ externalId: attachment.id })
          .where(eq(s.projectFile.id, projectFileId));
        await db
          .update(s.storedFile)
          .set({
            externalId: attachment.id,
            uploadedBy: uploader.userId,
            externalUploaderId: uploader.identityId,
            ...(attachment.created
              ? { createdAt: new Date(attachment.created) }
              : {}),
          })
          .where(eq(s.storedFile.id, uploaded.id));
      }
      await api.checkpoint();
      const linked = await files.link(userId, {
        projectId: c.projectId,
        issueId: local.id,
        sourceProjectId: c.projectId,
        projectFileId,
      });
      await db
        .update(s.issueAttachment)
        .set({ externalId: attachment.id })
        .where(eq(s.issueAttachment.id, linked.id));
      await remember(
        db,
        c,
        "attachment",
        linked.id,
        attachment.id,
        attachment.id,
        attachment.id,
      );
    }
    return { id: local.id, key: remote.key };
  }
  return {
    async get(userId: string, projectId: string) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, projectId, false, true);
        const [c] = await tx
          .select()
          .from(s.jiraIntegration)
          .where(eq(s.jiraIntegration.projectId, projectId));
        return c ? publicConnection(c) : null;
      });
    },
    async save(userId: string, projectId: string, input: JiraConfigInput) {
      await db.transaction((tx) =>
        issueAccess(tx, userId, projectId, true, true),
      );
      const [existing] = await db
        .select()
        .from(s.jiraIntegration)
        .where(eq(s.jiraIntegration.projectId, projectId));
      const baseUrl = new URL(input.baseUrl).origin;
      if (
        existing &&
        (existing.baseUrl !== baseUrl ||
          existing.projectKey !== input.projectKey)
      )
        throw new IssueInputError(
          "The connected Jira site and project cannot be changed. Create a separate Spectron project.",
        );
      const token =
        input.apiToken ||
        (existing ? decryptToken(existing.encryptedToken, secret) : "");
      if (!token) throw new IssueInputError("Enter a Jira API token.");
      const api = new JiraClient(input.baseUrl, input.email, token);
      const test = await api.testConnection(input.projectKey);
      if (!test.success) throw new IssueInputError(test.message);
      const jiraProject = await api.getProject(input.projectKey);
      const issueTypes = await api.getIssueTypes(input.projectKey);
      // Credentials can be saved before choosing a mapping. Preserve the saved
      // type, or provision a valid default for a new connection.
      const issueTypeId = input.issueTypeId || existing?.issueTypeId || issueTypes[0]?.id;
      if (!issueTypeId || !issueTypes.some((t) => t.id === issueTypeId))
        throw new IssueInputError(
          "Enter an issue type ID from this Jira project.",
        );
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, projectId, true, true);
        const [current] = await tx
          .select()
          .from(s.jiraIntegration)
          .where(eq(s.jiraIntegration.projectId, projectId));
        if (current?.leaseUntil && current.leaseUntil > new Date())
          throw new IssueConflictError(
            "Wait for the Jira operation to finish.",
          );
        const values = {
          baseUrl,
          projectKey: input.projectKey,
          email: input.email,
          encryptedToken: encryptToken(token, secret),
          issueTypeId,
        };
        if (
          current &&
          (current.baseUrl !== baseUrl ||
            current.projectKey !== input.projectKey)
        )
          throw new IssueConflictError(
            "The connection changed. Reload Settings.",
          );
        const [c] = await tx
          .insert(s.jiraIntegration)
          .values({ projectId, ...values, mappings: emptyMappings() })
          .onConflictDoUpdate({
            target: s.jiraIntegration.projectId,
            set: values,
          })
          .returning();
        await tx
          .update(s.project)
          .set({ externalId: jiraProject.id })
          .where(eq(s.project.id, projectId));
        return publicConnection(c!);
      });
    },
    async test(userId: string, projectId: string, input: JiraConfigInput) {
      await db.transaction((tx) => issueAccess(tx, userId, projectId, false, true));
      const [saved] = await db.select().from(s.jiraIntegration).where(eq(s.jiraIntegration.projectId, projectId));
      const token = input.apiToken || (saved ? decryptToken(saved.encryptedToken, secret) : "");
      if (!token) throw new IssueInputError("Enter a Jira API token.");
      if (saved && new URL(input.baseUrl).origin !== saved.baseUrl && !input.apiToken)
        throw new IssueInputError("Enter a token for the new Jira site.");
      const api = new JiraClient(input.baseUrl, input.email, token);
      const result = await api.testConnection(input.projectKey);
      if (!result.success) throw new IssueInputError(result.message);
      return { issueTypes: await api.getIssueTypes(input.projectKey) };
    },
    async discover(userId: string, projectId: string, input?: JiraConfigInput) {
      await db.transaction((tx) =>
        issueAccess(tx, userId, projectId, false, true),
      );
      const c = input ? null : await connection(userId, projectId);
      const api = c
        ? client(c)
        : new JiraClient(input!.baseUrl, input!.email, input!.apiToken ?? "");
      const projectKey = c?.projectKey ?? input!.projectKey;
      const [groups, priorities, fields, users] = await Promise.all([
        api.getProjectStatuses(projectKey),
        api.getPriorities(),
        api.getFields(),
        api.getAssignableUsers(projectKey),
      ]);
      const imported = c
        ? await db
            .select()
            .from(s.externalIdentity)
            .where(eq(s.externalIdentity.integrationId, c.id))
        : [];
      const allUsers = [
        ...new Map(
          [
            ...users,
            ...imported.map((i) => ({
              accountId: i.externalId,
              displayName: i.displayName,
            })),
          ].map((u) => [u.accountId, u]),
        ).values(),
      ];
      return {
        statuses: [
          ...new Map(
            groups.flatMap((g) => g.statuses).map((st) => [st.id, st]),
          ).values(),
        ],
        priorities,
        fields,
        users: allUsers,
        issueTypes: groups.map((g) => ({ id: g.id, name: g.name })),
      };
    },
    async mappings(userId: string, projectId: string, mappings: JiraMappings) {
      return locked(userId, projectId, async (c) =>
        db.transaction(async (tx) => {
          await issueAccess(tx, userId, projectId, true, true);
          for (const [kind, map] of Object.entries(mappings)) {
            for (const id of Object.values(map ?? {})) {
              if (id === null && kind === "fields") continue;
              if (typeof id !== "string" || !id)
                throw new IssueInputError("Invalid mapping.");
              if (kind === "fields" && (builtInIssueField(id) || id === "issue:tags")) continue;
              if (kind === "users") {
                const [m] = await tx
                  .select()
                  .from(s.projectMember)
                  .where(
                    and(
                      eq(s.projectMember.projectId, projectId),
                      eq(s.projectMember.userId, id),
                    ),
                  );
                if (!m)
                  throw new IssueInputError(
                    "Mapped users must belong to this project.",
                  );
              } else {
                const table =
                  kind === "statuses"
                    ? s.issueState
                    : kind === "priorities"
                      ? s.issuePriority
                      : kind === "issueTypes" ? s.issueType : s.projectField;
                const [f] = await tx
                  .select()
                  .from(table)
                  .where(
                    and(
                      eq(table.id, id),
                      eq(table.projectId, projectId),
                      isNull(table.deletedAt),
                    ),
                  );
                if (!f)
                  throw new IssueInputError(
                    "Mapped values must belong to this project.",
                  );
              }
            }
            if (kind !== "users") {
              const values = Object.values(map ?? {}).filter((v) => v !== null);
              if (new Set(values).size !== values.length)
                throw new IssueInputError(
                  `Use one-to-one ${kind} mappings so export is unambiguous.`,
                );
            }
          }
          if (Object.entries(mappings.fields).some(([remote, local]) => (local === "issue:tags" && remote !== "labels") || (remote === "labels" && local && local !== "issue:tags"))) throw new IssueInputError("Map Jira labels only to Tags.");
          const reserved = [
            "summary",
            "description",
            "status",
            "priority",
            "assignee",
            "reporter",
            "project",
            "issuetype",
            "comment",
            "worklog",
            "attachment",
            "created",
            "updated",
          ];
          if (Object.keys(mappings.fields).some((k) => reserved.includes(k)))
            throw new IssueInputError(
              "Core Jira fields are mapped automatically.",
            );
          if (
            mappings.fields.timeoriginalestimate &&
            mappings.fields.timetracking
          )
            throw new IssueInputError(
              "Map either Original estimate or Time tracking, not both.",
            );
          for (const [externalId, id] of Object.entries(mappings.fields))
            if (id && id !== "issue:tags" && !builtInIssueField(id))
              await tx
                .update(s.projectField)
                .set({ externalId })
                .where(eq(s.projectField.id, id));
          const identities = await tx
            .select()
            .from(s.externalIdentity)
            .where(eq(s.externalIdentity.integrationId, c.id));
          for (const identity of identities)
            await tx
              .update(s.externalIdentity)
              .set({ localUserId: mappings.users[identity.externalId] ?? null })
              .where(eq(s.externalIdentity.id, identity.id));
          await tx
            .update(s.jiraIntegration)
            .set({ mappings })
            .where(eq(s.jiraIntegration.id, c.id));
        }),
      );
    },
    async schedule(userId: string, projectId: string, minutes: number | null) {
      if (minutes !== null && ![15, 60, 1440].includes(minutes))
        throw new IssueInputError(
          "Choose every 15 minutes, hourly, daily, or disabled.",
        );
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, projectId, true, true);
        const [c] = await tx
          .update(s.jiraIntegration)
          .set({
            scheduleMinutes: minutes,
            scheduleUserId: minutes === null ? null : userId,
            nextImportAt:
              minutes === null ? null : new Date(Date.now() + minutes * 60_000),
          })
          .where(eq(s.jiraIntegration.projectId, projectId))
          .returning();
        if (!c) throw new IssueInputError("Connect Jira first.");
        return publicConnection(c);
      });
    },
    async startImport(userId: string, projectId: string) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, projectId, true, true);
        const runId = createId();
        const [c] = await tx
          .update(s.jiraIntegration)
          .set({ importRunId: runId, importCancelled: false })
          .where(
            and(
              eq(s.jiraIntegration.projectId, projectId),
              or(
                isNull(s.jiraIntegration.scheduleLeaseUntil),
                lt(s.jiraIntegration.scheduleLeaseUntil, new Date()),
              ),
              or(
                isNull(s.jiraIntegration.leaseUntil),
                lt(s.jiraIntegration.leaseUntil, new Date()),
              ),
            ),
          )
          .returning();
        if (!c)
          throw new IssueConflictError(
            "Wait for the current Jira request to stop before starting another import.",
          );
        return { runId };
      });
    },
    async stopImport(userId: string, projectId: string, runId: string) {
      await connection(userId, projectId);
      await db
        .update(s.jiraIntegration)
        .set({ importCancelled: true })
        .where(
          and(
            eq(s.jiraIntegration.projectId, projectId),
            eq(s.jiraIntegration.importRunId, runId),
          ),
        );
    },
    async finishImport(userId: string, projectId: string, runId: string) {
      await connection(userId, projectId);
      await db
        .update(s.jiraIntegration)
        .set({ importRunId: null })
        .where(
          and(
            eq(s.jiraIntegration.projectId, projectId),
            eq(s.jiraIntegration.importRunId, runId),
          ),
        );
    },
    async prepare(userId: string, projectId: string, runId?: string) {
      return locked(
        userId,
        projectId,
        async (c, api) => {
          const [groups, priorities] = await Promise.all([
            api.getProjectStatuses(c.projectKey),
            api.getPriorities(),
          ]);
          await db.transaction(async (tx) => {
            await api.checkpoint();
            await issueAccess(tx, userId, projectId, true, true);
            const localStatuses = await tx
              .select()
              .from(s.issueState)
              .where(eq(s.issueState.projectId, projectId));
            c.mappings.statuses = matchJiraStatuses(
              groups.flatMap((g) => g.statuses),
              localStatuses,
              c.mappings.statuses,
            );
            for (const status of new Map(
              groups
                .flatMap((g) => g.statuses)
                .map((value) => [value.id, value]),
            ).values())
              await option(tx, c, "statuses", status);
            for (const priority of priorities)
              await option(tx, c, "priorities", priority);
          });
          return publicConnection(c);
        },
        runId,
      );
    },
    async search(
      userId: string,
      projectId: string,
      nextPageToken?: string,
      runId?: string,
      updatedAfter?: Date,
    ) {
      return locked(
        userId,
        projectId,
        async (c, api) => {
          const page = await api.searchIssues({
            projectKey: c.projectKey,
            ...(updatedAfter ? { updatedAfter } : {}),
            ...(nextPageToken ? { nextPageToken } : {}),
            maxResults: 25,
          });
          if (
            !page.isLast &&
            (!page.nextPageToken || page.nextPageToken === nextPageToken)
          )
            throw new IssueInputError(
              "Jira search pagination stalled. Retry the import.",
            );
          return {
            issues: page.issues.map((i) => ({ id: i.id, key: i.key })),
            nextPageToken: page.isLast ? null : page.nextPageToken!,
          };
        },
        runId,
      );
    },
    async import(
      userId: string,
      projectId: string,
      externalId: string,
      overwriteLocal = false,
      runId?: string,
    ) {
      return locked(
        userId,
        projectId,
        async (c, api) => {
          const result = await importIssue(
            userId,
            c,
            api,
            externalId,
            overwriteLocal,
          );
          await db
            .update(s.jiraIntegration)
            .set({ lastImportedAt: new Date() })
            .where(eq(s.jiraIntegration.id, c.id));
          return result;
        },
        runId,
      );
    },
    async pushIssue(
      userId: string,
      projectId: string,
      id: string,
      overwriteRemote = false,
    ) {
      return locked(userId, projectId, async (c, api) => {
        const [row] = await db
          .select()
          .from(s.issue)
          .where(
            and(
              eq(s.issue.id, id),
              eq(s.issue.projectId, projectId),
              isNull(s.issue.deletedAt),
            ),
          );
        if (!row) throw new IssueInputError("Issue not found.");
        const rec = await record(db, c.id, "issue", "localId", id);
        if (rec?.pendingCreate)
          throw new IssueConflictError(
            "A previous create has an unknown outcome. Reconcile its Jira ID in Settings before retrying.",
          );
        const before = rec?.localHash
          ? (JSON.parse(rec.localHash) as Record<string, unknown>)
          : {};
        const tagIds = await issueTagIds(db, row.id);
        const local = localIssue(row, tagIds);
        const changed = (k: keyof typeof local) =>
          overwriteRemote || stable(before[k]) !== stable(local[k]);
        let remote = rec?.externalId
          ? await api.getIssue(rec.externalId)
          : null;
        if (
          !overwriteRemote &&
          remote &&
          rec!.remoteHash !== stable(remoteIssue(remote, c.mappings))
        )
          throw new IssueConflictError(
            "Jira changed since the last sync. Import and resolve edits before sending.",
          );
        const fields: Record<string, unknown> = {};
        if (changed("title")) fields.summary = row.title;
        if (changed("description"))
          fields.description = textToAdf(row.description);
        if (c.mappings.fields.labels === "issue:tags" && changed("tagIds")) {
          const tags = await db.select().from(s.tag).where(eq(s.tag.projectId, projectId));
          const labels = tagIds.map(id => tags.find(tag => tag.id === id)?.name);
          if (labels.some(name => !name || /\s/.test(name))) throw new IssueInputError("Jira labels cannot contain whitespace. Rename the affected tags before sending.");
          fields.labels = labels;
        }
        if (local.issueTypeId && Object.keys(c.mappings.issueTypes ?? {}).length && changed("issueTypeId")) fields.issuetype = { id: reverse(c.mappings.issueTypes ?? {}, local.issueTypeId, "issue type") };
        if (changed("priorityId"))
          fields.priority = row.priorityId
            ? { id: reverse(c.mappings.priorities, row.priorityId, "priority") }
            : null;
        if (changed("assigneeId"))
          fields.assignee = local.assigneeId
            ? { accountId: await externalUser(c, local.assigneeId) }
            : null;
        const definitions = await db
          .select()
          .from(s.projectField)
          .where(
            and(
              eq(s.projectField.projectId, projectId),
              isNull(s.projectField.deletedAt),
            ),
          );
        const remoteFields = await api.getFields();
        const previousValues = (before.fieldValues ?? {}) as FieldValues;
        for (const [external, localId] of Object.entries(c.mappings.fields)) {
          if (localId === "issue:tags") continue;
          const native = localId ? builtInIssueField(localId) : undefined;
          if (native) {
            const value = local[native.key];
            if (
              overwriteRemote ||
              stable(before[native.key] ?? null) !== stable(value)
            )
              Object.assign(
                fields,
                exportBuiltIn(
                  external,
                  localId!,
                  value,
                  remoteFields.find((f) => f.id === external),
                ),
              );
            continue;
          }
          if (
            !localId ||
            (!overwriteRemote &&
              stable(previousValues[localId] ?? null) ===
                stable(row.fieldValues[localId] ?? null))
          )
            continue;
          const field = definitions.find((f) => f.id === localId);
          if (!field)
            throw new IssueInputError("A mapped field no longer exists.");
          const value = row.fieldValues[localId] ?? null;
          const remoteField = remoteFields.find((f) => f.id === external);
          fields[external] =
            field.type === "user" && value !== null
              ? { accountId: await externalUser(c, String(value)) }
              : value !== null &&
                  remoteField?.schema?.custom?.endsWith(":textarea")
                ? textToAdf(String(value))
                : value;
        }
        const desired = changed("stateId")
          ? reverse(c.mappings.statuses, row.stateId, "status")
          : null;
        if (!remote) {
          fields.project = { key: c.projectKey };
          fields.issuetype = { id: local.issueTypeId && Object.keys(c.mappings.issueTypes ?? {}).length ? reverse(c.mappings.issueTypes ?? {}, local.issueTypeId, "issue type") : c.issueTypeId };
          // Persist intent before non-idempotent POST. A timeout/crash cannot lead to blind retries.
          await db
            .insert(s.integrationRecord)
            .values({
              integrationId: c.id,
              kind: "issue",
              localId: id,
              pendingCreate: true,
            })
            .onConflictDoUpdate({
              target: [
                s.integrationRecord.integrationId,
                s.integrationRecord.kind,
                s.integrationRecord.localId,
              ],
              set: { pendingCreate: true },
            });
          let created: { id: string; key: string };
          try {
            created = await api.createIssue(fields);
          } catch (error) {
            if (
              error instanceof JiraApiError &&
              [400, 401, 403, 404, 422, 429].includes(error.status)
            )
              await db
                .delete(s.integrationRecord)
                .where(
                  and(
                    eq(s.integrationRecord.integrationId, c.id),
                    eq(s.integrationRecord.kind, "issue"),
                    eq(s.integrationRecord.localId, id),
                    isNull(s.integrationRecord.externalId),
                  ),
                );
            throw error;
          }
          await db
            .update(s.issue)
            .set({ externalId: created.id, externalKey: created.key, updatedAt: sql`${s.issue.updatedAt}` })
            .where(eq(s.issue.id, id));
          remote = await api.getIssue(created.id);
          await remember(
            db,
            c,
            "issue",
            id,
            created.id,
            {},
            remoteIssue(remote, c.mappings),
          );
        } else if (Object.keys(fields).length) {
          await api.updateIssue(remote.id, { fields });
          remote = await api.getIssue(remote.id);
          // Keep a checkpoint if a later transition fails.
          await remember(
            db,
            c,
            "issue",
            id,
            remote.id,
            { ...local, stateId: before.stateId ?? "" },
            remoteIssue(remote, c.mappings),
          );
        }
        if (desired && remote.fields.status?.id !== desired) {
          const transition = (await api.getTransitions(remote.id)).find(
            (t) => t.to?.id === desired,
          );
          if (!transition)
            throw new IssueInputError(
              `Jira has no available transition to the mapped status. Other field changes may already be saved.`,
            );
          await api.transitionIssue(remote.id, transition.id);
          remote = await api.getIssue(remote.id);
        }
        await remember(
          db,
          c,
          "issue",
          id,
          remote.id,
          local,
          remoteIssue(remote, c.mappings),
        );
        return { key: remote.key };
      });
    },
    async pushWorklog(userId: string, projectId: string, id: string, remove: boolean, reconcileId?: string) {
      return locked(userId, projectId, async (c, api) => {
        const [row] = await db.select().from(s.issueWorklog).where(and(eq(s.issueWorklog.id, id), eq(s.issueWorklog.projectId, projectId)));
        if (!row) throw new IssueInputError("Worklog not found.");
        const parent = await record(db, c.id, "issue", "localId", row.issueId);
        if (!parent?.externalId) throw new IssueInputError("Export the issue before its worklogs.");
        const imported = await record(db, c.id, "worklog", "localId", id);
        await exportWorklog(db, {
          provider: "jira", projectId, row, remove, reconcileId, imported,
          list: () => api.getWorklogs(parent.externalId!),
          create: () => api.addWorklog(parent.externalId!, { start: row.startedAt, durationMinutes: row.durationSeconds / 60, comment: row.description }),
          delete: remoteId => api.deleteWorklog(parent.externalId!, remoteId),
          fingerprint: stable,
          linked: async remote => {
            await remember(db, c, "worklog", row.id, remote.id, { workerUserId: row.workerUserId ?? row.externalWorkerId, startedAt: row.startedAt.toISOString(), durationSeconds: row.durationSeconds, description: row.description }, remote);
          },
        });
      });
    },
    async pushComment(
      userId: string,
      projectId: string,
      id: string,
      overwriteRemote = false,
    ) {
      return locked(userId, projectId, async (c, api) => {
        const [row] = await db
          .select()
          .from(s.issueComment)
          .where(
            and(
              eq(s.issueComment.id, id),
              eq(s.issueComment.projectId, projectId),
              isNull(s.issueComment.deletedAt),
            ),
          );
        if (!row) throw new IssueInputError("Comment not found.");
        const issueRec = await record(
          db,
          c.id,
          "issue",
          "localId",
          row.issueId,
        );
        if (!issueRec?.externalId)
          throw new IssueInputError("Send the issue to Jira first.");
        const rec = await record(db, c.id, "comment", "localId", id);
        if (rec?.pendingCreate)
          throw new IssueConflictError(
            "The previous comment create needs reconciliation in Settings.",
          );
        if (!overwriteRemote && rec?.localHash === stable(row.body))
          return { sent: false };
        const [parent] = await db
          .select()
          .from(s.issue)
          .where(eq(s.issue.id, row.issueId));
        if (parent?.deletedAt)
          throw new IssueInputError("Restore the issue first.");
        if (rec?.externalId) {
          const remote = (await api.getComments(issueRec.externalId)).find(
            (r) => r.id === rec.externalId,
          );
          if (
            !remote ||
            (!overwriteRemote && rec.remoteHash !== stable(remote.body))
          )
            throw new IssueConflictError(
              "This Jira comment changed. Import before sending edits.",
            );
        } else
          await db
            .insert(s.integrationRecord)
            .values({
              integrationId: c.id,
              kind: "comment",
              localId: id,
              pendingCreate: true,
            })
            .onConflictDoUpdate({
              target: [
                s.integrationRecord.integrationId,
                s.integrationRecord.kind,
                s.integrationRecord.localId,
              ],
              set: { pendingCreate: true },
            });
        let remote;
        try {
          remote = await api.saveComment(
            issueRec.externalId,
            textToAdf(commentText(row.body)),
            rec?.externalId ?? undefined,
          );
        } catch (error) {
          if (
            !rec?.externalId &&
            error instanceof JiraApiError &&
            [400, 401, 403, 404, 422, 429].includes(error.status)
          )
            await db
              .delete(s.integrationRecord)
              .where(
                and(
                  eq(s.integrationRecord.integrationId, c.id),
                  eq(s.integrationRecord.kind, "comment"),
                  eq(s.integrationRecord.localId, id),
                  isNull(s.integrationRecord.externalId),
                ),
              );
          throw error;
        }
        await db
          .update(s.issueComment)
          .set({ externalId: remote.id, updatedAt: sql`${s.issueComment.updatedAt}` })
          .where(eq(s.issueComment.id, id));
        await remember(db, c, "comment", id, remote.id, row.body, remote.body);
        return { sent: true };
      });
    },
    async pending(userId: string, projectId: string) {
      const c = await connection(userId, projectId);
      return db
        .select({
          id: s.integrationRecord.localId,
          kind: s.integrationRecord.kind,
        })
        .from(s.integrationRecord)
        .where(
          and(
            eq(s.integrationRecord.integrationId, c.id),
            eq(s.integrationRecord.pendingCreate, true),
          ),
        );
    },
    async reconcile(
      userId: string,
      projectId: string,
      kind: "issue" | "comment",
      id: string,
      externalId: string,
    ) {
      return locked(userId, projectId, async (c, api) => {
        const rec = await record(db, c.id, kind, "localId", id);
        if (!rec?.pendingCreate)
          throw new IssueInputError(
            "No pending create exists for this entity.",
          );
        if (kind === "issue") {
          const remote = await api.getIssue(externalId);
          if ((remote.fields.project as { key?: string })?.key !== c.projectKey)
            throw new IssueInputError(
              "Choose an issue in the connected Jira project.",
            );
          await db.transaction(async (tx) => {
            await issueAccess(tx, userId, projectId, true, true);
            const linked = await record(
              tx,
              c.id,
              kind,
              "externalId",
              remote.id,
            );
            if (linked && linked.localId !== id)
              throw new IssueConflictError(
                "That Jira entity is already linked to another local entity.",
              );
            await tx
              .update(s.issue)
              .set({ externalId: remote.id, externalKey: remote.key, updatedAt: sql`${s.issue.updatedAt}` })
              .where(and(eq(s.issue.id, id), eq(s.issue.projectId, projectId)));
            await remember(
              tx,
              c,
              kind,
              id,
              remote.id,
              {},
              remoteIssue(remote, c.mappings),
            );
          });
        } else {
          const [row] = await db
            .select()
            .from(s.issueComment)
            .where(
              and(
                eq(s.issueComment.id, id),
                eq(s.issueComment.projectId, projectId),
              ),
            );
          if (!row) throw new IssueInputError("Comment not found.");
          const parent = await record(
            db,
            c.id,
            "issue",
            "localId",
            row.issueId,
          );
          if (!parent?.externalId)
            throw new IssueInputError("Reconcile the issue first.");
          const remote = (await api.getComments(parent.externalId)).find(
            (r) => r.id === externalId,
          );
          if (!remote)
            throw new IssueInputError(
              "Comment not found on the linked Jira issue.",
            );
          await db.transaction(async (tx) => {
            await issueAccess(tx, userId, projectId, true, true);
            const linked = await record(
              tx,
              c.id,
              kind,
              "externalId",
              remote.id,
            );
            if (linked && linked.localId !== id)
              throw new IssueConflictError(
                "That Jira entity is already linked to another local entity.",
              );
            await tx
              .update(s.issueComment)
              .set({ externalId: remote.id, updatedAt: sql`${s.issueComment.updatedAt}` })
              .where(eq(s.issueComment.id, id));
            await remember(tx, c, kind, id, remote.id, [], remote.body);
          });
        }
      });
    },
  };
}
export type JiraService = ReturnType<typeof createJiraService>;
