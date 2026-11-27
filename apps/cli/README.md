# @spectron/cli

The `spectron` command: Spectron issues from the terminal, for people and agents. It is a dependency-free client over the public REST API (`/api/v1`). Usage is documented in [docs/cli.md](../../docs/cli.md).

- `src/cli.ts`: commands, argument parsing and output. `run(argv, io)` takes its environment, streams and `fetch` as arguments, so tests drive it in process.
- `src/client.ts`: the HTTP client. It only sends the token to the configured server.
- `src/config.ts`: saved login (`~/.config/spectron/config.json`, mode 600) and `SPECTRON_URL`/`SPECTRON_TOKEN` overrides.
- `src/format.ts`: text output.

- `install.sh`: the installer behind `curl -fsSL <server>/cli/install.sh | sh`. The API serves it at `/cli/install.sh`, filling in the server's address and the bundle's SHA-256 (`packages/api/src/cli-install.ts`). It records the address in `install.json` beside the CLI, and `src/main.ts` reads that as the default server for `auth login`.

`pnpm --filter @spectron/cli build` runs `build.mjs`, which bundles everything into one file, `dist/spectron.mjs`, and copies `install.sh` beside it. `Dockerfile.api` builds it for the server to serve. `pnpm test:cli` (root) runs it against a real API and a disposable database (`packages/api/test/cli.test.ts`), and runs the installer through `curl | sh` into a temporary home (`cli-install.test.ts`).
