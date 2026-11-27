import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type { ApiTokenSummary } from "@spectron/shared";

const { apiToken, user } = schema;
/** Recognisable prefix so leaked tokens are easy to spot and scan for. */
export const API_TOKEN_PREFIX = "spk_";
const MAX_ACTIVE_TOKENS = 50;
/** last_used_at is informational; avoid a write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

export class ApiTokenInputError extends Error {}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const summary = (row: typeof apiToken.$inferSelect): ApiTokenSummary => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

export function createApiTokenService(db: Database) {
  return {
    async list(userId: string): Promise<ApiTokenSummary[]> {
      const rows = await db
        .select()
        .from(apiToken)
        .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
        .orderBy(desc(apiToken.createdAt));
      return rows.map(summary);
    },
    async create(
      userId: string,
      input: { name: string; expiresInDays: number | null },
    ): Promise<{ token: string; summary: ApiTokenSummary }> {
      const name = input.name.trim();
      if (!name || name.length > 80)
        throw new ApiTokenInputError("Enter a token name of up to 80 characters.");
      const secret = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const expiresAt =
        input.expiresInDays === null
          ? null
          : new Date(Date.now() + input.expiresInDays * 86_400_000);
      const row = await db.transaction(async (tx) => {
        // Serialise per user so the active-token limit holds under concurrency.
        const [owner] = await tx
          .select({ emailVerified: user.emailVerified })
          .from(user)
          .where(eq(user.id, userId))
          .for("update");
        // An unverified account may belong to a squatter: a magic-link login by
        // the real mailbox owner keeps the user id but drops the squatter's
        // password and sessions. A token issued before that would outlive it.
        if (!owner?.emailVerified)
          throw new ApiTokenInputError(
            "Verify your email address before creating API tokens.",
          );
        const active = await tx
          .select({ id: apiToken.id })
          .from(apiToken)
          .where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)));
        if (active.length >= MAX_ACTIVE_TOKENS)
          throw new ApiTokenInputError(
            `You can have up to ${MAX_ACTIVE_TOKENS} tokens. Revoke unused ones first.`,
          );
        const [created] = await tx
          .insert(apiToken)
          .values({
            userId,
            name,
            prefix: secret.slice(0, API_TOKEN_PREFIX.length + 6),
            tokenHash: hash(secret),
            expiresAt,
          })
          .returning();
        return created!;
      });
      return { token: secret, summary: summary(row) };
    },
    async revoke(userId: string, id: string) {
      await db
        .update(apiToken)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiToken.id, id),
            eq(apiToken.userId, userId),
            isNull(apiToken.revokedAt),
          ),
        );
    },
    /**
     * The user an OAuth access token acts for, when that user may still use
     * the API: same rule as tokens, verified accounts only.
     */
    async verifiedUser(userId: string) {
      const [row] = await db
        .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, userId));
      return row?.emailVerified ? { id: row.id, name: row.name, email: row.email } : null;
    },
    /** Resolves a bearer token to its owner, or null when it is unknown, revoked or expired. */
    async authenticate(token: string) {
      if (!token.startsWith(API_TOKEN_PREFIX) || token.length > 200) return null;
      const [row] = await db
        .select({
          token: apiToken,
          emailVerified: user.emailVerified,
          user: { id: user.id, name: user.name, email: user.email },
        })
        .from(apiToken)
        .innerJoin(user, eq(user.id, apiToken.userId))
        .where(eq(apiToken.tokenHash, hash(token)));
      // Tokens act only for verified owners (see create()).
      if (!row || row.token.revokedAt || !row.emailVerified) return null;
      const now = Date.now();
      if (row.token.expiresAt && row.token.expiresAt.getTime() <= now) return null;
      if (!row.token.lastUsedAt || now - row.token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS)
        await db
          .update(apiToken)
          .set({ lastUsedAt: new Date(now) })
          .where(eq(apiToken.id, row.token.id));
      return { user: row.user, token: { id: row.token.id, name: row.token.name } };
    },
  };
}
export type ApiTokenService = ReturnType<typeof createApiTokenService>;
