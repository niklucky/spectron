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
