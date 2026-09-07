import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import { issueAccess, IssueInputError } from "./issues";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function validateCustomFields(
  tx: Tx,
  projectId: string,
  values: Record<string, string | number | null>,
) {
  const fields = await tx
    .select()
    .from(schema.projectField)
    .where(eq(schema.projectField.projectId, projectId));
  for (const [id, value] of Object.entries(values)) {
    const field = fields.find((f) => f.id === id);
    if (!field) throw new IssueInputError("Unknown project field.");
    if (value === null) continue;
    if (
      field.type === "number"
        ? typeof value !== "number" || !Number.isFinite(value)
        : typeof value !== "string"
    )
      throw new IssueInputError(`Invalid value for ${field.name}.`);
    if (typeof value === "string" && value.length > 10000)
      throw new IssueInputError("Field value is too long.");
    if (
      field.type === "date" &&
      (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new IssueInputError(`Enter a valid date for ${field.name}.`);
    if (field.type === "user") {
      const [member] = await tx
        .select()
        .from(schema.projectMember)
        .where(
          and(
            eq(schema.projectMember.projectId, projectId),
            eq(schema.projectMember.userId, String(value)),
          ),
        );
      if (!member)
        throw new IssueInputError(`Choose a project member for ${field.name}.`);
    }
  }
}
export function createProjectFieldService(db: Database) {
  return {
    list: (actor: string, projectId: string) =>
      db.transaction(async (tx) => {
        await issueAccess(tx, actor, projectId);
        return tx
          .select({
            id: schema.projectField.id,
            name: schema.projectField.name,
            type: schema.projectField.type,
            externalId: schema.projectField.externalId,
          })
          .from(schema.projectField)
          .where(eq(schema.projectField.projectId, projectId));
      }),
    create: (
      actor: string,
      input: {
        projectId: string;
        name: string;
        type: "text" | "date" | "number" | "user";
      },
    ) =>
      db.transaction(async (tx) => {
        await issueAccess(tx, actor, input.projectId, true, true);
        const [existing] = await tx
          .select()
          .from(schema.projectField)
          .where(
            and(
              eq(schema.projectField.projectId, input.projectId),
              eq(schema.projectField.name, input.name),
            ),
          );
        if (existing)
          throw new IssueInputError("A field with this name already exists.");
        const [field] = await tx
          .insert(schema.projectField)
          .values(input)
          .returning();
        await tx
          .insert(schema.projectHistory)
          .values({
            projectId: input.projectId,
            actorUserId: actor,
            entityId: field!.id,
            entityType: "field",
            changes: {
              name: { before: null, after: field!.name },
              type: { before: null, after: field!.type },
            },
          });
        return field!;
      }),
  };
}
export type ProjectFieldService = ReturnType<typeof createProjectFieldService>;
