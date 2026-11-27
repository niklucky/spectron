# @spectron/cli

The `spectron` command: Spectron issues from the terminal, for people and agents. It is a dependency-free client over the public REST API (`/api/v1`). Usage is documented in [docs/cli.md](../../docs/cli.md).

- `src/cli.ts`: commands, argument parsing and output. `run(argv, io)` takes its environment, streams and `fetch` as arguments, so tests drive it in process.
- `src/client.ts`: the HTTP client. It only sends the token to the configured server.
- `src/config.ts`: saved login (`~/.config/spectron/config.json`, mode 600) and `SPECTRON_URL`/`SPECTRON_TOKEN` overrides.
- `src/format.ts`: text output.

`pnpm --filter @spectron/cli build` compiles to `dist/`. `pnpm test:cli` (root) runs it against a real API and a disposable database (`packages/api/test/cli.test.ts`).
