import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import {
  createDpopReplayStore,
  DPOP_SIGNING_ALGORITHMS,
  enforceDpopBinding,
  isDpopBindingError,
  isDpopProofError,
  parseAccessTokenAuthorization,
  verifyJwsAccessToken,
} from "better-auth/oauth2";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { jwt, magicLink } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { schema, type Database } from "@spectron/db";
import { LogoError, normalizeLogoDataURL } from "./project-logo/images";

export type ResetEmail = { to: string; url: string };
export type MagicLinkEmail = { to: string; url: string };
export type VerificationEmail = { to: string; url: string };
/** Seconds a login link stays valid. Short, because it is a bearer credential. */
export const MAGIC_LINK_EXPIRES_IN = 10 * 60;
/** The MCP server is a protected resource of this same app. */
export const mcpResource = (appURL: string) => `${appURL}/api/mcp`;
const UNUSED_OAUTH_PATHS = [
  "/oauth2/create-client",
  "/oauth2/get-client",
  "/oauth2/get-clients",
  "/oauth2/update-client",
  "/oauth2/delete-client",
  "/oauth2/client/rotate-secret",
  "/oauth2/client/rotate-keys",
  "/oauth2/get-consent",
  "/oauth2/get-consents",
  "/oauth2/update-consent",
  "/oauth2/delete-consent",
  "/oauth2/end-session",
  "/oauth2/end-session/confirm",
  "/oauth2/userinfo",
  "/oauth2/introspect",
  "/oauth2/public-client-prelogin",
  "/admin/oauth2/create-client",
  "/admin/oauth2/update-client",
  "/admin/oauth2/resources",
  "/admin/oauth2/resources/:identifier",
  "/admin/oauth2/resources/:identifier/clients/:client_id",
];
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

export const profileAvatarPath = "/api/profile-avatars";

async function storeProfileAvatar({ image }: { image?: unknown }) {
  if (image === undefined) return;
  if (image === null) return { data: { image: null, avatarData: null } };
  try {
    const png = await normalizeLogoDataURL(typeof image === "string" ? image : null);
    if (!png) throw new LogoError();
    return {
      data: {
        image: `${profileAvatarPath}/${randomUUID()}`,
        avatarData: png.slice("data:image/png;base64,".length),
      },
    };
  } catch (error) {
    if (!(error instanceof LogoError)) throw error;
    throw new APIError("BAD_REQUEST", { message: "Choose a valid avatar image." });
  }
}

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
    // The OAuth provider's client/consent management, OIDC logout, UserInfo
    // and introspection endpoints are not used by MCP clients: Spectron
    // manages connected apps itself (oauth-apps.ts).
    disabledPaths: ["/token", ...UNUSED_OAUTH_PATHS],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A consent is a lasting grant. An unverified account may belong to
        // someone squatting the address, whose grant would outlive the real
        // owner reclaiming it; only verified accounts may connect apps.
        // The provider would fetch these URLs server-side; MCP clients never
        // need them. A database constraint backs this up for clients that
        // arrive through a metadata document.
        if (ctx.path === "/oauth2/register") {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          for (const field of ["backchannel_logout_uri", "jwks_uri"])
            if (body[field] !== undefined)
              throw new APIError("BAD_REQUEST", {
                error: "invalid_client_metadata",
                error_description: `${field} is not supported.`,
              });
          return;
        }
        // Cancelling stays possible, so the client gets access_denied.
        if (ctx.path !== "/oauth2/consent" || (ctx.body as { accept?: unknown })?.accept !== true) return;
        const session = await getSessionFromCtx(ctx);
        if (session && !session.user.emailVerified)
          throw new APIError("FORBIDDEN", {
            message: "Verify your email address before connecting apps to Spectron.",
          });
      }),
    },
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    user: {
      additionalFields: {
        avatarData: { type: "string", required: false, input: false, returned: false },
      },
    },
    databaseHooks: {
      user: {
        create: { before: storeProfileAvatar },
        update: { before: storeProfileAvatar },
      },
    },
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

type JwksFetch = Exclude<Parameters<typeof verifyJwsAccessToken>[1]["jwksFetch"], string>;
export type McpCredential =
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "personal"; token: string }
  | { kind: "invalid"; scheme: "Bearer" | "DPoP"; error: "invalid_token" | "invalid_dpop_proof" }
  | {
      kind: "oauth";
      scheme: "Bearer" | "DPoP";
      claims: { sub: string; iat: number; azp?: unknown; client_id?: unknown; scope?: unknown; exp?: unknown };
    };
/** Algorithms advertised in RFC 9449 `DPoP` challenges. */
export const MCP_DPOP_ALGORITHMS = DPOP_SIGNING_ALGORITHMS;

/**
 * Reads the credential of an MCP request. OAuth access tokens are verified
 * in-process against this server's own signing keys (no HTTP round-trip to
 * /jwks): signature, issuer, the MCP audience, the RFC 9068 `at+jwt` type and
 * required claims. A DPoP-bound token must arrive with the DPoP scheme and a
 * valid proof for the public MCP URL (RFC 9449 §7); proofs are single-use via
 * the auth database. Personal access tokens (spk_…) are returned as such.
 */
