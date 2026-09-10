import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

// Optional encrypted DNS for environments where a VPN replaces public DNS
// answers with proxy addresses. The connection still uses validated public IPs.
export async function resolveHost(hostname: string, signal: AbortSignal, mode: "system" | "cloudflare" = "system") {
  if (mode !== "cloudflare" || isIP(hostname))
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
