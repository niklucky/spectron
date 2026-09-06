import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, migrateDatabase } from "@spectron/db";
import { createAuth, type ResetEmail } from "@spectron/backend";
import { createAPI } from "../src/index";

test("Postgres auth lifecycle", async (t) => {
  // Never reuse or truncate application tables. Every run owns a fresh database.
  const connection =
    process.env.TEST_DATABASE_URL ||
    "postgresql://spectron:spectron@127.0.0.1:5442/spectron";
  const namespace = `test_auth_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(connection);
  await admin.pool.query(`CREATE DATABASE "${namespace}"`);
  const url = new URL(connection);
  url.pathname = `/${namespace}`;
  const { db, pool } = createDatabase(url.toString());
  t.after(async () => {
    await pool.end();
    await admin.pool.query(`DROP DATABASE "${namespace}"`);
    await admin.pool.end();
  });
  await migrateDatabase(db);
  const sent: ResetEmail[] = [];
  const origin = "http://localhost:5173";
  const auth = createAuth(db, {
    appURL: origin,
    secret: "integration-test-secret-with-at-least-32-characters",
    sendResetEmail: async (email) => {
      sent.push(email);
    },
  });
  const api = createAPI(auth);
  const email = "developer@example.test";
  const password = "a sufficiently long password";
  let cookie = "";
  const call = (
    path: string,
    body?: unknown,
    options: { cookie?: string; origin?: string } = {},
  ) =>
    api.request(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        origin: options.origin || origin,
        cookie: options.cookie ?? cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const sessionCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const clearLimits = () => pool.query("DELETE FROM rate_limits");

  await t.test(
    "registration validates credentials and stores a hash",
    async () => {
      assert.equal((await call("/api/me")).status, 401);
      assert.equal(
        (
          await call("/api/auth/sign-up/email", {
            name: "Dev",
            email,
            password: "short",
          })
        ).status,
        400,
      );
      const response = await call("/api/auth/sign-up/email", {
        name: "Developer",
        email,
        password,
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get("set-cookie") || "", /HttpOnly/i);
      assert.match(response.headers.get("set-cookie") || "", /SameSite=Lax/i);
      cookie = sessionCookie(response);
      assert.equal((await call("/api/me")).status, 200);
      const accounts = await pool.query("SELECT password FROM accounts");
      assert.notEqual(accounts.rows[0].password, password);
      assert.ok(accounts.rows[0].password.length > 64);
      const duplicate = await call("/api/auth/sign-up/email", {
        name: "Dev",
        email: email.toUpperCase(),
        password,
      });
      assert.ok(duplicate.status >= 400);
      assert.equal(
        (await pool.query("SELECT count(*) FROM users")).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "profile updates persist; signout revokes the session",
    async () => {
      assert.equal(
        (await call("/api/auth/update-user", { name: "Updated name" })).status,
        200,
      );
      const profile = (await (await call("/api/me")).json()) as {
        user: { name: string };
      };
      assert.equal(profile.user.name, "Updated name");
      assert.equal((await call("/api/auth/sign-out", {})).status, 200);
      assert.equal((await call("/api/me")).status, 401);
      cookie = "";
      assert.equal(
        (
          await call("/api/auth/sign-in/email", {
            email,
            password: "incorrect password",
          })
        ).status,
        401,
      );
      const response = await call("/api/auth/sign-in/email", {
        email: email.toUpperCase(),
        password,
      });
      assert.equal(response.status, 200);
      cookie = sessionCookie(response);
    },
  );
  await t.test(
    "rejects cross-origin mutations and external reset redirects",
    async () => {
      assert.equal(
        (
          await call(
            "/api/auth/sign-in/email",
            { email, password },
            { origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call("/api/auth/request-password-reset", {
            email,
            redirectTo: "https://evil.example/reset-password",
          })
        ).status,
        403,
      );
      assert.equal(sent.length, 0);
    },
  );
  await t.test(
    "reset requests conceal unknown accounts and store hashed tokens",
    async () => {
      await clearLimits();
      const unknown = await call("/api/auth/request-password-reset", {
        email: "unknown@example.test",
        redirectTo: `${origin}/reset-password`,
      });
      assert.equal(unknown.status, 200);
      assert.equal(sent.length, 0);
      const known = await call("/api/auth/request-password-reset", {
        email,
        redirectTo: `${origin}/reset-password`,
      });
      assert.equal(known.status, 200);
      assert.deepEqual(await known.json(), await unknown.json());
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.to, email);
      const link = new URL(sent[0]!.url);
      assert.equal(link.origin, origin);
      const token = link.pathname.split("/").at(-1)!;
      const records = await pool.query("SELECT identifier FROM verifications");
      assert.ok(records.rows.every((row) => !row.identifier.includes(token)));
    },
  );
  await t.test(
    "reset is single use and revokes existing sessions",
    async () => {
      const link = new URL(sent[0]!.url);
      const redirect = await api.request(link.toString());
      assert.equal(redirect.status, 302);
      const location = new URL(redirect.headers.get("location")!);
      assert.equal(location.pathname, "/reset-password");
      const token = location.searchParams.get("token")!;
      const newPassword = "a new sufficiently long password";
      const results = await Promise.all(
        [0, 1].map(() =>
          call("/api/auth/reset-password", { token, newPassword }),
        ),
      );
      assert.equal(
        results.filter((response) => response.status === 200).length,
        1,
      );
      assert.equal((await call("/api/me")).status, 401);
      assert.equal(
        (await call("/api/auth/reset-password", { token, newPassword })).status,
        400,
      );
      cookie = "";
      assert.equal(
        (await call("/api/auth/sign-in/email", { email, password })).status,
        401,
      );
      assert.equal(
        (
          await call("/api/auth/sign-in/email", {
            email,
            password: newPassword,
          })
        ).status,
        200,
      );
    },
  );
  await t.test("expired and invalid reset tokens fail", async () => {
    await clearLimits();
    await call("/api/auth/request-password-reset", {
      email,
      redirectTo: `${origin}/reset-password`,
    });
    const token = new URL(sent.at(-1)!.url).pathname.split("/").at(-1)!;
    await pool.query(
      "UPDATE verifications SET expires_at = now() - interval '1 hour'",
    );
    assert.equal(
      (await call("/api/auth/reset-password", { token, newPassword: password }))
        .status,
      400,
    );
    assert.equal(
      (
        await call("/api/auth/reset-password", {
          token: "invalid",
          newPassword: password,
        })
      ).status,
      400,
    );
  });
  await t.test(
    "rate limiting survives a new auth instance and ignores spoofed IP headers",
    async () => {
      await clearLimits();
      for (let i = 0; i < 3; i++)
        await call("/api/auth/request-password-reset", {
          email: "unknown@example.test",
        });
      const otherAPI = createAPI(
        createAuth(db, {
          appURL: origin,
          secret: "integration-test-secret-with-at-least-32-characters",
          sendResetEmail: async () => {},
        }),
      );
      const response = await otherAPI.request(
        `${origin}/api/auth/request-password-reset`,
        {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-spectron-client-ip": "8.8.8.8",
            "x-forwarded-for": "8.8.8.8",
          },
          body: JSON.stringify({ email }),
        },
      );
      assert.equal(response.status, 429);
      assert.ok(response.headers.get("x-retry-after"));
    },
  );
  await t.test(
    "email delivery failures do not reveal account existence",
    async () => {
      await clearLimits();
      const failingAPI = createAPI(
        createAuth(db, {
          appURL: origin,
          secret: "integration-test-secret-with-at-least-32-characters",
          sendResetEmail: async () => {
            throw new Error("Simulated delivery failure");
          },
        }),
      );
      const request = (email: string) =>
        failingAPI.request(`${origin}/api/auth/request-password-reset`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            email,
            redirectTo: `${origin}/reset-password`,
          }),
        });
      const known = await request(email);
      const unknown = await request("unknown@example.test");
      assert.equal(known.status, 200);
      assert.equal(unknown.status, 200);
      assert.deepEqual(await known.json(), await unknown.json());
    },
  );
  await t.test(
    "HTTPS cookies are secure and expired sessions are denied",
    async () => {
      await clearLimits();
      const secureOrigin = "https://spectron.example.test";
      const secureAPI = createAPI(
        createAuth(db, {
          appURL: secureOrigin,
          secret: "integration-test-secret-with-at-least-32-characters",
          sendResetEmail: async () => {},
        }),
      );
      const login = await secureAPI.request(
        `${secureOrigin}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: { origin: secureOrigin, "content-type": "application/json" },
          body: JSON.stringify({
            email,
            password: "a new sufficiently long password",
          }),
        },
      );
      assert.equal(login.status, 200);
      assert.match(login.headers.get("set-cookie") || "", /; Secure/i);
      const secureCookie = sessionCookie(login);
      assert.equal(
        (
          await secureAPI.request(`${secureOrigin}/api/me`, {
            headers: { cookie: secureCookie },
          })
        ).status,
        200,
      );
      await pool.query(
        "UPDATE sessions SET expires_at = now() - interval '1 hour'",
      );
      assert.equal(
        (
          await secureAPI.request(`${secureOrigin}/api/me`, {
            headers: { cookie: secureCookie },
          })
        ).status,
        401,
      );
    },
  );
});