export function createMcpCredentialReader(auth: Auth, appURL: string) {
  const issuer = `${appURL}/api/auth`;
  const audience = mcpResource(appURL);
  // Identity key for the JWKS cache (5-minute TTL, refetch on unknown kid).
  const jwksCacheKey = {};
  const replayStore = auth.$context.then((ctx) => createDpopReplayStore(ctx.internalAdapter));
  return async (request: Request): Promise<McpCredential> => {
    const header = request.headers.get("authorization");
    if (!header) return { kind: "missing" };
    const authorization = parseAccessTokenAuthorization(header);
    if (!authorization || authorization.scheme === "Unknown" || !authorization.token) return { kind: "malformed" };
    if (authorization.scheme === "Bearer" && authorization.token.startsWith("spk_"))
      return { kind: "personal", token: authorization.token };
    const scheme = authorization.scheme;
    let claims;
    try {
      claims = await verifyJwsAccessToken(authorization.token, {
        jwksFetch: (() => auth.api.getJwks()) as JwksFetch,
        jwksCacheKey,
        // RFC 9068: exp, iat and sub are mandatory; fail closed without them.
        verifyOptions: { issuer, audience, typ: "at+jwt", requiredClaims: ["exp", "iat", "sub"] },
      });
    } catch {
      return { kind: "invalid", scheme, error: "invalid_token" };
    }
    if (typeof claims.sub !== "string" || typeof claims.iat !== "number")
      return { kind: "invalid", scheme, error: "invalid_token" };
    try {
      await enforceDpopBinding({
        payload: claims,
        authorization,
        proofJwt: request.headers.get("dpop"),
        method: request.method,
        url: audience,
        replayStore: await replayStore,
      });
    } catch (error) {
      // RFC 9449 §7.1: a bad or missing proof is invalid_dpop_proof under the
      // DPoP scheme; a token/scheme mismatch is invalid_token.
      const proofError =
        isDpopProofError(error) || (isDpopBindingError(error) && error.code === "invalid_dpop_proof");
      return proofError
        ? { kind: "invalid", scheme: "DPoP", error: "invalid_dpop_proof" }
        : { kind: "invalid", scheme, error: "invalid_token" };
    }
    return { kind: "oauth", scheme, claims: claims as typeof claims & { sub: string; iat: number } };
  };
}

const OAUTH_INTERNAL_PARAMS = new Set(["sig", "exp", "ba_iat", "ba_param", "ba_pl"]);
/**
 * GET handler that resumes an MCP client's authorization after a login link.
 * Link verification is a plain GET, so Better Auth cannot carry the signed
 * request through it the way it does for password sign-in. This endpoint
 * verifies the signed request itself and, as the provider does after a
 * sign-in, treats `prompt=login`/`prompt=create` and `max_age` as satisfied
 * only when the session was created after the request was issued.
 */
export function createOAuthResume(auth: Auth) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const params = url.searchParams;
    const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
    const signedNames = new Set(params.getAll("ba_param"));
    const signed = new URLSearchParams();
    for (const [key, value] of params)
      if (key === "sig" || key === "ba_param" || signedNames.has(key)) signed.append(key, value);
    const { secret } = await auth.$context;
    if (!params.has("sig") || !(await verifyOAuthQueryParams(signed.toString(), secret)))
      return redirect("/login?oauth_expired=1");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return redirect(`/login?${signed}`);
    const issuedAt = Number(params.get("ba_iat"));
    const fresh = Number.isFinite(issuedAt) && new Date(session.session.createdAt).getTime() >= issuedAt;
    const original = new URLSearchParams();
    for (const [key, value] of signed) if (!OAUTH_INTERNAL_PARAMS.has(key)) original.append(key, value);
    // Same token rules as Better Auth: space-delimited, trimmed.
    const prompts = (original.get("prompt") ?? "").split(/\s+/).map((p) => p.trim()).filter(Boolean);
    const maxAge = original.has("max_age") ? Number(original.get("max_age")) : null;
    const ageSeconds = (Date.now() - new Date(session.session.createdAt).getTime()) / 1000;
    // max_age=0 means "sign in for this request"; a positive limit is met by
    // any session young enough (OIDC Core §3.1.2.1).
    const maxAgeMet = maxAge === null || (maxAge === 0 ? fresh : Number.isFinite(maxAge) && ageSeconds <= maxAge);
    if ((!fresh && prompts.includes("login")) || !maxAgeMet) return redirect(`/login?${signed}`);
    const remaining = prompts.filter((prompt) => !(fresh && (prompt === "login" || prompt === "create")));
    if (remaining.length) original.set("prompt", remaining.join(" "));
    else original.delete("prompt");
    // Satisfied here; leaving it would let authorize compare it against the
    // session's original authentication time and send the person back.
    if (maxAge !== null) original.delete("max_age");
    return redirect(`/api/auth/oauth2/authorize?${original}`);
  };
}
