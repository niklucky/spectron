# @spectron/cli

The `spectron` command: Spectron issues from the terminal, for people and agents. It is a dependency-free client over the public REST API (`/api/v1`). Usage is documented in [docs/cli.md](../../docs/cli.md).

- `src/cli.ts`: commands, argument parsing and output. `run(argv, io)` takes its environment, streams and `fetch` as arguments, so tests drive it in process.
- `src/client.ts`: the HTTP client. It only sends the token to the configured server.
- `src/config.ts`: saved login (`~/.config/spectron/config.json`, mode 600) and `SPECTRON_URL`/`SPECTRON_TOKEN` overrides.
- `src/format.ts`: text output.
- `src/upgrade.ts`: `spectron upgrade`. It compares the running bundle with the server's `/cli/manifest.json` and replaces it in place.

- `install.sh` and `install.ps1`: the installers behind `curl -fsSL <server>/cli/install.sh | sh` and `irm <server>/cli/install.ps1 | iex`. The API serves them at `/cli/`, filling in the server's address and the bundle's SHA-256 (`packages/api/src/cli-install.ts`). They record the address in `install.json` beside the CLI, and `src/main.ts` reads that as the default server for `auth login`. The Windows installer adds a `spectron.cmd` launcher and puts its folder on the user `PATH`.

`pnpm --filter @spectron/cli build` runs `build.mjs`. It bundles everything into one file, `dist/spectron.mjs`, stamped with `SPECTRON_VERSION` (the release tag, or `0.0.0-dev` locally), copies both installers beside it, and writes `manifest.json`. `Dockerfile.api` builds it for the server to serve. `pnpm test:cli` (root) runs it against a real API and a disposable database (`packages/api/test/cli.test.ts`), runs the installer through `curl | sh` into a temporary home (`cli-install.test.ts`), and runs the PowerShell installer wherever PowerShell exists (`cli-install-windows.test.ts`; CI also runs it on Windows with PowerShell 5.1 and 7).
