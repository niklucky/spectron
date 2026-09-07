import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import { type CommentBody } from "@spectron/shared";
import { issueAccess, IssueInputError, IssueConflictError } from "../issues";
import { validateFieldValues } from "../fields";
import {
  YandexTrackerClient,
  type YTIssue,
  type YTIssueUpdate,
} from "./yandex-client";
const {
  projectIntegration: integration,
  integrationEntity: entity,
  issue,
  issueComment,
  projectField,
  project,
  issueState,
  issuePriority,
  projectMember,
  user,
} = schema;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Config = typeof integration.$inferSelect;
type Mappings = Config["mappings"];
export type TrackerInput = {
  projectId: string;
  token?: string | undefined;
  organizationId: string;
  organizationType: "cloud" | "360";
  queue: string;
  mappings: Mappings;
};
export function sealToken(token: string, secret: string) {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32)
    throw new IssueInputError(
      "Set INTEGRATION_ENCRYPTION_KEY to a base64-encoded 32-byte key on the API server.",
    );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function openToken(token: string, secret: string) {
  const [iv, tag, data] = token.split(".").map((b) => Buffer.from(b, "base64"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secret, "base64"),
    iv!,
  );
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString(
    "utf8",
  );
}
export function reverseMapping(
  map: Record<string, string | null>,
  local: string,
) {
  const matches = Object.entries(map).filter(([, value]) => value === local);
  if (matches.length > 1)
    throw new IssueInputError(
      "Outbound mappings must have one remote value per local value.",
    );
  return matches[0]?.[0];
}
const identity = (c: Config, kind: "issue" | "comment", id: string) =>
  and(
    eq(entity.integrationId, c.id),
    eq(entity.entityType, kind),
    eq(entity.localId, id),
  );
const marker = (id: string) => `<!-- spectron-comment:${id} -->`;
const stripMarker = (text: string) =>
  text.replace(/\n?<!-- spectron-comment:[^>]+ -->/g, "");
const plain = (body: CommentBody) =>
  body.map((b) => (b.type === "text" ? b.text : `@${b.label}`)).join("");
