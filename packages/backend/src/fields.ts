import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type { FieldValues } from "@spectron/shared";
import { findExternalIdentity } from "./external-identities";
import { issueAccess, IssueInputError } from "./issues";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function validateFieldValues(
  tx: Tx,
  projectId: string,
  values: FieldValues,
) {
  const fields = await tx
    .select()
    .from(schema.projectField)
    .where(
      and(
        eq(schema.projectField.projectId, projectId),
        isNull(schema.projectField.deletedAt),
      ),
    );
  for (const [id, value] of Object.entries(values)) {
    const field = fields.find((f) => f.id === id);
    if (!field)
      throw new IssueInputError("Choose an active field from this project.");
    if (value === null) continue;
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new IssueInputError(`${field.name} must be a number.`);
    } else {
      if (typeof value !== "string" || value.length > 100000)
        throw new IssueInputError(`${field.name} must be text.`);
      if (
        field.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new IssueInputError(`${field.name} must be a valid date.`);
      if (field.type === "user") {
        const [member] = await tx
          .select()
          .from(schema.projectMember)
          .where(
            and(
              eq(schema.projectMember.projectId, projectId),
              eq(schema.projectMember.userId, value),
            ),
          );
        if (!member && !(await findExternalIdentity(tx, projectId, value)))
          throw new IssueInputError(`${field.name} must be a project member.`);
      }
    }
  }
}
export function createFieldService(db: Database) {
  return {
    async save(
      userId: string,
      input: {
        projectId: string;
        id?: string | undefined;
        name: string;
        type: "text" | "date" | "number" | "user";
      },
    ) {
      return db.transaction(async (tx) => {
        await issueAccess(tx, userId, input.projectId, true, true);
        const name = input.name.trim();
        if (!name || name.length > 80)
          throw new IssueInputError(
            "Enter a field name of up to 80 characters.",
          );
        let savedId = input.id;
        if (input.id) {
          const [field] = await tx
            .select()
            .from(schema.projectField)
            .where(
              and(
                eq(schema.projectField.id, input.id),
                eq(schema.projectField.projectId, input.projectId),
                isNull(schema.projectField.deletedAt),
              ),
            );
          if (!field || field.type !== input.type)
            throw new IssueInputError(
              "Field types cannot change. Create another field instead.",
            );
          await tx
            .update(schema.projectField)
            .set({ name })
            .where(eq(schema.projectField.id, field.id));
        } else {
          const [created] = await tx
            .insert(schema.projectField)
            .values({ projectId: input.projectId, name, type: input.type })
            .returning({ id: schema.projectField.id });
          savedId = created!.id;
        }
        await tx.insert(schema.projectHistory).values({
          projectId: input.projectId,
          actorUserId: userId,
          entityId: savedId!,
          entityType: "field",
          changes: {
            name: { before: null, after: name },
            type: { before: null, after: input.type },
          },
        });
        return { id: savedId!, name, type: input.type };
      });
    },
  };
}
export type FieldService = ReturnType<typeof createFieldService>;
