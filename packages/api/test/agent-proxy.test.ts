import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
} from "node:http";
import type { request as httpsRequest, RequestOptions } from "node:https";
import {
  createCredentialProxy,
  providerRequestError,
} from "../../backend/src/agent-runs/credential-proxy";
test("credential proxy rejects inactive, unauthenticated, wrong-model and non-generation requests", async () => {
  const proxy = await createCredentialProxy(
    "openai",
    "gpt-5.4",
    "fake-secret-never-sent",
  );
  const url = `http://127.0.0.1:${proxy.port}/v1`;
  const send = (route: string, token: string, body: unknown) =>
    fetch(url + route, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await send("/responses", proxy.token, { model: "gpt-5.4" })).status,
      403,
    );
    proxy.activate();
    assert.equal(
      (await send("/responses", "wrong", { model: "gpt-5.4" })).status,
      403,
    );
    assert.equal(
      (await send("/responses", proxy.token, { model: "different" })).status,
      403,
    );
    for (const path of [
      "/files",
      "/responses?url=https://evil.test",
      "/messages",
      "/../admin",
    ])
      assert.equal(
        (await send(path, proxy.token, { model: "gpt-5.4" })).status,
        403,
      );
    proxy.deactivate();
    assert.equal(
      (await send("/responses", proxy.token, { model: "gpt-5.4" })).status,
      403,
    );
  } finally {
    await proxy.close();
  }
});

test("provider failures explain status and supported parameters without exposing provider prose", () => {
  assert.match(
    providerRequestError(400, { error: { param: "temperature" } }),
    /temperature.*HTTP 400/,
  );
  assert.match(providerRequestError(401), /rejected the API key/);
  assert.match(providerRequestError(403), /generation permissions/);
  assert.match(providerRequestError(404), /model is unavailable/);
  assert.match(providerRequestError(429), /rate limiting/);
  assert.match(
    providerRequestError(429, { error: { code: "insufficient_quota" } }),
    /billing/,
  );
  assert.match(providerRequestError(502), /HTTP 502/);
  for (const body of [
    null,
    "invalid",
    {
      error: {
        param: "secret-token",
        code: "secret-token",
        message: "secret-token",
      },
    },
  ]) {
    const message = providerRequestError(400, body);
    assert.match(message, /request format/);
    assert.ok(!message.includes("secret-token"));
  }
});

test("credential proxy forwards POST generation and returns safe upstream failures", async () => {
  let status = 200;
  let requests = 0;
  const upstream = createServer(async (req, res) => {
    requests++;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/responses");
    assert.equal(req.headers.authorization, "Bearer fixture-provider-secret");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      model: "gpt-5.6-sol",
      input: "Hello",
    });
    res.writeHead(status, {
      "content-type": status === 200 ? "text/event-stream" : "application/json",
    });
    res.end(
      status === 200
        ? 'data: {"ok":true}\n\n'
        : JSON.stringify({
            error: {
              param: "temperature",
              message: "fixture-provider-secret private-prompt",
            },
          }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const proxy = await createCredentialProxy(
    "openai",
    "gpt-5.6-sol",
    "fixture-provider-secret",
    "system",
    {
      resolveHost: async () => [{ address: "1.1.1.1", family: 4 }],
      request: ((
        options: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => {
        assert.equal(options.hostname, "1.1.1.1");
        assert.equal(options.servername, "api.openai.com");
        // Exercise real HTTP streams locally while retaining the proxy's method,
        // headers, body and path. No provider credentials or credits are used.
        return httpRequest(
          {
            ...options,
            protocol: "http:",
            hostname: "127.0.0.1",
            port: address.port,
          },
          callback,
        );
      }) as typeof httpsRequest,
    },
  );
  try {
    proxy.activate();
    const send = () =>
      fetch(`http://127.0.0.1:${proxy.port}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${proxy.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-5.6-sol", input: "Hello" }),
      });
    const success = await send();
    assert.equal(success.status, 200);
    assert.equal(await success.text(), 'data: {"ok":true}\n\n');
    assert.equal(proxy.lastError, undefined);
    status = 400;
    const failure = await send();
    assert.equal(failure.status, 400);
    const body = await failure.text();
    assert.match(body, /temperature/);
    assert.ok(!body.includes("fixture-provider-secret"));
    assert.ok(!body.includes("private-prompt"));
    assert.match(proxy.lastError!, /temperature/);
    assert.equal(requests, 2);
    proxy.deactivate();
    proxy.activate();
    assert.equal(proxy.lastError, undefined);
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