export function createTrackerService(
  db: Database,
  secret = process.env.INTEGRATION_ENCRYPTION_KEY ?? "",
  factory = (c: Config) =>
    new YandexTrackerClient(
      openToken(c.token, secret),
      c.organizationType === "360" ? c.organizationId : undefined,
      c.organizationType === "cloud" ? c.organizationId : undefined,
    ),
) {
  let activeSyncs = 0;
  async function lock(tx: Tx, projectId: string) {
    const result = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext(${`tracker:${projectId}`})) as locked`,
    );
    if (!result.rows[0]?.locked)
      throw new IssueConflictError(
        "Integration is busy. Try again after the current operation finishes.",
      );
  }
  async function config(tx: Tx, actor: string, projectId: string) {
    await issueAccess(tx, actor, projectId, true, true);
    const [c] = await tx
      .select()
      .from(integration)
      .where(eq(integration.projectId, projectId));
    if (!c) throw new IssueInputError("Configure Yandex Tracker first.");
    return c;
  }
  async function checkpoint(
    c: Config,
    kind: "issue" | "comment",
    localId: string,
    localUpdatedAt: Date,
    remote: { id: string; updatedAt: string; key?: string },
  ) {
    await db.transaction(async (tx) => {
      const values = {
        integrationId: c.id,
        entityType: kind,
        localId,
        externalId: String(remote.id),
        externalKey: remote.key ?? null,
        localUpdatedAt,
        remoteUpdatedAt: remote.updatedAt,
      };
      await tx
        .insert(entity)
        .values(values)
        .onConflictDoUpdate({
          target: [entity.integrationId, entity.entityType, entity.localId],
          set: values,
        });
      if (kind === "issue")
        await tx
          .update(issue)
          .set({
            externalId: String(remote.id),
            externalKey: remote.key!,
            updatedAt: sql`${issue.updatedAt}`,
          })
          .where(eq(issue.id, localId));
      else
        await tx
          .update(issueComment)
          .set({
            externalId: String(remote.id),
            updatedAt: sql`${issueComment.updatedAt}`,
          })
          .where(eq(issueComment.id, localId));
    });
  }
  async function validateMappings(tx: Tx, projectId: string, maps: Mappings) {
    const options = {
      statuses: (
        await tx
          .select()
          .from(issueState)
          .where(
            and(
              eq(issueState.projectId, projectId),
              isNull(issueState.deletedAt),
            ),
          )
      ).map((r) => r.id),
      priorities: (
        await tx
          .select()
          .from(issuePriority)
          .where(
            and(
              eq(issuePriority.projectId, projectId),
              isNull(issuePriority.deletedAt),
            ),
          )
      ).map((r) => r.id),
      users: (
        await tx
          .select()
          .from(projectMember)
          .where(eq(projectMember.projectId, projectId))
      ).map((r) => r.userId),
      fields: (
        await tx
          .select()
          .from(projectField)
          .where(
            and(
              eq(projectField.projectId, projectId),
              isNull(projectField.deletedAt),
            ),
          )
      ).map((r) => r.id),
    };
    for (const kind of ["statuses", "priorities", "users", "fields"] as const) {
      const used = new Set<string>();
      for (const [remote, local] of Object.entries(maps[kind])) {
        if (
          !remote ||
          remote.length > 255 ||
          ["__proto__", "constructor", "prototype"].includes(remote)
        )
          throw new IssueInputError("Invalid remote mapping key.");
        if (
          kind === "fields" &&
          [
            "summary",
            "description",
            "queue",
            "status",
            "priority",
            "assignee",
            "createdBy",
            "unique",
            "version",
          ].includes(remote)
        )
          throw new IssueInputError(
            "Use dedicated mappings for built-in fields.",
          );
        if (local === null) continue;
        if (!options[kind].includes(local) || used.has(local))
          throw new IssueInputError(
            `Choose a distinct project value for each ${kind} mapping.`,
          );
        used.add(local);
      }
    }
  }
  async function importIssue(
    actor: string,
    c: Config,
    remote: YTIssue,
    overwriteConflicts: boolean,
  ) {
    return db.transaction(async (tx) => {
      const p = await issueAccess(tx, actor, c.projectId, true, true);
      const [link] = await tx
        .select()
        .from(entity)
        .where(
          and(
            eq(entity.integrationId, c.id),
            eq(entity.entityType, "issue"),
            eq(entity.externalId, String(remote.id)),
          ),
        );
      const [current] = link
        ? await tx.select().from(issue).where(eq(issue.id, link.localId))
        : [];
      if (current?.deletedAt) return current.id;
      if (current && link) {
        if (!overwriteConflicts && link.remoteUpdatedAt === remote.updatedAt)
          return current.id;
        if (
          !overwriteConflicts &&
          current.updatedAt.getTime() !== link.localUpdatedAt.getTime()
        )
          throw new IssueConflictError(
            `${remote.key} has local edits. Push them before importing remote changes.`,
          );
      }
      const stateId =
        c.mappings.statuses[String(remote.status?.id)] ??
        c.mappings.statuses[remote.status?.key ?? ""];
      if (!stateId)
        throw new IssueInputError(
          `Map status ${remote.status?.display ?? remote.status?.key ?? "unknown"} before importing ${remote.key}.`,
        );
      const fieldValues = { ...current?.fieldValues };
      const fields = await tx
        .select()
        .from(projectField)
        .where(
          and(eq(projectField.projectId, p.id), isNull(projectField.deletedAt)),
        );
      for (const [key, id] of Object.entries(c.mappings.fields)) {
        if (!id) continue;
        const field = fields.find((f) => f.id === id)!;
        const value = remote[key];
        if (field.type === "user")
          fieldValues[id] = value
            ? (c.mappings.users[String((value as { id: string }).id)] ?? null)
            : null;
        else if (value === undefined || value === null) fieldValues[id] = null;
        else if (typeof value === "string" || typeof value === "number")
          fieldValues[id] = value;
        else
          throw new IssueInputError(
            `Tracker field ${key} cannot be imported into ${field.name}.`,
          );
      }
      await validateFieldValues(tx, p.id, fieldValues);
      const assigneeId = remote.assignee
        ? (c.mappings.users[String(remote.assignee.id)] ?? null)
        : null;
      const values = {
        title: remote.summary,
        description: remote.description ?? "",
        stateId,
        priorityId:
          c.mappings.priorities[String(remote.priority?.id)] ??
          c.mappings.priorities[remote.priority?.key ?? ""] ??
          null,
        assigneeId,
        fieldValues,
        externalId: String(remote.id),
        externalKey: remote.key,
      };
      if (
        !values.title ||
        values.title.length > 140 ||
        values.description.length > 100000
      )
        throw new IssueInputError(
          `${remote.key} exceeds local title or description limits.`,
        );
      const now = new Date(
        Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1),
      );
      let row: typeof issue.$inferSelect;
      if (current)
        [row] = (await tx
          .update(issue)
          .set({ ...values, updatedAt: now })
          .where(eq(issue.id, current.id))
          .returning()) as [typeof issue.$inferSelect];
      else {
        await tx
          .update(project)
          .set({ issueCounter: p.issueCounter + 1 })
          .where(eq(project.id, p.id));
        [row] = (await tx
          .insert(issue)
          .values({
            ...values,
            projectId: p.id,
            number: p.issueCounter + 1,
            createdAt: new Date(remote.createdAt),
            authorId: c.mappings.users[String(remote.createdBy?.id)] ?? actor,
            updatedAt: now,
          })
          .returning()) as [typeof issue.$inferSelect];
      }
      await tx.insert(schema.issueHistory).values({
        issueId: row.id,
        actorUserId: actor,
        action: current ? "updated" : "created",
        changes: Object.fromEntries(
          Object.entries(values)
            .filter(
              ([key, value]) =>
                JSON.stringify(
                  current?.[key as keyof typeof current] ?? null,
                ) !== JSON.stringify(value),
            )
            .map(([key, value]) => [
              key,
              {
                before: current?.[key as keyof typeof current] ?? null,
                after: value,
              },
            ]),
        ) as import("@spectron/shared").HistoryChanges,
      });
      const checkpoint = {
        integrationId: c.id,
        entityType: "issue" as const,
        localId: row.id,
        externalId: String(remote.id),
        externalKey: remote.key,
        localUpdatedAt: row.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
      };
      await tx
        .insert(entity)
        .values(checkpoint)
        .onConflictDoUpdate({
          target: [entity.integrationId, entity.entityType, entity.localId],
          set: checkpoint,
        });
      return row.id;
    });
  }
  async function importComments(
    actor: string,
    c: Config,
    client: YandexTrackerClient,
    remote: YTIssue,
    issueId: string,
    overwriteConflicts: boolean,
  ) {
    for (const comment of await client.getComments(remote.key))
      await db.transaction(async (tx) => {
        await issueAccess(tx, actor, c.projectId, true, true);
        const [parent] = await tx
          .select()
          .from(issue)
          .where(eq(issue.id, issueId));
        if (parent?.deletedAt) return;
        const externalId = `${remote.id}:${comment.id}`;
        const [link] = await tx
          .select()
          .from(entity)
          .where(
            and(
              eq(entity.integrationId, c.id),
              eq(entity.entityType, "comment"),
              eq(entity.externalId, externalId),
            ),
          );
        const markerId = comment.text.match(
          /<!-- spectron-comment:([^>]+) -->/,
        )?.[1];
        if (!link && markerId) {
          const [pending] = await tx
            .select()
            .from(issueComment)
            .where(
              and(
                eq(issueComment.id, markerId),
                eq(issueComment.issueId, issueId),
                isNull(issueComment.externalId),
              ),
            );
          if (pending) {
            if (plain(pending.body) !== stripMarker(comment.text))
              throw new IssueConflictError(
                `${remote.key}: an unsynced comment has local changes. Push it before importing.`,
              );
            await tx.insert(entity).values({
              integrationId: c.id,
              entityType: "comment",
              localId: pending.id,
              externalId,
              externalKey: String(comment.id),
              localUpdatedAt: pending.updatedAt,
              remoteUpdatedAt: comment.updatedAt,
            });
            await tx
              .update(issueComment)
              .set({
                externalId: String(comment.id),
                updatedAt: sql`${issueComment.updatedAt}`,
              })
              .where(eq(issueComment.id, pending.id));
            return;
          }
        }
        const [current] = link
          ? await tx
              .select()
              .from(issueComment)
              .where(eq(issueComment.id, link.localId))
          : [];
        if (
          current?.deletedAt ||
          (!overwriteConflicts && link?.remoteUpdatedAt === comment.updatedAt)
        )
          return;
        if (
          !overwriteConflicts &&
          current &&
          link &&
          current.updatedAt.getTime() !== link.localUpdatedAt.getTime()
        )
          throw new IssueConflictError(
            `A comment on ${remote.key} has local edits.`,
          );
        const body: CommentBody = [
          { type: "text", text: stripMarker(comment.text) },
        ];
        const now = new Date(
          Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1),
        );
        const [row] = current
          ? await tx
              .update(issueComment)
              .set({ body, updatedAt: now })
              .where(eq(issueComment.id, current.id))
              .returning()
          : await tx
              .insert(issueComment)
              .values({
                projectId: c.projectId,
                issueId,
                createdAt: new Date(comment.createdAt),
                authorId:
                  c.mappings.users[String(comment.createdBy.id)] ?? actor,
                body,
                externalId: String(comment.id),
              })
              .returning();
        const values = {
          integrationId: c.id,
          entityType: "comment" as const,
          localId: row!.id,
          externalId,
          externalKey: String(comment.id),
          localUpdatedAt: row!.updatedAt,
          remoteUpdatedAt: comment.updatedAt,
        };
        await tx
          .insert(entity)
          .values(values)
          .onConflictDoUpdate({
            target: [entity.integrationId, entity.entityType, entity.localId],
            set: values,
          });
        await tx.insert(schema.issueHistory).values({
          issueId,
          entityType: "comment",
          entityId: row!.id,
          actorUserId: actor,
          action: current ? "updated" : "created",
          changes: { body: { before: current?.body ?? null, after: body } },
        });
      });
  }
  return {
    async get(actor: string, projectId: string) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, actor, projectId, false, true);
        const [c] = await tx
          .select()
          .from(integration)
          .where(eq(integration.projectId, projectId));
        if (!c) return null;
        return {
          organizationId: c.organizationId,
          organizationType: c.organizationType,
          queue: c.queue,
          mappings: c.mappings,
          hasToken: true,
        };
      });
    },
    async save(actor: string, input: TrackerInput) {
      return db.transaction(async (tx) => {
        await lock(tx, input.projectId);
        await issueAccess(tx, actor, input.projectId, true, true);
        await validateMappings(tx, input.projectId, input.mappings);
        const [old] = await tx
          .select()
          .from(integration)
          .where(eq(integration.projectId, input.projectId));
        if (
          old &&
          (old.queue !== input.queue ||
            old.organizationId !== input.organizationId ||
            old.organizationType !== input.organizationType)
        ) {
          const [synced] = await tx
            .select({ localId: entity.localId })
            .from(entity)
            .where(eq(entity.integrationId, old.id))
            .limit(1);
          if (synced)
            throw new IssueInputError(
              "This connection has synced records. Keep its organization and queue, or connect another queue in a separate project.",
            );
          await tx
            .update(project)
            .set({ externalId: null })
            .where(eq(project.id, input.projectId));
        }
        const token = input.token ? sealToken(input.token, secret) : old?.token;
        if (!token) throw new IssueInputError("Enter an OAuth token.");
        const values = { ...input, token };
        await tx
          .insert(integration)
          .values(values)
          .onConflictDoUpdate({ target: integration.projectId, set: values });
        for (const [kind, table] of [
          ["statuses", issueState],
          ["priorities", issuePriority],
          ["fields", projectField],
        ] as const) {
          await tx
            .update(table)
            .set({ externalId: null })
            .where(eq(table.projectId, input.projectId));
          for (const [remote, local] of Object.entries(input.mappings[kind]))
            if (local)
              await tx
                .update(table)
                .set({ externalId: remote })
                .where(eq(table.id, local));
        }
        // User identities are integration-scoped in mappings; never overwrite another organization's identity.
        for (const [remote, local] of Object.entries(input.mappings.users))
          if (local)
            await tx
              .update(user)
              .set({ externalId: remote })
              .where(and(eq(user.id, local), isNull(user.externalId)));
        return { saved: true };
      });
    },
    async metadata(actor: string, projectId: string) {
      const c = await db.transaction((tx) => config(tx, actor, projectId));
      const client = factory(c);
      const queue = await client.getQueue(c.queue);
      await db.transaction(async (tx) => {
        await issueAccess(tx, actor, projectId, true, true);
        await tx
          .update(project)
          .set({ externalId: String(queue.id) })
          .where(eq(project.id, projectId));
      });
      const [statuses, priorities, fields, localFields, users] =
        await Promise.all([
          client.getQueueStatuses(c.queue),
          client.getPriorities(),
          client.getFields(),
          client.getQueueFields(c.queue),
          client.getUsers(),
        ]);
      return {
        statuses,
        priorities,
        fields: [...fields, ...localFields],
        users,
      };
    },
    async run(
      actor: string,
      projectId: string,
      direction: "import" | "push",
      overwriteConflicts = false,
    ) {
      // Reserve pool capacity for the independently committed entity transactions.
      if (activeSyncs >= 3)
        throw new IssueConflictError(
          "Three sync operations are already running. Try again shortly.",
        );
      activeSyncs++;
      try {
        // Keep a cross-process advisory lock while committing each entity independently.
        return await db.transaction(async (guard) => {
          await lock(guard, projectId);
          const c = await db.transaction(async (tx) => {
            const saved = await config(tx, actor, projectId);
            await validateMappings(tx, projectId, saved.mappings);
            return saved;
          });
          const client = factory(c);
          let processed = 0;
          const errors: string[] = [];
          if (direction === "import") {
            for (let page = 1; ; page++) {
              const result = await client.getIssuesPaginated({
                queue: c.queue,
                page,
              });
              for (const remote of result.issues) {
                try {
                  const id = await importIssue(
                    actor,
                    c,
                    remote,
                    overwriteConflicts,
                  );
                  await importComments(
                    actor,
                    c,
                    client,
                    remote,
                    id,
                    overwriteConflicts,
                  );
                  processed++;
                } catch (error) {
                  errors.push(
                    error instanceof IssueInputError ||
                      error instanceof IssueConflictError
                      ? error.message
                      : `${remote.key}: import failed. Retry after checking Tracker access.`,
                  );
                }
              }
              if (!result.hasMore) break;
            }
          } else {
            const rows = await db
              .select()
              .from(issue)
              .where(
                and(eq(issue.projectId, projectId), isNull(issue.deletedAt)),
              );
            for (const row of rows) {
              try {
                await db.transaction((tx) => config(tx, actor, projectId));
                const [link] = await db
                  .select()
                  .from(entity)
                  .where(identity(c, "issue", row.id));
                let remote = link
                  ? await client.getIssue(link.externalKey!)
                  : undefined;
                if (
                  overwriteConflicts ||
                  !link ||
                  row.updatedAt.getTime() !== link.localUpdatedAt.getTime()
                ) {
                  if (
                    !overwriteConflicts &&
                    remote &&
                    link &&
                    remote.updatedAt !== link.remoteUpdatedAt
                  )
                    throw new IssueConflictError(
                      `${row.externalKey}: Tracker changed. Import before pushing; resolve simultaneous edits first.`,
                    );
                  const status = reverseMapping(
                    c.mappings.statuses,
                    row.stateId,
                  );
                  if (!status)
                    throw new IssueInputError(
                      `${row.title}: map its status before pushing.`,
                    );
                  const payload: YTIssueUpdate = {
                    summary: row.title,
                    description: row.description,
                  };
                  if (row.priorityId) {
                    const id = reverseMapping(
                      c.mappings.priorities,
                      row.priorityId,
                    );
                    if (!id)
                      throw new IssueInputError(
                        `${row.title}: map its priority.`,
                      );
                    payload.priority = { id };
                  } else if (
                    remote &&
                    c.mappings.priorities[String(remote.priority?.id)]
                  )
                    payload.priority = null;
                  if (row.assigneeId) {
                    const id = reverseMapping(c.mappings.users, row.assigneeId);
                    if (!id)
                      throw new IssueInputError(
                        `${row.title}: map its assignee.`,
                      );
                    payload.assignee = { id };
                  } else if (
                    remote?.assignee &&
                    c.mappings.users[String(remote.assignee.id)]
                  )
                    payload.assignee = null;
                  const fields = await db
                    .select()
                    .from(projectField)
                    .where(
                      and(
                        eq(projectField.projectId, projectId),
                        isNull(projectField.deletedAt),
                      ),
                    );
                  for (const [key, id] of Object.entries(c.mappings.fields))
                    if (id) {
                      const value = row.fieldValues[id] ?? null;
                      if (
                        fields.find((f) => f.id === id)?.type === "user" &&
                        value !== null
                      ) {
                        const remoteUser = reverseMapping(
                          c.mappings.users,
                          String(value),
                        );
                        if (!remoteUser)
                          throw new IssueInputError(
                            `${row.title}: map the user in field ${key}.`,
                          );
                        payload[key] = { id: remoteUser };
                      } else payload[key] = value;
                    }
                  if (remote)
                    remote = await client.updateIssue(
                      remote.key,
                      payload,
                      remote.version,
                    );
                  else {
                    // A stable unique value allows recovery when the create response is lost.
                    remote = await client.findByUnique(row.id);
                    if (!remote)
                      remote = await client.createIssue({
                        ...payload,
                        queue: c.queue,
                        summary: row.title,
                        unique: row.id,
                      } as Parameters<YandexTrackerClient["createIssue"]>[0]);
                  }
                  // Persist identity before the separate transition call, even if the transition fails.
                  await checkpoint(c, "issue", row.id, new Date(0), remote);
                  if (
                    String(remote.status?.id) !== status &&
                    remote.status?.key !== status
                  ) {
                    const transitions = await client.getTransitions(remote.key);
                    const transition = transitions.find(
                      (t) => String(t.to.id) === status || t.to.key === status,
                    );
                    if (!transition)
                      throw new IssueInputError(
                        `${remote.key}: no transition to the mapped status is available.`,
                      );
                    await client.executeTransition(remote.key, transition.id);
                    remote = await client.getIssue(remote.key);
                  }
                  await checkpoint(c, "issue", row.id, row.updatedAt, remote);
                }
                if (!remote) continue;
                const remoteComments = await client.getComments(remote.key);
                const comments = await db
                  .select()
                  .from(issueComment)
                  .where(
                    and(
                      eq(issueComment.issueId, row.id),
                      isNull(issueComment.deletedAt),
                    ),
                  );
                for (const comment of comments) {
                  const [cl] = await db
                    .select()
                    .from(entity)
                    .where(identity(c, "comment", comment.id));
                  if (
                    !overwriteConflicts &&
                    cl &&
                    cl.localUpdatedAt.getTime() === comment.updatedAt.getTime()
                  )
                    continue;
                  let rc = cl
                    ? remoteComments.find(
                        (r) => String(r.id) === cl.externalKey,
                      )
                    : remoteComments.find((r) =>
                        r.text.includes(marker(comment.id)),
                      );
                  if (
                    cl &&
                    (!rc ||
                      (!overwriteConflicts &&
                        rc.updatedAt !== cl.remoteUpdatedAt))
                  )
                    throw new IssueConflictError(
                      `${remote.key}: comment changed in Tracker. Import before pushing.`,
                    );
                  const text = `${plain(comment.body)}\n${marker(comment.id)}`;
                  rc = rc
                    ? await client.updateComment(
                        remote.key,
                        String(rc.id),
                        text,
                      )
                    : await client.createComment(remote.key, text);
                  await db.transaction(async (tx) => {
                    const values = {
                      integrationId: c.id,
                      entityType: "comment" as const,
                      localId: comment.id,
                      externalId: `${remote!.id}:${rc!.id}`,
                      externalKey: String(rc!.id),
                      localUpdatedAt: comment.updatedAt,
                      remoteUpdatedAt: rc!.updatedAt,
                    };
                    await tx
                      .insert(entity)
                      .values(values)
                      .onConflictDoUpdate({
                        target: [
                          entity.integrationId,
                          entity.entityType,
                          entity.localId,
                        ],
                        set: values,
                      });
                    await tx
                      .update(issueComment)
                      .set({
                        externalId: String(rc!.id),
                        updatedAt: sql`${issueComment.updatedAt}`,
                      })
                      .where(eq(issueComment.id, comment.id));
                  });
                }
                processed++;
              } catch (error) {
                errors.push(
                  error instanceof IssueInputError ||
                    error instanceof IssueConflictError
                    ? error.message
                    : `${row.title}: push failed. Retry after checking Tracker access.`,
                );
              }
            }
          }
          return { processed, errors };
        });
      } finally {
        activeSyncs--;
      }
    },
  };
}
export type TrackerService = ReturnType<typeof createTrackerService>;
