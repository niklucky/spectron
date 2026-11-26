/**
 * Read models and name resolution for the public API (/api/v1).
 *
 * Writes still go through the issue, comment and file services so history,
 * validation and Jira/Tracker export behave exactly as for edits in the app.
 * This module only translates the agent-friendly vocabulary (issue keys,
 * status names, emails, "me") into application ids and back.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Database } from "@spectron/db";
import {
  applicationIdPattern,
  issueTimestamp,
  type IssueFields,
  type IssueTrigger,
} from "@spectron/shared";
import { IssueInputError } from "./issues";
import { ProjectAccessError } from "./projects";

const {
  project,
  projectMember,
  issue,
  issueState,
  issuePriority,
  issueType,
  tag,
  issueTag,
  user,
  externalIdentity,
  projectField,
} = schema;

export const issueSortFields = ["created", "updated", "due", "start", "key"] as const;
export type IssueSortField = (typeof issueSortFields)[number];
export type IssueSearch = {
  projects?: string[] | undefined;
  statuses?: string[] | undefined;
  categories?: IssueTrigger[] | undefined;
  assignee?: string | undefined;
  q?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
  updatedAfter?: Date | undefined;
  updatedBefore?: Date | undefined;
  dueAfter?: Date | undefined;
  dueBefore?: Date | undefined;
  startAfter?: Date | undefined;
  startBefore?: Date | undefined;
  includeDeleted?: boolean | undefined;
  sort: IssueSortField;
  order: "asc" | "desc";
  limit: number;
  offset: number;
};
/** Agent-facing issue fields: names instead of ids wherever a person would use one. */
export type PublicIssueInput = {
  title?: string | undefined;
  description?: string | undefined;
  status?: string | undefined;
  priority?: string | null | undefined;
  type?: string | null | undefined;
  assignee?: string | null | undefined;
  parent?: string | null | undefined;
  tags?: string[] | undefined;
  startAt?: string | null | undefined;
  dueAt?: string | null | undefined;
  estimateSeconds?: number | null | undefined;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Current ids, plus UUIDs retained from before the id migration. */
const isId = (value: string) => applicationIdPattern.test(value) || UUID.test(value);
const lower = (value: string) => value.trim().toLowerCase();
const KEY = /^([A-Za-z][A-Za-z0-9_]*)-(\d{1,9})$/;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createPublicApiService(db: Database, appURL: string) {
  const assigneeUser = alias(user, "assignee_user");
  const assigneeIdentity = alias(externalIdentity, "assignee_identity");
  const assigneeLinked = alias(user, "assignee_linked");
  const authorUser = alias(user, "author_user");
  const authorIdentity = alias(externalIdentity, "author_identity");
  const authorLinked = alias(user, "author_linked");
  const parentIssue = alias(issue, "parent_issue");

  const issueURL = (projectId: string, issueId: string) =>
    `${appURL}/#project/${projectId}/issues/${issueId}`;

  async function memberProjects(userId: string) {
    return db
      .select({
        id: project.id,
        key: project.key,
        name: project.name,
        state: project.state,
        role: projectMember.role,
      })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(eq(projectMember.userId, userId))
      .orderBy(asc(project.createdAt), asc(project.id));
  }

  async function resolveProject(userId: string, ref: string) {
    const projects = await memberProjects(userId);
    const byId = projects.find((p) => p.id === ref);
    if (byId) return byId;
    const matches = projects.filter((p) => p.key.toUpperCase() === ref.toUpperCase());
    if (matches.length > 1)
      throw new IssueInputError(
        `Several of your projects use the key ${ref.toUpperCase()}. Use the project id instead.`,
      );
    if (!matches[0]) throw new ProjectAccessError(`Project ${ref} not found.`);
    return matches[0];
  }

  /**
   * Accepts a Spectron key (SP-12) or an issue id. Imported Jira keys are
   * informational only (`jiraKey` in responses) and never resolve an issue.
   */
  async function resolveIssue(userId: string, ref: string, withinProjectId?: string) {
    const projects = (await memberProjects(userId)).filter(
      (p) => !withinProjectId || p.id === withinProjectId,
    );
    const ids = projects.map((p) => p.id);
    if (!ids.length) throw new ProjectAccessError(`Issue ${ref} not found.`);
    const select = {
      id: issue.id,
      projectId: issue.projectId,
      number: issue.number,
      updatedAt: issue.updatedAt,
      deletedAt: issue.deletedAt,
    };
    type Match = { id: string; projectId: string; number: number; updatedAt: Date; deletedAt: Date | null };
    let rows: Match[] = [];
    const raw = ref.trim();
    // Ids first: a 21-character id such as "AbCdEfGhIjKlMnOpQr-12" also
    // matches the key pattern, while keys are at most 20 characters.
    if (isId(raw))
      rows = await db
        .select(select)
        .from(issue)
        .where(and(inArray(issue.projectId, ids), eq(issue.id, raw)));
    const key = KEY.exec(raw);
    if (!rows.length && key) {
      const keyed = projects.filter((p) => p.key.toUpperCase() === key[1]!.toUpperCase());
      if (keyed.length)
        rows = await db
          .select(select)
          .from(issue)
          .where(
            and(
              inArray(issue.projectId, keyed.map((p) => p.id)),
              eq(issue.number, Number(key[2])),
            ),
          );
    }
    if (rows.length > 1)
      throw new IssueInputError(`Several issues match ${ref}. Use the issue id instead.`);
    const row = rows[0];
    if (!row) throw new ProjectAccessError(`Issue ${ref} not found.`);
    const p = projects.find((candidate) => candidate.id === row.projectId)!;
    return { ...row, projectKey: p.key, key: `${p.key}-${row.number}` };
  }

  type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
  async function members(projectId: string, exec: Executor = db) {
    return exec
      .select({ id: user.id, name: user.name, email: user.email, role: projectMember.role })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(eq(projectMember.projectId, projectId))
      .orderBy(asc(user.name));
  }

  /** Loads members once and returns a resolver for many references (e.g. comment mentions). */
  async function personResolver(userId: string, projectId: string) {
    const people = await members(projectId);
    return (ref: string) => findPerson(people, userId, ref);
  }
  /** Finds a project member by id, email or "me"; mentions and assignees use the same rules. */
  async function resolvePerson(userId: string, projectId: string, ref: string) {
    return findPerson(await members(projectId), userId, ref);
  }
  function findPerson(
    people: Awaited<ReturnType<typeof members>>,
    userId: string,
    ref: string,
  ) {
    const wanted = ref === "me" ? userId : ref;
    const person =
      people.find((p) => p.id === wanted) ??
      people.find((p) => p.email.toLowerCase() === lower(wanted));
    if (!person)
      throw new IssueInputError(
        `${ref} is not a member of this project. Use a member id or email from GET /api/v1/projects/{project}.`,
      );
    return person;
  }

  async function options(projectId: string, exec: Executor = db) {
    // Sequential on purpose: inside a transaction every query shares one
    // connection, where concurrent client.query() calls are deprecated in pg.
    const states = await exec.select().from(issueState).where(eq(issueState.projectId, projectId)).orderBy(asc(issueState.position));
    const priorities = await exec.select().from(issuePriority).where(eq(issuePriority.projectId, projectId)).orderBy(asc(issuePriority.position));
    const types = await exec.select().from(issueType).where(eq(issueType.projectId, projectId)).orderBy(asc(issueType.position));
    const tags = await exec.select().from(tag).where(eq(tag.projectId, projectId)).orderBy(asc(tag.name));
    const fields = await exec
      .select()
      .from(projectField)
      .where(and(eq(projectField.projectId, projectId), isNull(projectField.deletedAt)))
      .orderBy(asc(projectField.createdAt));
    return { states, priorities, types, tags, fields };
  }

  function pick<T extends { id: string; name: string; deletedAt: Date | null }>(
    rows: T[],
    ref: string,
    label: string,
  ): T {
    const active = rows.filter((r) => !r.deletedAt);
    const found =
      active.find((r) => r.id === ref) ?? active.find((r) => lower(r.name) === lower(ref));
    if (!found)
      throw new IssueInputError(
        `Unknown ${label} "${ref}". Available: ${active.map((r) => r.name).join(", ") || "none"}.`,
      );
    return found;
  }

  /** Date-only values mean midnight UTC, the same convention as imported Jira due dates. */
  function timestamp(value: string | null | undefined, label: string) {
    if (value === undefined || value === null) return value;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
    if (!Number.isFinite(Date.parse(normalized)))
      throw new IssueInputError(`${label} must be an ISO date or date-time.`);
    return issueTimestamp(normalized);
  }

  return {
    memberProjects,
    resolveProject,
    resolveIssue,
    resolvePerson,
    personResolver,
    members,
    issueURL,

    async projectDetail(userId: string, ref: string) {
      const p = await resolveProject(userId, ref);
      // Hold the caller's membership for the reads so a concurrent removal
      // cannot race them; a removal already committed leaves no row.
      const { states, priorities, types, tags, fields, people } = await db.transaction(async (tx) => {
        const [membership] = await tx
          .select({ userId: projectMember.userId })
          .from(projectMember)
          .where(and(eq(projectMember.projectId, p.id), eq(projectMember.userId, userId)))
          .for("share");
        if (!membership) throw new ProjectAccessError(`Project ${ref} not found.`);
        return { ...(await options(p.id, tx)), people: await members(p.id, tx) };
      });
      const active = <T extends { deletedAt: Date | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
      return {
        ...p,
        statuses: active(states).map((s) => ({
          id: s.id,
          name: s.name,
          category: s.trigger,
          isDefault: s.isDefault,
        })),
        priorities: active(priorities).map(({ id, name }) => ({ id, name })),
        types: active(types).map(({ id, name }) => ({ id, name })),
        tags: active(tags).map(({ id, name }) => ({ id, name })),
        fields: fields.map(({ id, name, type }) => ({ id, name, type })),
        members: people,
      };
    },

    /** Translates names, keys and emails into the ids the issue service validates. */
    async resolveFields(
      userId: string,
      projectId: string,
      input: PublicIssueInput,
    ): Promise<Partial<IssueFields>> {
      const { states, priorities, types, tags } = await options(projectId);
      const out: Partial<IssueFields> = {};
      if (input.title !== undefined) out.title = input.title;
      if (input.description !== undefined) out.description = input.description;
      if (input.status !== undefined) out.stateId = pick(states, input.status, "status").id;
      if (input.priority !== undefined)
        out.priorityId = input.priority === null ? null : pick(priorities, input.priority, "priority").id;
      if (input.type !== undefined)
        out.issueTypeId = input.type === null ? null : pick(types, input.type, "type").id;
      if (input.tags !== undefined) out.tagIds = input.tags.map((t) => pick(tags, t, "tag").id);
      if (input.assignee !== undefined)
        out.assigneeId =
          input.assignee === null ? null : (await resolvePerson(userId, projectId, input.assignee)).id;
      if (input.parent !== undefined) {
        if (input.parent === null) out.parentId = null;
        else {
          // Prefixes can repeat across projects; the parent must share the child's.
          const parent = await resolveIssue(userId, input.parent, projectId).catch((cause: unknown) => {
            throw cause instanceof ProjectAccessError
              ? new IssueInputError(`Parent ${input.parent} was not found in this project.`)
              : cause;
          });
          out.parentId = parent.id;
        }
      }
      const startAt = timestamp(input.startAt, "startAt");
      if (startAt !== undefined) out.startAt = startAt;
      const finishAt = timestamp(input.dueAt, "dueAt");
      if (finishAt !== undefined) out.finishAt = finishAt;
      if (input.estimateSeconds !== undefined) out.estimateTime = input.estimateSeconds;
      return out;
    },

    async search(userId: string, input: IssueSearch) {
      const all = await memberProjects(userId);
      let scope = all;
      if (input.projects?.length) {
        scope = [];
        for (const ref of input.projects) scope.push(await resolveProject(userId, ref));
      }
      if (!scope.length) return { issues: [], nextOffset: null };
      const where: (SQL | undefined)[] = [inArray(issue.projectId, scope.map((p) => p.id))];
      if (!input.includeDeleted) where.push(isNull(issue.deletedAt));
      if (input.statuses?.length)
        where.push(
          or(
            inArray(issueState.id, input.statuses),
            inArray(sql`lower(${issueState.name})`, input.statuses.map(lower)),
          ),
        );
      if (input.categories?.length) where.push(inArray(issueState.trigger, input.categories));
      const assigned = sql`coalesce(${issue.assigneeId}, ${assigneeIdentity.localUserId})`;
      if (input.assignee === "none")
        where.push(and(isNull(issue.assigneeId), isNull(issue.externalAssigneeId)));
      else if (input.assignee === "me") where.push(sql`${assigned} = ${userId}`);
      else if (input.assignee) {
        const [person] = await db
          .select({ id: user.id })
          .from(user)
          .where(or(eq(user.id, input.assignee), sql`lower(${user.email}) = ${lower(input.assignee)}`));
        // Imported people without a Spectron account are returned with their
        // external identity id, so that id must filter too. An unknown
        // reference simply matches nothing; it must not widen the search.
        where.push(
          or(sql`${assigned} = ${person?.id ?? ""}`, eq(issue.externalAssigneeId, input.assignee)),
        );
      }
      if (input.q?.trim()) where.push(ilike(issue.title, `%${escapeLike(input.q.trim())}%`));
      const range = (column: Parameters<typeof gte>[0], after?: Date, before?: Date, text = false) => {
        if (after) where.push(gte(column, text ? after.toISOString() : after));
        if (before) where.push(lt(column, text ? before.toISOString() : before));
      };
      range(issue.createdAt, input.createdAfter, input.createdBefore);
      range(issue.updatedAt, input.updatedAfter, input.updatedBefore);
      range(issue.finishAt, input.dueAfter, input.dueBefore, true);
      range(issue.startAt, input.startAfter, input.startBefore, true);

      const column = {
        created: issue.createdAt,
        updated: issue.updatedAt,
        due: issue.finishAt,
        start: issue.startAt,
        key: issue.number,
      }[input.sort];
      const direction = input.order === "asc" ? asc : desc;
      const keyPrefix = input.sort === "key" ? [direction(project.key)] : [];
      const rows = await baseQuery()
        // Membership is re-checked in the read itself, not only when scoping.
        .innerJoin(
          projectMember,
          and(eq(projectMember.projectId, issue.projectId), eq(projectMember.userId, userId)),
        )
        .where(and(...where))
        .orderBy(
          // Undated issues go last whichever way dates are sorted.
          ...(input.sort === "due" || input.sort === "start" ? [sql`${column} IS NULL`] : []),
          ...keyPrefix,
          direction(column),
          direction(project.id),
          direction(issue.id),
        )
        .limit(input.limit + 1)
        .offset(input.offset);
      const page = rows.slice(0, input.limit);
      return {
        issues: page.map((row) => present(row)),
        nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
      };
    },

    async issue(userId: string, ref: string) {
      const target = await resolveIssue(userId, ref);
      // Re-check membership in the same statement as the read.
      const [row] = await baseQuery()
        .innerJoin(
          projectMember,
          and(eq(projectMember.projectId, issue.projectId), eq(projectMember.userId, userId)),
        )
        .where(eq(issue.id, target.id));
      if (!row) throw new ProjectAccessError(`Issue ${ref} not found.`);
      const [{ fields }, tags] = await Promise.all([
        options(target.projectId),
        db
          .select({ id: tag.id, name: tag.name })
          .from(issueTag)
          .innerJoin(tag, eq(tag.id, issueTag.tagId))
          .where(eq(issueTag.issueId, target.id))
          .orderBy(asc(tag.name)),
      ]);
      const values = row.issue.fieldValues ?? {};
      return {
        ...present(row),
        description: row.issue.description,
        tags: tags.map((t) => t.name),
        fields: Object.fromEntries(
          fields.filter((f) => f.id in values).map((f) => [f.name, values[f.id]]),
        ),
      };
    },
  };

  function baseQuery() {
    return db
      .select({
        issue,
        projectKey: project.key,
        state: { id: issueState.id, name: issueState.name, trigger: issueState.trigger },
        priority: { id: issuePriority.id, name: issuePriority.name },
        type: { id: issueType.id, name: issueType.name },
        assigneeUser: { id: assigneeUser.id, name: assigneeUser.name, email: assigneeUser.email },
        assigneeIdentity: { id: assigneeIdentity.id, name: assigneeIdentity.displayName },
        assigneeLinked: { id: assigneeLinked.id, name: assigneeLinked.name, email: assigneeLinked.email },
        authorUser: { id: authorUser.id, name: authorUser.name, email: authorUser.email },
        authorIdentity: { id: authorIdentity.id, name: authorIdentity.displayName },
        authorLinked: { id: authorLinked.id, name: authorLinked.name, email: authorLinked.email },
        parent: { id: parentIssue.id, number: parentIssue.number },
      })
      .from(issue)
      .innerJoin(project, eq(project.id, issue.projectId))
      .innerJoin(issueState, eq(issueState.id, issue.stateId))
      .leftJoin(issuePriority, eq(issuePriority.id, issue.priorityId))
      .leftJoin(issueType, eq(issueType.id, issue.issueTypeId))
      .leftJoin(assigneeUser, eq(assigneeUser.id, issue.assigneeId))
      .leftJoin(assigneeIdentity, eq(assigneeIdentity.id, issue.externalAssigneeId))
      .leftJoin(assigneeLinked, eq(assigneeLinked.id, assigneeIdentity.localUserId))
      .leftJoin(authorUser, eq(authorUser.id, issue.authorId))
      .leftJoin(authorIdentity, eq(authorIdentity.id, issue.externalAuthorId))
      .leftJoin(authorLinked, eq(authorLinked.id, authorIdentity.localUserId))
      .leftJoin(parentIssue, eq(parentIssue.id, issue.parentId));
  }

  type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>["where"]>>[number];
  function person(
    local: { id: string; name: string; email: string } | null,
    identity: { id: string; name: string } | null,
    linked: { id: string; name: string; email: string } | null,
  ) {
    const resolved = local ?? linked;
    if (resolved) return { id: resolved.id, name: resolved.name, email: resolved.email };
    // Imported people who have not joined Spectron yet.
    if (identity) return { id: identity.id, name: identity.name, email: null };
    return null;
  }
  function present(row: Row) {
    const i = row.issue;
    const projectKey = row.projectKey;
    return {
      id: i.id,
      key: `${projectKey}-${i.number}`,
      jiraKey: i.externalKey,
      project: { id: i.projectId, key: projectKey },
      title: i.title,
      status: { id: row.state.id, name: row.state.name, category: row.state.trigger },
      priority: row.priority,
      type: row.type,
      assignee: person(row.assigneeUser, row.assigneeIdentity, row.assigneeLinked),
      author: person(row.authorUser, row.authorIdentity, row.authorLinked),
      parent: row.parent ? { id: row.parent.id, key: `${projectKey}-${row.parent.number}` } : null,
      startAt: issueTimestamp(i.startAt),
      dueAt: issueTimestamp(i.finishAt),
      estimateSeconds: i.estimateTime,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      deletedAt: i.deletedAt?.toISOString() ?? null,
      url: issueURL(i.projectId, i.id),
    };
  }
}
export type PublicApiService = ReturnType<typeof createPublicApiService>;
export type PublicIssue = Awaited<ReturnType<PublicApiService["issue"]>>;
