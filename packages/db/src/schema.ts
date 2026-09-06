import { createId, issueTriggers, type HistoryChanges } from "@spectron/shared";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  integer,
  bigint,
  primaryKey,
  pgEnum,
  jsonb,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";

const dates = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  ...dates(),
});

export const session = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...dates(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

// Credential passwords live here; this also leaves room for later OAuth providers.
export const account = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    ...dates(),
  },
  (table) => [
    index("accounts_user_idx").on(table.userId),
    uniqueIndex("accounts_provider_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verification = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...dates(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const rateLimit = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;

export const projectColor = pgEnum("project_color", ["blue", "slate", "sand"]);
export const projectRole = pgEnum("project_role", ["owner", "member"]);

export const projectState = pgEnum("project_state", ["active", "archived"]);
export const invitationStatus = pgEnum("invitation_status", [
  "sending",
  "pending",
  "accepted",
  "cancelled",
  "expired",
  "failed",
]);

export const project = pgTable("projects", {
  id: text("id").$defaultFn(createId).primaryKey(),
  name: text("name").notNull(),
  key: text("key").notNull(),
  state: projectState("state").default("active").notNull(),
  color: projectColor("color").default("blue").notNull(),
  url: text("url"),
  logo: text("logo"),
  issueCounter: integer("issue_counter").default(0).notNull(),
  ...dates(),
});

export const projectMember = pgTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_members_user_idx").on(table.userId),
  ],
);

export type Project = typeof project.$inferSelect;
export type ProjectMember = typeof projectMember.$inferSelect;

export const projectInvitation = pgTable(
  "project_invitations",
  {
    id: text("id").$defaultFn(createId).primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedBy: text("invited_by").references(() => user.id, {
      onDelete: "set null",
    }),
    tokenHash: text("token_hash").notNull().unique(),
    status: invitationStatus("status").default("sending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...dates(),
  },
  (table) => [
    index("project_invitations_project_idx").on(table.projectId),
    uniqueIndex("project_invitations_pending_unique")
      .on(table.projectId, table.email)
      .where(sql`${table.status} in ('sending', 'pending')`),
  ],
);

export const issueTrigger = pgEnum("issue_trigger", issueTriggers);
const optionFields = () => ({
  id: text("id").$defaultFn(createId).primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  color: text("color"),
  ...dates(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
export const issueState = pgTable(
  "issue_states",
  {
    ...optionFields(),
    trigger: issueTrigger("trigger").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
  },
  (t) => [
    uniqueIndex("issue_states_project_id_unique").on(t.projectId, t.id),
    uniqueIndex("issue_states_default_unique")
      .on(t.projectId)
      .where(sql`${t.isDefault} AND ${t.deletedAt} IS NULL`),
    check(
      "issue_states_default_opened",
      sql`NOT ${t.isDefault} OR (${t.trigger} = 'opened' AND ${t.deletedAt} IS NULL)`,
    ),
  ],
);
export const issuePriority = pgTable(
  "issue_priorities",
  optionFields(),
  (t) => [
    uniqueIndex("issue_priorities_project_id_unique").on(t.projectId, t.id),
  ],
);
export const issue = pgTable(
  "issues",
  {
    id: text("id").$defaultFn(createId).primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    parentId: text("parent_id"),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    stateId: text("state_id").notNull(),
    priorityId: text("priority_id"),
    ...dates(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("issues_project_number_unique").on(t.projectId, t.number),
    uniqueIndex("issues_project_id_unique").on(t.projectId, t.id),
    index("issues_parent_idx").on(t.parentId),
    check("issues_number_positive", sql`${t.number} > 0`),
    check(
      "issues_parent_not_self",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    foreignKey({
      columns: [t.projectId, t.parentId],
      foreignColumns: [t.projectId, t.id],
      name: "issues_parent_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.projectId, t.stateId],
      foreignColumns: [issueState.projectId, issueState.id],
      name: "issues_state_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.projectId, t.priorityId],
      foreignColumns: [issuePriority.projectId, issuePriority.id],
      name: "issues_priority_fk",
    }).onDelete("restrict"),
  ],
);
export const issueHistory = pgTable(
  "issue_history",
  {
    id: text("id").$defaultFn(createId).primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "restrict" }),
    entityType: text("entity_type").$type<"issue" | "attachment">().default("issue").notNull(),
  entityId: text("entity_id"),
  actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    action: text("action")
      .$type<"created" | "updated" | "deleted" | "restored">()
      .notNull(),
    changes: jsonb("changes").$type<HistoryChanges>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("issue_history_issue_idx").on(t.issueId, t.createdAt)],
);
export const projectHistory = pgTable(
  "project_history",
  {
    id: text("id").$defaultFn(createId).primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    entityId: text("entity_id").notNull(),
    entityType: text("entity_type").notNull(),
    changes: jsonb("changes").$type<HistoryChanges>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("project_history_project_idx").on(t.projectId, t.createdAt)],
);

export const fileStatus = pgEnum("file_status", ["pending", "ready", "failed"]);
export const storedFile = pgTable("files", {
  id: text("id").$defaultFn(createId).primaryKey(),
  uploadedBy: text("uploaded_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  storageKey: text("storage_key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").default("application/octet-stream").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).default(0).notNull(),
  status: fileStatus("status").default("pending").notNull(),
  ...dates(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
export const projectFile = pgTable("project_files", {
  id: text("id").$defaultFn(createId).primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "restrict" }),
  fileId: text("file_id").notNull().references(() => storedFile.id, { onDelete: "restrict" }),
  ...dates(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("project_files_project_file_unique").on(t.projectId, t.fileId),
  uniqueIndex("project_files_project_id_unique").on(t.projectId, t.id),
]);
export const issueAttachment = pgTable("issue_attachments", {
  id: text("id").$defaultFn(createId).primaryKey(),
  projectId: text("project_id").notNull(),
  issueId: text("issue_id").notNull(),
  projectFileId: text("project_file_id").notNull(),
  position: integer("position").notNull(),
  ...dates(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("issue_attachments_issue_file_unique").on(t.issueId, t.projectFileId),
  foreignKey({ name: "issue_attachments_issue_fk", columns: [t.projectId, t.issueId], foreignColumns: [issue.projectId, issue.id] }).onDelete("restrict"),
  foreignKey({ name: "issue_attachments_project_file_fk", columns: [t.projectId, t.projectFileId], foreignColumns: [projectFile.projectId, projectFile.id] }).onDelete("restrict"),
]);
