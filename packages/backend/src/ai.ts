import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import {
  aiCatalog,
  createId,
  type AIConnectionInput,
  type AIConnectionSummary,
  type AgentIdentity,
  type AgentInput,
  type AgentSharing,
  type AgentSummary,
} from "@spectron/shared";
import { ProjectAccessError } from "./projects";
import { IssueConflictError, IssueInputError } from "./issues";
import { normalizeLogoDataURL } from "./project-logo/images";
import {
  createAICredentialCheck,
  decryptAIKey,
  encryptAIKey,
  type AICredentialCheck,
} from "./ai-credentials";

const {
  aiConnection: connection,
  aiAgent: agent,
  aiAgentShare: share,
  aiAgentShareMember: grant,
  projectMember: membership,
  project,
  user,
} = schema;
type Connection = typeof connection.$inferSelect;
type Agent = typeof agent.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const binding = (row: Pick<Connection, "ownerId" | "id" | "provider">) =>
  JSON.stringify([row.ownerId, row.id, row.provider]);
const connectionSummary = (row: Connection): AIConnectionSummary => ({
  id: row.id,
  ownerId: row.ownerId,
  name: row.name,
  provider: row.provider,
  revision: row.revision,
  keyUpdatedAt: row.keyUpdatedAt.toISOString(),
  checkedAt: row.checkedAt?.toISOString() ?? null,
  checkStatus: row.checkStatus,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const identity = (
  row: Agent,
  provider: Connection["provider"],
  ownerName: string,
): AgentIdentity => ({
  kind: "agent",
  id: row.id,
  ownerId: row.ownerId,
  ownerName,
  name: row.name,
  avatar: row.avatar,
  role: row.role,
  provider,
  model: row.model,
  effort: row.effort,
});
const activeOwned = (ownerId: string, id: string) =>
  and(eq(agent.id, id), eq(agent.ownerId, ownerId), isNull(agent.deletedAt));
function validateKey(key: string) {
  if (!key || key.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(key))
    throw new IssueInputError(
      "Enter an API key without whitespace (up to 4096 characters).",
    );
}

export function createAIService(
  db: Database,
  secret?: string,
  check: AICredentialCheck = createAICredentialCheck(),
) {
  async function ownConnection(ownerId: string, id: string) {
    const [row] = await db
      .select()
      .from(connection)
      .where(and(eq(connection.id, id), eq(connection.ownerId, ownerId)));
    if (!row) throw new ProjectAccessError("AI connection not found.");
    return row;
  }
  async function lockAgent(tx: Tx, ownerId: string, id: string) {
    const [row] = await tx
      .select()
      .from(agent)
      .where(activeOwned(ownerId, id))
      .for("update");
    if (!row) throw new ProjectAccessError("Agent not found.");
    return row;
  }
  const service = {
    async connections(ownerId: string) {
      return (
        await db
          .select()
          .from(connection)
          .where(eq(connection.ownerId, ownerId))
          .orderBy(asc(connection.createdAt), asc(connection.id))
      ).map(connectionSummary);
    },
    async createConnection(ownerId: string, input: AIConnectionInput) {
      validateKey(input.apiKey);
      const values = {
        id: createId(),
        ownerId,
        provider: input.provider,
        name: input.name,
      };
      const [row] = await db
        .insert(connection)
        .values({
          ...values,
          encryptedKey: encryptAIKey(input.apiKey, binding(values), secret),
        })
        .returning();
      return connectionSummary(row!);
    },
    async updateConnection(
      ownerId: string,
      input: {
        id: string;
        revision: number;
        name: string;
        apiKey?: string | undefined;
      },
    ) {
      const existing = await ownConnection(ownerId, input.id);
      let replacement = {};
      if (input.apiKey !== undefined) {
        validateKey(input.apiKey);
        replacement = {
          encryptedKey: encryptAIKey(input.apiKey, binding(existing), secret),
          keyUpdatedAt: new Date(),
          checkedAt: null,
          checkStatus: "untested",
        };
      }
      const [row] = await db
        .update(connection)
        .set({
          name: input.name,
          ...replacement,
          revision: sql`${connection.revision} + 1`,
        })
        .where(
          and(
            eq(connection.id, input.id),
            eq(connection.ownerId, ownerId),
            eq(connection.revision, input.revision),
          ),
        )
        .returning();
      if (!row)
        throw new IssueConflictError(
          "This connection changed. Reload before saving.",
        );
      return connectionSummary(row);
    },
    async deleteConnection(
      ownerId: string,
      input: { id: string; revision: number },
    ) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(connection)
          .where(
            and(eq(connection.id, input.id), eq(connection.ownerId, ownerId)),
          )
          .for("update");
        if (!row) throw new ProjectAccessError("AI connection not found.");
        if (row.revision !== input.revision)
          throw new IssueConflictError(
            "This connection changed. Reload before deleting.",
          );
        const [used] = await tx
          .select({ id: agent.id })
          .from(agent)
          .where(and(eq(agent.connectionId, row.id), isNull(agent.deletedAt)))
          .limit(1);
        if (used)
          throw new IssueInputError(
            "Move or delete the agents using this connection first.",
          );
        await tx
          .update(agent)
          .set({ connectionId: null })
          .where(eq(agent.connectionId, row.id));
        await tx.delete(connection).where(eq(connection.id, row.id));
      });
    },
    async checkConnection(
      ownerId: string,
      input: { id: string; revision: number },
    ) {
      const row = await ownConnection(ownerId, input.id);
      if (row.revision !== input.revision)
        throw new IssueConflictError(
          "This connection changed. Reload before checking.",
        );
      const key = decryptAIKey(row.encryptedKey, binding(row), secret);
      let message =
        row.provider === "zai"
          ? "GLM-5.3-flash accepted a small test request. Other models and agent execution remain untested."
          : "Credentials accepted by the model-list API. Model generation and agent execution remain untested.";
      let checkStatus: "passed" | "failed" = "passed";
      try {
        await check(row.provider, key);
      } catch (error) {
        checkStatus = "failed";
        message =
          error instanceof IssueInputError
            ? error.message
            : "The connection check could not complete. Try again.";
      }
      // An old check must never mark a concurrently replaced key as tested.
      const [updated] = await db
        .update(connection)
        .set({ checkedAt: new Date(), checkStatus })
        .where(
          and(
            eq(connection.id, row.id),
            eq(connection.ownerId, ownerId),
            eq(connection.revision, row.revision),
          ),
        )
        .returning();
      if (!updated)
        throw new IssueConflictError(
          "The key changed during the check. Check the current connection again.",
        );
      return { connection: connectionSummary(updated), message };
    },
    async agents(ownerId: string): Promise<AgentSummary[]> {
      const rows = await db
        .select({ agent, provider: connection.provider, ownerName: user.name })
        .from(agent)
        .innerJoin(connection, eq(connection.id, agent.connectionId))
        .innerJoin(user, eq(user.id, agent.ownerId))
        .where(and(eq(agent.ownerId, ownerId), isNull(agent.deletedAt)))
        .orderBy(asc(agent.createdAt), asc(agent.id));
      return rows.map(({ agent: row, provider, ownerName }) => ({
        ...identity(row, provider, ownerName),
        connectionId: row.connectionId!,
        instructions: row.instructions,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
    async saveAgent(
      ownerId: string,
      input: AgentInput & { id?: string; revision?: number },
    ) {
      // Authorize before processing uploaded images.
      if (input.id) {
        const [owned] = await db
          .select({ id: agent.id })
          .from(agent)
          .where(activeOwned(ownerId, input.id));
        if (!owned) throw new ProjectAccessError("Agent not found.");
      }
      await ownConnection(ownerId, input.connectionId);
      const avatar = await normalizeLogoDataURL(input.avatar);
      return db.transaction(async (tx) => {
        const [c] = await tx
          .select()
          .from(connection)
          .where(
            and(
              eq(connection.id, input.connectionId),
              eq(connection.ownerId, ownerId),
            ),
          )
          .for("share");
        if (!c) throw new ProjectAccessError("AI connection not found.");
        const model = aiCatalog
          .find((p) => p.id === c.provider)
          ?.models.find((m) => m.id === input.model);
        if (!model)
          throw new IssueInputError(
            "This model is not supported by the selected connection. Choose a listed model.",
          );
        if (
          model.efforts.length
            ? !input.effort || !model.efforts.includes(input.effort)
            : input.effort !== null
        )
          throw new IssueInputError(
            "This effort level is not supported by the selected model.",
          );
        const values = {
          name: input.name,
          avatar,
          connectionId: c.id,
          model: model.id,
          effort: input.effort,
          role: input.role,
          instructions: input.instructions,
        };
        let saved: Agent;
        if (input.id) {
          const existing = await lockAgent(tx, ownerId, input.id);
          if (existing.revision !== input.revision)
            throw new IssueConflictError(
              "This agent changed. Reload before saving.",
            );
          const [updated] = await tx
            .update(agent)
            .set({ ...values, revision: existing.revision + 1 })
            .where(eq(agent.id, existing.id))
            .returning();
          saved = updated!;
        } else {
          const [created] = await tx
            .insert(agent)
            .values({ ...values, ownerId })
            .returning();
          saved = created!;
        }
        return { id: saved.id };
      });
    },
    async deleteAgent(
      ownerId: string,
      input: { id: string; revision: number },
    ) {
      await db.transaction(async (tx) => {
        const row = await lockAgent(tx, ownerId, input.id);
        if (row.revision !== input.revision)
          throw new IssueConflictError(
            "This agent changed. Reload before deleting.",
          );
        await tx.delete(share).where(eq(share.agentId, row.id));
        await tx
          .update(agent)
          .set({ deletedAt: new Date(), revision: row.revision + 1 })
          .where(eq(agent.id, row.id));
      });
    },
    async sharing(ownerId: string, id: string): Promise<AgentSharing[]> {
      return db.transaction(async (tx) => {
        await lockAgent(tx, ownerId, id);
        const shares = await tx
          .select()
          .from(share)
          .where(eq(share.agentId, id));
        const grants = await tx
          .select()
          .from(grant)
          .where(eq(grant.agentId, id));
        return shares.map((s) => ({
          projectId: s.projectId,
          visibility: s.visibility,
          memberIds: grants
            .filter((g) => g.projectId === s.projectId)
            .map((g) => g.userId),
        }));
      });
    },
    async setSharing(
      ownerId: string,
      input: {
        id: string;
        revision: number;
        projectId: string;
        visibility: "private" | "selected" | "project";
        memberIds: string[];
      },
    ) {
      return db.transaction(async (tx) => {
        const row = await lockAgent(tx, ownerId, input.id);
        if (row.revision !== input.revision)
          throw new IssueConflictError(
            "This agent changed. Reload before updating sharing.",
          );
        const [p] = await tx
          .select()
          .from(project)
          .where(
            and(eq(project.id, input.projectId), eq(project.state, "active")),
          )
          .for("share");
        const [owner] = await tx
          .select()
          .from(membership)
          .where(
            and(
              eq(membership.projectId, input.projectId),
              eq(membership.userId, ownerId),
            ),
          )
          .for("share");
        if (!p || !owner) throw new ProjectAccessError("Project not found.");
        const memberIds = [...new Set(input.memberIds)];
        if (input.visibility !== "selected" && memberIds.length)
          throw new IssueInputError(
            "Member selection is only available for Selected members sharing.",
          );
        if (input.visibility === "selected" && !memberIds.length)
          throw new IssueInputError(
            "Choose at least one project member or use Private.",
          );
        if (memberIds.length) {
          const members = await tx
            .select()
            .from(membership)
            .where(
              and(
                eq(membership.projectId, p.id),
                inArray(membership.userId, memberIds),
              ),
            )
            .for("share");
          if (
            members.length !== memberIds.length ||
            memberIds.includes(ownerId)
          )
            throw new IssueInputError(
              "Select other current members of this project.",
            );
        }
        await tx
          .delete(share)
          .where(and(eq(share.agentId, row.id), eq(share.projectId, p.id)));
        if (input.visibility !== "private") {
          await tx
            .insert(share)
            .values({
              agentId: row.id,
              ownerId,
              projectId: p.id,
              visibility: input.visibility,
            });
          if (memberIds.length)
            await tx
              .insert(grant)
              .values(
                memberIds.map((userId) => ({
                  agentId: row.id,
                  projectId: p.id,
                  userId,
                })),
              );
        }
        await tx
          .update(agent)
          .set({ revision: row.revision + 1 })
          .where(eq(agent.id, row.id));
      });
    },
    async available(
      userId: string,
      projectId: string,
    ): Promise<AgentIdentity[]> {
      // Both requester and owner must currently belong to this active project.
      // No connection secrets, connection IDs or system instructions are selected.
      const [access] = await db
        .select({ id: project.id })
        .from(project)
        .innerJoin(membership, eq(membership.projectId, project.id))
        .where(
          and(
            eq(project.id, projectId),
            eq(project.state, "active"),
            eq(membership.userId, userId),
          ),
        );
      if (!access) throw new ProjectAccessError("Project not found.");
      return db
        .select({
          kind: sql<"agent">`'agent'`,
          id: agent.id,
          ownerId: agent.ownerId,
          ownerName: user.name,
          name: agent.name,
          avatar: agent.avatar,
          role: agent.role,
          provider: connection.provider,
          model: agent.model,
          effort: agent.effort,
        })
        .from(agent)
        .innerJoin(connection, eq(connection.id, agent.connectionId))
        .innerJoin(user, eq(user.id, agent.ownerId))
        .where(
          and(
            isNull(agent.deletedAt),
            sql`EXISTS (SELECT 1 FROM ${membership} WHERE ${membership.projectId} = ${projectId} AND ${membership.userId} = ${agent.ownerId})`,
            sql`EXISTS (SELECT 1 FROM ${membership} WHERE ${membership.projectId} = ${projectId} AND ${membership.userId} = ${userId})`,
            sql`EXISTS (SELECT 1 FROM ${project} WHERE ${project.id} = ${projectId} AND ${project.state} = 'active')`,
            sql`(${agent.ownerId} = ${userId} OR EXISTS (SELECT 1 FROM ${share} WHERE ${share.agentId} = ${agent.id} AND ${share.projectId} = ${projectId} AND (${share.visibility} = 'project' OR EXISTS (SELECT 1 FROM ${grant} WHERE ${grant.agentId} = ${agent.id} AND ${grant.projectId} = ${projectId} AND ${grant.userId} = ${userId}))))`,
          ),
        )
        .orderBy(asc(agent.name), asc(agent.id));
    },
  };
  return service;
}
export type AIService = ReturnType<typeof createAIService>;
