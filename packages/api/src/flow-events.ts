import type { Auth } from "@spectron/backend";
import type { createDatabase } from "@spectron/db";
import { flowChangeKinds, type FlowChange, type FlowMessage } from "@spectron/shared";
import type { ServerType } from "@hono/node-server";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

type Pool = ReturnType<typeof createDatabase>["pool"];

export async function attachFlowEvents(server: ServerType, pool: Pool, auth: Auth, origin: string) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const sessions = new Map<WebSocket, string>();
  const waitingForPong = new Set<WebSocket>();
  let stopped = false;
  let listening = false;
  let release: (() => void) | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, FlowChange>();
  let sending = false;

  function send(ws: WebSocket, message: FlowMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256 * 1024) ws.terminate();
    else ws.send(JSON.stringify(message));
  }
  function disconnect() {
    for (const ws of sessions.keys()) ws.terminate();
  }

  // Check current membership and session validity at delivery, including for tabs
  // which were already connected when access changed. Batch concurrent writes.
  async function flush() {
    timer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    if (!sessions.size || !batch.length) return;
    sending = true;
    try {
      const { rows } = await pool.query<{ id: string; project_id: string }>(
        `SELECT s.id, m.project_id FROM sessions s JOIN project_members m ON m.user_id = s.user_id
         JOIN projects p ON p.id = m.project_id AND p.state = 'active'
         WHERE s.id = ANY($1::text[]) AND s.expires_at > now() AND m.project_id = ANY($2::text[])`,
        [[...new Set(sessions.values())], [...new Set(batch.map(c => c.projectId))]],
      );
      const allowed = new Map<string, Set<string>>();
      for (const row of rows) {
        const projects = allowed.get(row.id) ?? new Set<string>();
        projects.add(row.project_id);
        allowed.set(row.id, projects);
      }
      for (const [ws, session] of sessions) {
        const projects = allowed.get(session);
        if (!projects) continue;
        const changes = batch.filter(c => projects.has(c.projectId));
        if (changes.length > 256) send(ws, { type: "ready" });
        else if (changes.length) send(ws, { type: "changes", changes });
      }
    } catch {
      // Reconnecting clients take a new snapshot to cover this gap.
      disconnect();
    } finally {
      sending = false;
      schedule();
    }
  }
  function schedule() {
    if (!stopped && !sending && !timer && pending.size) timer = setTimeout(() => void flush(), 80);
  }

  async function listen() {
    const client = await pool.connect();
    if (stopped) { client.release(); return; }
    let released = false;
    const drop = () => {
      if (released) return;
      released = true;
      listening = false;
      client.release(true);
      release = undefined;
      disconnect();
      if (!stopped) retry();
    };
    release = drop;
    client.once("error", drop);
    client.once("end", drop);
    client.on("notification", ({ channel, payload }) => {
      if (channel !== "spectron_flow" || !payload || !sessions.size) return;
      try {
        const change = JSON.parse(payload);
        if (typeof change?.projectId !== "string" || typeof change.issueId !== "string" ||
            !flowChangeKinds.includes(change.kind)) return;
        const { projectId, issueId, kind } = change;
        pending.set(payload, { projectId, issueId, kind });
        schedule();
      } catch { /* Ignore unrelated or malformed NOTIFY payloads. */ }
    });
    try {
      await client.query("LISTEN spectron_flow");
      if (!released) listening = true;
    } catch {
      drop();
    }
  }
  function retry() {
    reconnect = setTimeout(() => { void listen().catch(() => { if (!stopped) retry(); }); }, 1000);
  }
  await listen().catch(retry);

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const reject = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    if (req.url !== "/api/flow/events") { reject("404 Not Found"); return; }
    if (req.headers.origin !== origin) { reject("403 Forbidden"); return; }
    const session = await auth.api.getSession({ headers: new Headers({ cookie: req.headers.cookie ?? "" }) });
    if (!session) { reject("401 Unauthorized"); return; }
    if (stopped || !listening) { reject("503 Service Unavailable"); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      sessions.set(ws, session.session.id);
      ws.on("pong", () => waitingForPong.delete(ws));
      ws.on("message", () => ws.close(1008, "Read-only stream"));
      ws.on("error", () => ws.terminate());
      ws.on("close", () => { sessions.delete(ws); waitingForPong.delete(ws); });
      send(ws, { type: "ready" });
    });
  }
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    void upgrade(req, socket, head).catch(() => socket.destroy());
  };
  server.on("upgrade", onUpgrade);
  const heartbeat = setInterval(() => {
    for (const ws of sessions.keys()) {
      if (waitingForPong.has(ws)) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) { waitingForPong.add(ws); ws.ping(); }
    }
  }, 25000);
  return () => {
    stopped = true;
    clearInterval(heartbeat);
    clearTimeout(timer);
    clearTimeout(reconnect);
    server.off("upgrade", onUpgrade);
    release?.();
    disconnect();
    sockets.close();
  };
}
