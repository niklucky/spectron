import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "@spectron/db";
import type { OAuthAppSummary } from "@spectron/shared";

const { oauthConsent, oauthClient, oauthRefreshToken, oauthAccessToken } = schema;

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
 * - Disconnecting deletes the consent, revokes the app's tokens and clears
 *   refresh-rotation replay state.
 * - A database trigger (migration 0034) refuses to store a refresh token
 *   without a live consent, so a rotation racing a disconnect cannot survive
 *   it.
 * - The MCP route accepts an access token only if it was issued after the
 *   current consent was created, so reconnecting does not revive tokens from
 *   an earlier connection.
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
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .delete(oauthConsent)
          .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));
        // Revoke live tokens and drop cached rotation responses, which would
        // otherwise let a just-rotated token be replayed for its reuse window.
        await tx
          .update(oauthRefreshToken)
          .set({ revoked: now, rotationReplayResponse: null, rotationReplayExpiresAt: null })
          .where(
            and(
              eq(oauthRefreshToken.userId, userId),
              eq(oauthRefreshToken.clientId, clientId),
              isNull(oauthRefreshToken.revoked),
            ),
          );
        await tx
          .update(oauthRefreshToken)
          .set({ rotationReplayResponse: null, rotationReplayExpiresAt: null })
          .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)));
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
    /**
     * When the person's current connection to this client began, or null if
     * they disconnected it. Checked on every MCP request.
     */
    async connectedSince(userId: string, clientId: string): Promise<Date | null> {
      const [row] = await db
        .select({ createdAt: oauthConsent.createdAt })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
        .orderBy(desc(oauthConsent.createdAt))
        .limit(1);
      return row ? row.createdAt : null;
    },
  };
}
export type OAuthAppService = ReturnType<typeof createOAuthAppService>;
