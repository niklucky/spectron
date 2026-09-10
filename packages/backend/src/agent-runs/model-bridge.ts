import { spawn } from "node:child_process";

// Docker's attached stdin/stdout channel is the only route out of the networkless
// container. The relay forwards generation requests to one loopback-only gateway.
// It never accepts a destination host from the container.
const relay = String.raw`
const http = require('node:http'), readline = require('node:readline');
const pending = new Map(); let next = 0;
const send = (value) => process.stdout.write(JSON.stringify(value)+'\n');
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !['/v1/responses','/v1/messages','/v1/chat/completions'].includes(req.url)) { res.writeHead(403); res.end(); return; }
  if (pending.size >= 2) { res.writeHead(429); res.end(); return; }
  const id = String(++next); pending.set(id, res);
  res.on('close', () => { pending.delete(id); send({type:'cancel',id}); });
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if(size > 32*1024*1024) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    send({type:'request',id,path:req.url,headers:{authorization:req.headers.authorization,'x-api-key':req.headers['x-api-key'],'anthropic-beta':req.headers['anthropic-beta']},body:Buffer.concat(chunks).toString('base64')});
  } catch { res.destroy(); }
});
readline.createInterface({input:process.stdin}).on('line', line => {
  try {
    const event = JSON.parse(line), res = pending.get(event.id); if(!res) return;
    if(event.type === 'headers') res.writeHead(event.status, {'content-type':event.contentType});
    if(event.type === 'data') res.write(Buffer.from(event.body,'base64'));
    if(event.type === 'end') res.end();
    if(event.type === 'error') res.destroy();
  } catch { process.exit(1); }
}).on('close', () => process.exit(0));
server.on('error', () => process.exit(1));
server.listen(4780,'127.0.0.1', () => send({type:'ready'}));
`;
export async function startModelBridge(container: string, proxyPort: number) {
  const child = spawn(
    "docker",
    ["exec", "-i", container, "node", "-e", relay],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const requests = new Map<string, AbortController>();
  let buffer = "",
    closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const request of requests.values()) request.abort();
    child.stdin.end();
    child.kill();
  };
  const send = (event: unknown) => {
    if (!closed) child.stdin.write(JSON.stringify(event) + "\n");
  };
  child.stdin.on("error", close);
  child.stderr.on("data", () => {});
  let ready!: () => void, failed!: (error: Error) => void;
  const readiness = new Promise<void>((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const timer = setTimeout(() => {
    failed(new Error("The isolated model relay could not start."));
    close();
  }, 15000);
  child.on("error", () => {
    failed(new Error("The isolated model relay could not start."));
    close();
  });
  child.on("close", () => {
    failed(new Error("The isolated model relay disconnected."));
    close();
  });
  async function dispatch(event: Record<string, unknown>) {
    if (event.type === "ready") {
      ready();
      return;
    }
    const id = event.id;
    if (typeof id !== "string" || !/^\d{1,12}$/.test(id)) {
      close();
      return;
    }
    if (event.type === "cancel") {
      requests.get(id)?.abort();
      return;
    }
    if (
      event.type !== "request" ||
      requests.has(id) ||
      requests.size >= 2 ||
      !["/v1/responses", "/v1/messages", "/v1/chat/completions"].includes(
        String(event.path),
      ) ||
      typeof event.body !== "string" ||
      event.body.length > 45_000_000
    ) {
      send({ type: "error", id });
      return;
    }
    const controller = new AbortController();
    requests.set(id, controller);
    try {
      const headers = new Headers({ "content-type": "application/json" });
      const provided = event.headers as Record<string, unknown> | undefined;
      for (const name of ["authorization", "x-api-key", "anthropic-beta"]) {
        const value = provided?.[name];
        if (typeof value === "string" && value.length < 2000)
          headers.set(name, value);
      }
      const response = await fetch(
        `http://127.0.0.1:${proxyPort}${event.path}`,
        {
          method: "POST",
          headers,
          body: Buffer.from(event.body, "base64"),
          redirect: "error",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20 * 60_000),
          ]),
        },
      );
      send({
        type: "headers",
        id,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "application/json",
      });
      let bytes = 0;
      if (response.body)
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024) throw new Error("Response too large.");
          send({
            type: "data",
            id,
            body: Buffer.from(chunk).toString("base64"),
          });
        }
      send({ type: "end", id });
    } catch {
      send({ type: "error", id });
    } finally {
      requests.delete(id);
    }
  }
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 46_000_000) {
      close();
      return;
    }
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        void dispatch(JSON.parse(line)).catch(close);
      } catch {
        close();
      }
    }
  });
  try {
    await readiness;
  } catch (error) {
    close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return { close };
}
