import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, type Database } from "@spectron/db";

export type ResetEmail = { to: string; url: string };
export type AuthConfig = {
  appURL: string;
  secret: string;
  sendResetEmail: (email: ResetEmail) => Promise<void>;
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
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
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
