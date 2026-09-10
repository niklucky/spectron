import { createServer } from "node:http";
import { startModelBridge } from "../../backend/src/agent-runs/model-bridge";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId, type AgentIdentity } from "@spectron/shared";
import {
  createDockerAgentRuntime,
  processCommand,
  openCodeConfig,
} from "../../backend/src/agent-runs/runtime";
import type { Run } from "../../backend/src/agent-runs/service";

test(
  "pinned Docker/OpenCode: read-only sources, streamed result, same-session steering, restoration and descendant stop",
  { skip: process.env.TEST_AGENT_DOCKER !== "true", timeout: 180_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "spectron-runtime-"));
    const id = createId(),
      repoId = createId(),
      dir = join(root, id);
    const identity: AgentIdentity = {
      kind: "agent",
      id: createId(),
      ownerId: createId(),
      ownerName: "Owner",
      name: "Test",
      avatar: null,
      role: "Planner",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      effort: "high",
    };
    const repo = {
      id: repoId,
      projectId: createId(),
      connectionId: createId(),
      provider: "github" as const,
      externalId: "1",
      fullName: "fixture/repo",
      cloneURL: "https://github.com/fixture/repo.git",
      webURL: "https://github.com/fixture/repo",
      defaultBranch: "main",
      targetBranch: "main",
      isDefault: true,
      archived: false,
      revision: 1,
    };
    const run = {
      id,
      agent: identity,
      repositories: [repo],
      instructions: "Fixture instructions",
    } as Run;
    const runtime = createDockerAgentRuntime({ root });
    t.after(async () => {
      await runtime.cleanup(id);
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(join(dir, "repos", repoId), { recursive: true });
    await writeFile(
      join(dir, "repos", repoId, "AGENTS.md"),
      "Read the source; never edit it.",
    );
    await writeFile(join(dir, "repos", repoId, "source.txt"), "original");
    await writeFile(join(dir, `${repoId}.revision`), "a".repeat(40));
    const config = {
      key: "test-key-no-real-provider",
      repositories: [{ repository: repo, token: "test-git-token" }],
      attachments: [],
    };
    const activity: string[] = [];
    await runtime.prepare(
      run,
      config,
      AbortSignal.timeout(60000),
      async (s) => {
        activity.push(s);
      },
    );
    assert.equal(
      (
        await processCommand("docker", [
          "inspect",
          "--format",
          "{{.HostConfig.NetworkMode}}",
          `spectron-run-${id}`,
        ])
      ).trim(),
      "none",
    );
    await processCommand("docker", [
      "exec",
      `spectron-run-${id}`,
      "node",
      "-e",
      `
      const net=require('node:net');
      Promise.all(['1.1.1.1','172.17.0.1'].map(host=>new Promise((resolve,reject)=>{
        const socket=net.connect({host,port:443});socket.setTimeout(2000);
        socket.on('connect',()=>{socket.destroy();reject(new Error('Unexpected egress'));});
        socket.on('error',()=>resolve());socket.on('timeout',()=>{socket.destroy();resolve();});
      }))).catch(()=>process.exit(1));
    `,
    ]);
    assert.ok(
      !(await readFile(join(dir, "config.json"), "utf8")).includes(config.key),
    );
    await processCommand("docker", [
      "exec",
      `spectron-run-${id}`,
      "node",
      "-e",
      `const c=JSON.parse(require('fs').readFileSync('/etc/opencode/opencode.json')); fetch(c.provider.spectron.options.baseURL+'/responses', {method:'POST',headers:{authorization:'Bearer '+c.provider.spectron.options.apiKey},body:JSON.stringify({model:'forbidden'}),signal:AbortSignal.timeout(10000)}).then(r=>{if(r.status!==403)process.exit(1)}).catch(()=>process.exit(1));`,
    ]);
    await assert.rejects(
      processCommand("docker", [
        "exec",
        `spectron-run-${id}`,
        "sh",
        "-c",
        `echo changed > /repos/${repoId}/source.txt`,
      ]),
    );
    assert.equal(
      await readFile(join(dir, "repos", repoId, "source.txt"), "utf8"),
      "original",
    );
    const provider = openCodeConfig(identity, config.key);
    provider.provider.spectron.options.baseURL = "http://127.0.0.1:4781/v1";
    await writeFile(join(dir, "config.json"), JSON.stringify(provider));
    // A local deterministic provider exercises the actual pinned CLI without spending API credits.
    await writeFile(
      join(dir, "work", "provider.cjs"),
      `
    const http = require('http'), fs = require('fs');
    http.createServer((req,res) => {
      let body='';req.on('data',c=>body+=c);req.on('end',()=>{
        fs.appendFileSync('/work/requests.jsonl', body+'\\n');
        const parsed = JSON.parse(body);
        if (body.includes('Reject fixture model request')) {
          res.writeHead(400, {'content-type':'application/json'});
          res.end(JSON.stringify({error:{message:'Private provider diagnostics must not appear in chat',type:'invalid_request_error',param:'temperature'}}));return;
        }
        if (Array.isArray(parsed.tools) && parsed.tools.length && body.includes('Inspect source and plan') && !parsed.messages?.some(m => m.role === 'tool')) {
          res.writeHead(200, {'content-type':'text/event-stream'});
          res.write('data: '+JSON.stringify({id:'chatcmpl-tool',object:'chat.completion.chunk',created:1,model:'deepseek-v4-flash',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_read',type:'function',function:{name:'read',arguments:JSON.stringify({filePath:'/repos/${repoId}/source.txt'})}}]},finish_reason:null}]})+'\\n\\n');
          res.write('data: '+JSON.stringify({id:'chatcmpl-tool',object:'chat.completion.chunk',created:1,model:'deepseek-v4-flash',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\\n\\n');res.end('data: [DONE]\\n\\n');return;
        }
        const value = JSON.stringify({ summary:'Fixture plan', details:'Inspected repository context. No tests claimed.' });
        res.writeHead(200, {'content-type':'text/event-stream'});
        if (req.url.includes('/messages')) {
          const event = (type, data) => res.write('event: '+type+'\\n'+'data: '+JSON.stringify({ type, ...data })+'\\n\\n');
          event('message_start', {message:{id:'msg_fixture',type:'message',role:'assistant',model:'claude-opus-5',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
          event('content_block_start', {index:0,content_block:{type:'text',text:''}});
          event('content_block_delta', {index:0,delta:{type:'text_delta',text:value}});
          event('content_block_stop', {index:0});event('message_delta', {delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});event('message_stop', {});res.end();return;
        }
        if (req.url.includes('/responses')) {
          const response = {id:'resp_fixture',object:'response',status:'completed',model:'gpt-5.4',created_at:1,output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:value,annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
          const event = (type,data) => res.write('data: '+JSON.stringify({type,...data})+'\\n\\n');
          event('response.created',{response:{...response,status:'in_progress',output:[]}});
          event('response.output_item.added',{output_index:0,item:{id:'msg_fixture',type:'message',role:'assistant',content:[]}});
          event('response.content_part.added',{item_id:'msg_fixture',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
          event('response.output_text.delta',{item_id:'msg_fixture',output_index:0,content_index:0,delta:value});
          event('response.output_item.done',{output_index:0,item:response.output[0]});event('response.completed',{response});res.end();return;
        }
        res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:1,model:'deepseek-v4-flash',choices:[{index:0,delta:{role:'assistant',content:value},finish_reason:null}]})+'\\n\\n');
        res.write('data: '+JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:1,model:'deepseek-v4-flash',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\\n\\n');
        res.end('data: [DONE]\\n\\n');
      });
    }).listen(4781,'127.0.0.1');
  `,
    );
    await processCommand("docker", [
      "exec",
      "-d",
      `spectron-run-${id}`,
      "node",
      "/work/provider.cjs",
    ]);
    const partials: string[] = [];
    const result = await runtime.turn(
      run,
      "Inspect source and plan",
      AbortSignal.timeout(90000),
      async (s) => {
        activity.push(s);
      },
      async (s) => {
        partials.push(s);
      },
      async () => {
        activity.push("accepted");
      },
    );
    assert.equal(result.summary, "Fixture plan");
    assert.ok(partials.length);
    assert.ok(activity.includes("accepted"));
    assert.ok(activity.includes("Using read."));
    const session = await readFile(join(dir, "session"), "utf8");
    await runtime.turn(
      run,
      "Explicit steering: include concurrency",
      AbortSignal.timeout(30000),
      async () => {},
      async () => {},
      async () => {},
    );
    assert.equal(await readFile(join(dir, "session"), "utf8"), session);
    const requests = (
      await readFile(join(dir, "work", "requests.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(requests.at(-1).reasoning_effort, "high");
    assert.deepEqual(requests.at(-1).thinking, { type: "enabled" });
    assert.ok(
      requests
        .at(-1)
        .messages.some((m: { content: unknown }) =>
          JSON.stringify(m.content).includes("Explicit steering"),
        ),
    );
    assert.ok(
      requests
        .at(-1)
        .messages.some((m: { content: unknown }) =>
          JSON.stringify(m.content).includes("Inspect source"),
        ),
    );
    for (const [family, model, effort] of [
      ["openai", "gpt-5.4", "low"],
      ["anthropic", "claude-opus-5", "high"],
      ["zai", "glm-5.3", "max"],
      ["deepseek", "deepseek-v4-flash", "none"],
    ] as const) {
      const next = { ...identity, provider: family, model, effort };
      const settings = openCodeConfig(next, config.key);
      settings.provider.spectron.options.baseURL = "http://127.0.0.1:4781/v1";
      await writeFile(join(dir, "config.json"), JSON.stringify(settings));
      await rm(join(dir, "session"), { force: true });
      const response = await runtime.turn(
        { ...run, agent: next },
        "Inspect the repository",
        AbortSignal.timeout(30000),
        async () => {},
        async () => {},
        async () => {},
      );
      assert.equal(response.summary, "Fixture plan");
      const sent = JSON.parse(
        (await readFile(join(dir, "work", "requests.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .at(-1)!,
      );
      assert.equal(sent.model, model);
      if (family === "openai")
        assert.equal(sent.reasoning?.effort ?? sent.reasoning_effort, effort);
      else if (family === "anthropic")
        assert.equal(sent.output_config?.effort, effort);
      else if (effort === "none")
        assert.deepEqual(sent.thinking, { type: "disabled" });
      else assert.equal(sent.reasoning_effort, effort);
    }
    await rm(join(dir, "session"), { force: true });
    await assert.rejects(
      runtime.turn(
        run,
        "Reject fixture model request",
        AbortSignal.timeout(30000),
        async () => {},
        async () => {},
        async () => {},
      ),
      /model provider rejected the request format \(HTTP 400\)/,
    );
    await writeFile(join(dir, "session"), session);
    await processCommand("docker", [
      "exec",
      "-d",
      `spectron-run-${id}`,
      "sh",
      "-c",
      "sleep 10000 & wait",
    ]);
    await runtime.cleanup(id);
    await assert.rejects(readFile(join(dir, "config.json")));
    await runtime.prepare(
      run,
      config,
      AbortSignal.timeout(30000),
      async () => {},
    );
    assert.equal(await readFile(join(dir, "session"), "utf8"), session);
    await writeFile(join(dir, "config.json"), JSON.stringify(provider));
    await processCommand("docker", [
      "exec",
      "-d",
      `spectron-run-${id}`,
      "node",
      "/work/provider.cjs",
    ]);
    const restored = await runtime.turn(
      run,
      "Resume after container removal",
      AbortSignal.timeout(30000),
      async () => {},
      async () => {},
      async () => {},
    );
    assert.equal(restored.summary, "Fixture plan");
    assert.equal(await readFile(join(dir, "session"), "utf8"), session);
    assert.equal(
      await readFile(join(dir, "repos", repoId, "source.txt"), "utf8"),
      "original",
    );
    await writeFile(
      join(dir, "work", "notes", "decision.txt"),
      "Preserve the reasoning for continuation.",
    );
    const nextId = createId(),
      nextDir = join(root, nextId);
    const nextAgent = {
      ...identity,
      provider: "openai" as const,
      model: "gpt-5.4",
      effort: "low" as const,
    };
    const nextRun = {
      ...run,
      id: nextId,
      agent: nextAgent,
      context: { continuationId: id },
    };
    await mkdir(join(nextDir, "repos", repoId), { recursive: true });
    await writeFile(join(nextDir, `${repoId}.revision`), "a".repeat(40));
    const png = join(root, "pixel.png");
    await writeFile(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4jwQYiOMAANuQL9HsugRzAAAAAElFTkSuQmCC",
        "base64",
      ),
    );
    try {
      await runtime.prepare(
        nextRun,
        {
          ...config,
          attachments: [
            {
              id: createId(),
              filename: "pixel.png",
              contentType: "image/png",
              path: png,
            },
          ],
        },
        AbortSignal.timeout(30000),
        async () => {},
      );
      assert.equal(
        await readFile(join(nextDir, "work", "notes", "decision.txt"), "utf8"),
        "Preserve the reasoning for continuation.",
      );
      await assert.rejects(readFile(join(nextDir, "session")));
      const nativeConfig = openCodeConfig(nextAgent, config.key);
      nativeConfig.provider.spectron.options.baseURL =
        "http://127.0.0.1:4781/v1";
      await writeFile(
        join(nextDir, "config.json"),
        JSON.stringify(nativeConfig),
      );
      await writeFile(
        join(nextDir, "work", "provider.cjs"),
        await readFile(join(dir, "work", "provider.cjs")),
      );
      await processCommand("docker", [
        "exec",
        "-d",
        `spectron-run-${nextId}`,
        "node",
        "/work/provider.cjs",
      ]);
      await runtime.turn(
        nextRun,
        "Inspect the attached image",
        AbortSignal.timeout(30000),
        async () => {},
        async () => {},
        async () => {},
      );
      assert.match(
        await readFile(join(nextDir, "work", "requests.jsonl"), "utf8"),
        /data:image\/png;base64/,
      );
    } finally {
      await runtime.cleanup(nextId);
    }
  },
);

test(
  "networkless Docker relay forwards streamed model requests only to the host gateway",
  { skip: process.env.TEST_AGENT_DOCKER !== "true", timeout: 30000 },
  async () => {
    const name = `spectron-bridge-test-${createId()}`;
    const server = createServer(async (req, res) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      assert.equal(req.headers.authorization, "Bearer fixture-token");
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { model: "fixture" });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      res.end("data: last\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    let bridge: Awaited<ReturnType<typeof startModelBridge>> | undefined;
    try {
      await processCommand("docker", [
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "none",
        "--cap-drop=ALL",
        "spectron-agent:1.18.30",
      ]);
      bridge = await startModelBridge(name, address.port);
      await processCommand("docker", [
        "exec",
        name,
        "node",
        "-e",
        `
      (async()=>{
        const response=await fetch('http://127.0.0.1:4780/v1/responses',{method:'POST',headers:{authorization:'Bearer fixture-token'},body:JSON.stringify({model:'fixture'})});
        if(response.status!==200 || await response.text()!=='data: first\\n\\ndata: last\\n\\n')throw new Error('Invalid stream');
        const blocked=await fetch('http://127.0.0.1:4780/anything-else',{method:'POST'});if(blocked.status!==403)throw new Error('Invalid route allowed');
      })().catch(()=>process.exit(1));
    `,
      ]);
    } finally {
      bridge?.close();
      await processCommand("docker", ["rm", "-f", name]);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
