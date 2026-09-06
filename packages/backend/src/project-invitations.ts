import { randomBytes, createHash } from "node:crypto";
import { and, eq, inArray, lte, desc, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type {
  InvitationSummary,
  InvitationPreview,
  ProjectMemberSummary,
} from "@spectron/shared";
import { ProjectAccessError } from "./projects";

const { project, projectMember, projectInvitation: invitation, user } = schema;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type InvitationEmail = {
  to: string;
  url: string;
  projectName: string;
  inviterName: string;
  invitationId: string;
};
export type InvitationConfig = {
  appURL: string;
  sendInvitationEmail: (email: InvitationEmail) => Promise<void>;
};
export class InvitationError extends Error {}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const summary = (row: typeof invitation.$inferSelect): InvitationSummary => ({
  id: row.id,
  email: row.email,
  status:
    ["sending", "pending"].includes(row.status) && row.expiresAt <= new Date()
      ? "expired"
      : row.status,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

export function createInvitationService(
  db: Database,
  config: InvitationConfig,
) {
  async function access(
    tx: Database | Transaction,
    userId: string,
    projectId: string,
    owner = false,
  ) {
    const [row] = await tx
      .select({ project, role: projectMember.role })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.userId, userId),
        ),
      );
    if (!row || (owner && row.role !== "owner"))
      throw new ProjectAccessError("Project not found or not editable.");
    if (row.project.state === "archived")
      throw new InvitationError("This project is archived.");
    return row.project;
  }
  // All invitation writes lock the project first, then the invitation. This
  // serializes acceptance, cancellation and archive without deadlocks.
  async function lockProject(tx: Transaction, id: string) {
    await tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, id))
      .for("update");
  }
  async function invitationForUser(
    tx: Database | Transaction,
    userId: string,
    token: string,
  ) {
    const [row] = await tx
      .select({ invitation, project, email: user.email })
      .from(invitation)
      .innerJoin(project, eq(project.id, invitation.projectId))
      .innerJoin(user, eq(user.id, userId))
      .where(eq(invitation.tokenHash, digest(token)));
    if (!row || row.invitation.email !== row.email.toLowerCase())
      throw new InvitationError(
        "This invitation is unavailable. Sign in with the email address it was sent to.",
      );
    if (
      row.project.state !== "active" ||
      !["pending", "accepted"].includes(row.invitation.status) ||
      (row.invitation.status === "pending" &&
        row.invitation.expiresAt <= new Date())
    )
      throw new InvitationError(
        "This invitation has expired or is no longer available.",
      );
    return row;
  }
  return {
    async members(
      userId: string,
      projectId: string,
    ): Promise<ProjectMemberSummary[]> {
      await access(db, userId, projectId);
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: projectMember.role,
          joinedAt: projectMember.createdAt,
        })
        .from(projectMember)
        .innerJoin(user, eq(user.id, projectMember.userId))
        .where(eq(projectMember.projectId, projectId))
        .orderBy(projectMember.createdAt);
      return rows.map((row) => ({
        ...row,
        joinedAt: row.joinedAt.toISOString(),
      }));
    },
    async list(userId: string, projectId: string) {
      await access(db, userId, projectId, true);
      return (
        await db
          .select()
          .from(invitation)
          .where(eq(invitation.projectId, projectId))
          .orderBy(desc(invitation.createdAt))
      ).map(summary);
    },
    async invite(userId: string, projectId: string, email: string) {
      email = email.trim().toLowerCase();
      const token = randomBytes(32).toString("hex");
      const created = await db.transaction(async (tx) => {
        await lockProject(tx, projectId);
        const target = await access(tx, userId, projectId, true);
        const [inviter] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, userId));
        const [member] = await tx
          .select({ id: user.id })
          .from(projectMember)
          .innerJoin(user, eq(user.id, projectMember.userId))
          .where(
            and(
              eq(projectMember.projectId, projectId),
              sql`lower(${user.email}) = ${email}`,
            ),
          );
        if (member)
          throw new InvitationError("This person is already a project member.");
        await tx
          .update(invitation)
          .set({ status: "expired" })
          .where(
            and(
              eq(invitation.projectId, projectId),
              inArray(invitation.status, ["pending", "sending"]),
              lte(invitation.expiresAt, new Date()),
            ),
          );
        const [pending] = await tx
          .select({ id: invitation.id })
          .from(invitation)
          .where(
            and(
              eq(invitation.projectId, projectId),
              eq(invitation.email, email),
              inArray(invitation.status, ["pending", "sending"]),
            ),
          );
        if (pending)
          throw new InvitationError(
            "An invitation is already pending for this email.",
          );
        // Bound outbound email volume per project, including failed deliveries.
        const [recent] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(invitation)
          .where(
            and(
              eq(invitation.projectId, projectId),
              sql`${invitation.createdAt} > now() - interval '1 hour'`,
            ),
          );
        if ((recent?.count || 0) >= 50)
          throw new InvitationError(
            "Invitation limit reached. Try again in an hour.",
          );
        const [row] = await tx
          .insert(invitation)
          .values({
            projectId,
            email,
            invitedBy: userId,
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + 7 * 86400_000),
          })
          .returning();
        return { row: row!, target, inviterName: inviter!.name };
      });
      try {
        await config.sendInvitationEmail({
          to: email,
          projectName: created.target.name,
          inviterName: created.inviterName,
          invitationId: created.row.id,
          url: `${config.appURL}/#invite/${token}`,
        });
      } catch {
        await db
          .update(invitation)
          .set({ status: "failed" })
          .where(
            and(
              eq(invitation.id, created.row.id),
              eq(invitation.status, "sending"),
            ),
          );
        throw new InvitationError(
          "The invitation email couldn’t be sent. Please try again.",
        );
      }
      const [sent] = await db
        .update(invitation)
        .set({ status: "pending" })
        .where(
          and(
            eq(invitation.id, created.row.id),
            eq(invitation.status, "sending"),
          ),
        )
        .returning();
      if (!sent)
        throw new InvitationError(
          "This invitation was cancelled while the email was being sent.",
        );
      return summary(sent);
    },
    async cancel(userId: string, projectId: string, id: string) {
      return db.transaction(async (tx) => {
        await lockProject(tx, projectId);
        await access(tx, userId, projectId, true);
        const [row] = await tx
          .update(invitation)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(invitation.id, id),
              eq(invitation.projectId, projectId),
              inArray(invitation.status, ["pending", "sending"]),
            ),
          )
          .returning();
        if (!row)
          throw new InvitationError("This invitation is no longer pending.");
        return summary(row);
      });
    },
    async preview(userId: string, token: string): Promise<InvitationPreview> {
      const row = await invitationForUser(db, userId, token);
      return {
        projectId: row.project.id,
        projectName: row.project.name,
        logo: row.project.logo,
        status: row.invitation.status as "pending" | "accepted",
      };
    },
    async accept(userId: string, token: string) {
      return db.transaction(async (tx) => {
        const initial = await invitationForUser(tx, userId, token);
        await lockProject(tx, initial.project.id);
        const row = await invitationForUser(tx, userId, token);
        if (row.invitation.status === "accepted") {
          const [member] = await tx
            .select()
            .from(projectMember)
            .where(
              and(
                eq(projectMember.projectId, row.project.id),
                eq(projectMember.userId, userId),
              ),
            );
          if (!member)
            throw new InvitationError("This invitation has already been used.");
          return { projectId: row.project.id };
        }
        await tx
          .insert(projectMember)
          .values({ projectId: row.project.id, userId, role: "member" })
          .onConflictDoNothing();
        await tx
          .update(invitation)
          .set({ status: "accepted" })
          .where(eq(invitation.id, row.invitation.id));
        return { projectId: row.project.id };
      });
    },
  };
}
export type InvitationService = ReturnType<typeof createInvitationService>;
