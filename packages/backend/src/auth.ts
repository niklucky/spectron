import { betterAuth } from "better-auth";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, magicLink } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { schema, type Database } from "@spectron/db";

export type ResetEmail = { to: string; url: string };
export type MagicLinkEmail = { to: string; url: string };
export type VerificationEmail = { to: string; url: string };
/** Seconds a login link stays valid. Short, because it is a bearer credential. */
export const MAGIC_LINK_EXPIRES_IN = 10 * 60;
/** The MCP server is a protected resource of this same app. */
export const mcpResource = (appURL: string) => `${appURL}/api/mcp`;
/** SPA routes the OAuth authorize flow sends people to. */
export const OAUTH_LOGIN_PAGE = "/login";
export const OAUTH_CONSENT_PAGE = "/oauth/consent";
export type AuthConfig = {
  appURL: string;
  secret: string;
  sendResetEmail: (email: ResetEmail) => Promise<void>;
  sendMagicLinkEmail: (email: MagicLinkEmail) => Promise<void>;
  sendVerificationEmail: (email: VerificationEmail) => Promise<void>;
};

export function createAuth(db: Database, config: AuthConfig) {
  return betterAuth({
    appName: "Spectron",
    baseURL: config.appURL,
    basePath: "/api/auth",
    secret: config.secret,
    logger: {
      level: "error",
      // Adapter errors can contain SQL parameters, including credential hashes.
      log: () => console.error("Authentication request failed."),
    },
    trustedOrigins: [config.appURL],
    // The JWT plugin's session-token endpoint would mint JWTs signed with the
    // same keys as MCP access tokens; only the OAuth endpoints may issue them.
    disabledPaths: ["/token"],
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          await config.sendResetEmail({ to: user.email, url });
        } catch {
          // Keep the public response identical for known and unknown accounts.
          console.error(
            "Password reset email delivery failed. Check Resend configuration.",
          );
        }
      },
    },
    // Password sign-ups are asked to verify their address, but nothing is
    // gated on it. A verified account keeps its password when its owner later
    // logs in with a link; an unverified one is treated as unproven and loses
    // it (see 0027_verified_existing_users.sql).
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          await config.sendVerificationEmail({ to: user.email, url });
        } catch {
          console.error(
            "Verification email delivery failed. Check Resend configuration.",
          );
        }
      },
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      // OAuth 2.1 authorization server for MCP clients (Claude, Codex, …).
      // Tokens are audience-bound to the MCP resource. Clients identify
      // themselves with a Client ID Metadata Document (cimd) or, for clients
      // that predate it, dynamic registration; either way a person must sign
      // in and approve the client on the consent page.
      mcp({
        resource: mcpResource(config.appURL),
        loginPage: OAUTH_LOGIN_PAGE,
        consentPage: OAUTH_CONSENT_PAGE,
        scopes: ["openid", "profile", "email", "offline_access"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN,
        // A link for an unknown address creates the account, so the response
        // never says whether an email is registered. The name comes from the
        // client (the local part of the address) and is editable in Profile.
        disableSignUp: false,
        rateLimit: { window: 60, max: 3 },
        sendMagicLink: async ({ email, url }) => {
          try {
            await config.sendMagicLinkEmail({ to: email, url });
          } catch {
            console.error(
              "Login link email delivery failed. Check Resend configuration.",
            );
          }
        },
      }),
    ],
    verification: { storeIdentifier: "hashed" },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/magic-link/verify": { window: 60, max: 10 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: "spectron",
      useSecureCookies: new URL(config.appURL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: ["x-spectron-client-ip"] },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;

/**
 * Verifies an MCP access token in-process against this server's own signing
 * keys (no HTTP round-trip to /jwks): signature, issuer, the MCP audience and
 * the RFC 9068 `at+jwt` type. Throws when the token is not acceptable.
 */
type JwksFetch = Exclude<Parameters<typeof verifyJwsAccessToken>[1]["jwksFetch"], string>;
export function createMcpTokenVerifier(auth: Auth, appURL: string) {
  const issuer = `${appURL}/api/auth`;
  const audience = mcpResource(appURL);
  // Identity key for the JWKS cache (5-minute TTL, refetch on unknown kid).
  const jwksCacheKey = {};
  return async (token: string) => {
    const claims = await verifyJwsAccessToken(token, {
      jwksFetch: (() => auth.api.getJwks()) as JwksFetch,
      jwksCacheKey,
      verifyOptions: { issuer, audience, typ: "at+jwt" },
    });
    // Sender-constrained (DPoP) tokens need a proof this server does not check.
    if (claims.cnf) throw new Error("DPoP-bound access tokens are not supported.");
    if (typeof claims.sub !== "string") throw new Error("Access token has no subject.");
    return claims;
  };
}
