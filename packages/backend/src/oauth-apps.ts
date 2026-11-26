import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type { OAuthAppSummary } from "@spectron/shared";

const { oauthConsent, oauthClient, oauthRefreshToken, oauthAccessToken } = schema;

/**
 * Apps a person connected through the MCP OAuth flow. Disconnecting removes
 * the consent and revokes the app's tokens; the MCP route also requires a
 * live consent on every request, so short-lived JWT access tokens stop
 * working at once instead of when they expire.
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
        uri: client.uri?.startsWith("https:") ? client.uri : null,
        scopes: consent.scopes,
        connectedAt: (consent.createdAt ?? consent.updatedAt ?? new Date(0)).toISOString(),
      }));
    },
    async disconnect(userId: string, clientId: string) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .delete(oauthConsent)
          .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));
        await tx
          .update(oauthRefreshToken)
          .set({ revoked: now })
          .where(
            and(
              eq(oauthRefreshToken.userId, userId),
              eq(oauthRefreshToken.clientId, clientId),
              isNull(oauthRefreshToken.revoked),
            ),
          );
        await tx
          .update(oauthAccessToken)
          .set({ revoked: now })
          .where(
            and(
              eq(oauthAccessToken.userId, userId),
              eq(oauthAccessToken.clientId, clientId),
              isNull(oauthAccessToken.revoked),
            ),
          );
      });
    },
    /** Whether the person still allows this client; checked on every MCP request. */
    async isConnected(userId: string, clientId: string) {
      const [row] = await db
        .select({ id: oauthConsent.id })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
        .limit(1);
      return !!row;
    },
  };
}
export type OAuthAppService = ReturnType<typeof createOAuthAppService>;
