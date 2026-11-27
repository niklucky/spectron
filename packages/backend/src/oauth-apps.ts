import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type { OAuthAppSummary } from "@spectron/shared";

const { oauthConsent, oauthClient, oauthRefreshToken, oauthAccessToken, oauthDisconnect, verification } = schema;

/** An https homepage the UI can show, or null for anything unparsable. */
function httpsURL(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Apps a person connected through the MCP OAuth flow, keyed by their consent.
 *
 * - Disconnecting deletes the consent, the app's refresh and access tokens
 *   and its pending authorization codes, and records when it happened.
 *   Deleting rather than revoking matters: replaying a revoked refresh token
 *   makes the provider wipe the whole user/client family, which would break
 *   a later reconnection.
 * - A database trigger (migration 0034) refuses to store a refresh token
 *   without a live consent, so a rotation racing a disconnect cannot survive
 *   it.
 * - The MCP route accepts an access token only if it was issued after the
 *   current consent was created and after the last disconnect, so
 *   reconnecting never revives tokens from an earlier connection.
 */
export function createOAuthAppService(db: Database) {
  return {
    async list(userId: string): Promise<OAuthAppSummary[]> {
      const rows = await db
        .select({ consent: oauthConsent, client: oauthClient })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
        .where(eq(oauthConsent.userId, userId))
        .orderBy(desc(oauthConsent.updatedAt));
      return rows.map(({ consent, client }) => ({
        clientId: client.clientId,
        name: client.name,
        uri: httpsURL(client.uri),
        scopes: consent.scopes,
        connectedAt: consent.createdAt.toISOString(),
      }));
    },
    async disconnect(userId: string, clientId: string) {
      await db.transaction(async (tx) => {
        // The consent goes first: its row lock orders this against a refresh
        // rotation racing it (see the trigger in migration 0034).
        await tx
          .delete(oauthConsent)
          .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));
        await tx
          .delete(oauthAccessToken)
          .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));
        await tx
          .delete(oauthRefreshToken)
          .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)));
        // Authorization codes not yet exchanged. Better Auth stores them as
        // JSON.stringify text; match the exact serialized fragments instead
        // of casting, so no other verification row can make this fail.
        const needle = (key: string, value: string) => `"${key}":${JSON.stringify(value)}`;
        await tx
          .delete(verification)
          .where(
            sql`starts_with(${verification.value}, '{"type":"authorization_code"')
              AND strpos(${verification.value}, ${needle("userId", userId)}) > 0
              AND strpos(${verification.value}, ${needle("client_id", clientId)}) > 0`,
          );
        await tx
          .insert(oauthDisconnect)
          .values({ userId, clientId, disconnectedAt: new Date() })
          .onConflictDoUpdate({
            target: [oauthDisconnect.userId, oauthDisconnect.clientId],
            set: { disconnectedAt: new Date() },
          });
      });
    },
    /**
     * Whether an access token issued at `iat` (seconds) belongs to the
     * person's current connection with this client. Checked on every MCP
     * request.
     */
    async acceptsToken(userId: string, clientId: string, iat: number) {
      const [consent] = await db
        .select({ createdAt: oauthConsent.createdAt })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
        .orderBy(desc(oauthConsent.createdAt))
        .limit(1);
      if (!consent || iat < Math.floor(consent.createdAt.getTime() / 1000)) return false;
      const [last] = await db
        .select({ at: oauthDisconnect.disconnectedAt })
        .from(oauthDisconnect)
        .where(and(eq(oauthDisconnect.userId, userId), eq(oauthDisconnect.clientId, clientId)));
      // Strictly after the disconnect's second: a tie is refused, not revived.
      return !last || iat > Math.floor(last.at.getTime() / 1000);
    },
  };
}
export type OAuthAppService = ReturnType<typeof createOAuthAppService>;
