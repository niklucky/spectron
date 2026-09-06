import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  normalizeProjectURL,
  type CreateProjectInput,
  type ProjectSummary,
} from "@spectron/shared";
import { seedIssueSettings, IssueInputError } from "./issues";
import { normalizeLogoDataURL } from "./project-logo/images";

const { project, projectMember } = schema;
export class ProjectAccessError extends Error {}

export function createProjectService(db: Database) {
  const summary = (
    row: typeof project.$inferSelect,
    role: "owner" | "member",
  ): ProjectSummary => ({
    id: row.id,
    name: row.name,
    key: row.key,
    url: row.url,
    logo: row.logo,
    state: row.state,
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  return {
    async list(userId: string) {
      const rows = await db
        .select({ project, role: projectMember.role })
        .from(projectMember)
        .innerJoin(project, eq(project.id, projectMember.projectId))
        .where(eq(projectMember.userId, userId))
        .orderBy(asc(project.createdAt), asc(project.id));
      return rows.map((row) => summary(row.project, row.role));
    },
    async get(userId: string, id: string) {
      const [row] = await db
        .select({ project, role: projectMember.role })
        .from(projectMember)
        .innerJoin(project, eq(project.id, projectMember.projectId))
        .where(and(eq(projectMember.userId, userId), eq(project.id, id)));
      if (!row) throw new ProjectAccessError("Project not found.");
      return summary(row.project, row.role);
    },
    async create(userId: string, input: CreateProjectInput) {
      const values = {
        ...input,
        url: normalizeProjectURL(input.url || null),
        logo: await normalizeLogoDataURL(input.logo || null),
      };
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(project).values(values).returning();
        await tx
          .insert(projectMember)
          .values({ projectId: row!.id, userId, role: "owner" });
        await seedIssueSettings(tx, row!.id);
        return summary(row!, "owner");
      });
    },
    async archive(userId: string, id: string) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(project)
          .where(eq(project.id, id))
          .for("update");
        const [owner] = await tx
          .select()
          .from(projectMember)
          .where(
            and(
              eq(projectMember.projectId, id),
              eq(projectMember.userId, userId),
              eq(projectMember.role, "owner"),
            ),
          );
        if (!row || !owner)
          throw new ProjectAccessError("Project not found or not editable.");
        const [archived] = await tx
          .update(project)
          .set({ state: "archived" })
          .where(eq(project.id, id))
          .returning();
        await tx
          .update(schema.projectInvitation)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(schema.projectInvitation.projectId, id),
              inArray(schema.projectInvitation.status, ["sending", "pending"]),
            ),
          );
        return summary(archived!, "owner");
      });
    },
    async update(userId: string, id: string, input: CreateProjectInput) {
      const logo = await normalizeLogoDataURL(input.logo || null);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(project)
          .where(eq(project.id, id))
          .for("update");
        const [owner] = await tx
          .select()
          .from(projectMember)
          .where(
            and(
              eq(projectMember.projectId, id),
              eq(projectMember.userId, userId),
              eq(projectMember.role, "owner"),
            ),
          )
          .for("share");
        if (!row || !owner || row.state !== "active")
          throw new ProjectAccessError("Project not found or not editable.");
        if (input.key !== row.key)
          throw new IssueInputError(
            "Project prefixes are locked after creation.",
          );
        const [updated] = await tx
          .update(project)
          .set({
            name: input.name,
            url: normalizeProjectURL(input.url || null),
            logo,
          })
          .where(eq(project.id, id))
          .returning();
        return summary(updated!, "owner");
      });
    },
  };
}
export type ProjectService = ReturnType<typeof createProjectService>;
