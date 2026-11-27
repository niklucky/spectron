export type ApiTokenSummary = {
  id: string;
  name: string;
  /** First characters of the secret, shown so tokens can be told apart. */
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};
/** Lifetimes offered in settings; null never expires. */
export const apiTokenLifetimes = [30, 90, 365, null] as const;
/** An app connected to Spectron through the MCP OAuth flow. */
export type OAuthAppSummary = {
  clientId: string;
  /** Self-asserted by the app. */
  name: string | null;
  /** The app's https homepage, when it declared one. */
  uri: string | null;
  scopes: string[];
  connectedAt: string;
};
