import { and, eq } from "drizzle-orm";
import { schema as s, type Database } from "@spectron/db";
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function findExternalIdentity(
  tx: Tx,
  projectId: string,
  id: string,
) {
  return (
    await tx
      .select()
      .from(s.externalIdentity)
      .where(
        and(
          eq(s.externalIdentity.id, id),
          eq(s.externalIdentity.projectId, projectId),
        ),
      )
  )[0];
}
export async function identityAuthor(
  tx: Tx,
  userId: string | null,
  identityId: string | null,
) {
  if (userId || !identityId) return userId;
  return (
    (
      await tx
        .select()
        .from(s.externalIdentity)
        .where(eq(s.externalIdentity.id, identityId))
    )[0]?.localUserId ?? null
  );
}
