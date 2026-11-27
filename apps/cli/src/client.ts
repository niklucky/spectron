export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Query = Record<string, string | number | undefined>;

/** An error response from the API, or a failure to reach it (status 0). */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Client = ReturnType<typeof createClient>;

/** A thin client for /api/v1. See docs/api.md for the endpoints. */
export function createClient({
  url,
  token,
  fetch,
  userAgent,
}: {
  url: string;
  token: string;
  fetch: Fetch;
  userAgent: string;
}) {
  const base = `${url}/api/v1`;
  function endpoint(path: string, query?: Query) {
    // Absolute URLs from responses (file links) must point at the same server.
    const target = /^https?:\/\//.test(path) ? new URL(path) : new URL(`${base}${path.startsWith("/") ? "" : "/"}${path}`);
    if (target.origin !== url || !target.pathname.startsWith("/api/v1/"))
      throw new ApiFailure(0, "invalid_url", `${path} is not an API address on ${url}.`);
    for (const [key, value] of Object.entries(query ?? {}))
      if (value !== undefined && value !== "") target.searchParams.set(key, String(value));
    return target.toString();
  }

  async function send(
    method: string,
    path: string,
    options: { query?: Query; json?: unknown; body?: RequestInit["body"]; length?: number; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "user-agent": userAgent,
      accept: "application/json",
      ...options.headers,
    };
    let body: RequestInit["body"] | undefined = options.body;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    if (options.length !== undefined) headers["content-length"] = String(options.length);
    let response: Response;
    try {
      response = await fetch(endpoint(path, options.query), {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        // Streamed uploads need half-duplex in Node's fetch.
        ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      const reason = error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : String(error);
      throw new ApiFailure(0, "network_error", `Couldn't reach ${url}: ${reason}`);
    }
    if (!response.ok) throw await failure(response);
    return response;
  }

  return {
    url,
    send,
    async json<T>(method: string, path: string, options: Parameters<typeof send>[2] = {}): Promise<T> {
      const response = await send(method, path, options);
      if (!(response.headers.get("content-type") ?? "").includes("application/json"))
        throw new ApiFailure(0, "not_spectron", `${url} didn't answer like a Spectron server. Check the address.`);
      return (await response.json()) as T;
    },
  };
}

async function failure(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const { error } = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (error?.message) return new ApiFailure(response.status, error.code ?? "error", error.message);
  } catch {
    // Not JSON: a proxy or gateway error page.
  }
  return new ApiFailure(response.status, "http_error", `The server answered ${response.status} ${response.statusText}.`.replace(" .", "."));
}
