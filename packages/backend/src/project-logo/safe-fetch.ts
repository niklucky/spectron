import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function validatePublicURL(input: string) {
  const url = new URL(input);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Unsupported website URL.");
  return url;
}
export type RemoteFile = { body: Buffer; url: string; contentType: string };
export type FetchRemote = (
  url: string,
  signal: AbortSignal,
) => Promise<RemoteFile>;

// Optional encrypted DNS for environments where a VPN replaces public DNS
// answers with proxy addresses. The connection still uses validated public IPs.
async function resolveHost(hostname: string, signal: AbortSignal) {
  if (process.env.PROJECT_LOGO_DNS !== "cloudflare" || isIP(hostname))
    return lookup(hostname, { all: true });
  const results = await Promise.all(
    ([4, 6] as const).map(
      (family) =>
        new Promise<{ address: string; family: number }[]>(
          (resolve, reject) => {
            const type = family === 4 ? 1 : 28;
            const request = httpsRequest(
              {
                hostname: "1.1.1.1",
                servername: "cloudflare-dns.com",
                signal,
                agent: false,
                path: `/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
                headers: {
                  Host: "cloudflare-dns.com",
                  Accept: "application/dns-json",
                },
              },
              (response) => {
                response.on("error", reject);
                if (response.statusCode !== 200) {
                  response.destroy();
                  reject(new Error("DNS unavailable."));
                  return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > 16_384) {
                    response.destroy(new Error("DNS response too large."));
                    return;
                  }
                  chunks.push(chunk);
                });
                response.on("end", () => {
                  try {
                    const data = JSON.parse(
                      Buffer.concat(chunks).toString(),
                    ) as {
                      Status: number;
                      Answer?: { type: number; data: string }[];
                    };
                    if (data.Status !== 0)
                      throw new Error("DNS lookup failed.");
                    resolve(
                      (data.Answer || [])
                        .filter(
                          (item) =>
                            item.type === type && isIP(item.data) === family,
                        )
                        .map((item) => ({ address: item.data, family })),
                    );
                  } catch (error) {
                    reject(error);
                  }
                });
              },
            );
            request.on("error", reject);
            request.end();
          },
        ),
    ),
  );
  return results.flat();
}

export const fetchPublicFile: FetchRemote = async (input, signal) => {
  let url = validatePublicURL(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      resolveHost(hostname, signal),
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("Lookup timed out.")),
          { once: true },
        ),
      ),
    ]);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new Error("Website must be publicly accessible.");
    const address =
      addresses.find((item) => item.family === 4) || addresses[0]!;
    // Connect to the validated address, retaining the original Host and TLS name.
    // This pins DNS for the request and prevents rebinding between check and use.
    const result = await new Promise<{
      body: Buffer;
      location?: string;
      contentType: string;
    }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          hostname: address.address,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          servername: hostname,
          agent: false,
          signal,
          headers: {
            Host: url.host,
            "User-Agent": "Spectron/1.0 (project icon lookup)",
            Accept: "text/html,image/*;q=0.9",
            "Accept-Encoding": "identity",
          },
        },
        (response) => {
          response.on("error", reject);
          if (
            [301, 302, 303, 307, 308].includes(response.statusCode || 0) &&
            response.headers.location
          ) {
            resolve({
              body: Buffer.alloc(0),
              location: response.headers.location,
              contentType: "",
            });
            response.destroy();
            return;
          }
          if (response.statusCode !== 200) {
            response.destroy();
            reject(new Error("Website unavailable."));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              response.destroy(new Error("Website response is too large."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({
              body: Buffer.concat(chunks),
              contentType: response.headers["content-type"] || "",
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
    if (result.location) {
      url = validatePublicURL(new URL(result.location, url).href);
      continue;
    }
    return {
      body: result.body,
      contentType: result.contentType,
      url: url.href,
    };
  }
  throw new Error("Too many website redirects.");
};
