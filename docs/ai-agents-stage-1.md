# AI connections and agents — Stage 1

Implemented 2026-09-10. Open **account menu → AI connections & agents**.

## Setup

1. Set `AI_CREDENTIAL_SECRET` in the API environment to a stable random secret of at least 32 characters, for example generated with `openssl rand -base64 32`. `.env.example` and `compose.yaml` include the setting. Keep it backed up separately from the database. AI credential creation fails clearly if it is absent; unrelated features remain available.
2. Run `pnpm db:migrate` against the intended application database and restart the API. Migration `0017_milky_risque.sql` adds the four AI tables and enums. It has been applied to isolated test databases; this session did not migrate the existing development/application database.
3. Add a connection, then create agents from it. Use **Check connection** to test the saved key. Keys cannot be displayed again; leave the replacement field blank to retain the current key.

## Delivered behavior

- Personal connection create/list/rename/key replacement/delete, encrypted with AES-256-GCM. Encryption is versioned and authenticated against owner, connection, and provider IDs. Providers are immutable on existing connections; create a new connection to change provider.
- Saving validates key format, not remote authorization. Connections explicitly start **Not checked**. Key replacement resets check status, updates all referencing agents, and does not overwrite concurrent edits. A delayed check cannot mark a replaced key as valid.
- Owner-only agent create/edit/delete, uploaded and normalized avatar, model/effort validation, editable role, instructions, and stable identity with `kind: "agent"`. No human authentication account is created.
- Private by default; selected-member or whole-project grants independently per project. The owner and requester must currently belong to the active project. Membership deletion removes affected grants at the database level. Rejoining does not restore old selected-member grants or grants from an owner who left.
- **Project agents** shows only agents the current member may discover. Its API projection excludes API keys, encrypted keys, connection IDs, and system instructions. Future invocation code must recheck access rather than trust an earlier discovery result, and must additionally authorize repositories.
- Revision checks reject stale connection, agent, and sharing edits. Deleting an agent removes grants and leaves an identity tombstone for future history. Deleting a connection is blocked while active agents use it; deleted agents release their connection reference.

## Provider catalog and checks

`packages/shared/src/ai.ts` is a curated provider API catalog, checked against official documentation on 2026-09-10. It is not a list of every provider model or a claim of tested OpenCode compatibility. Unknown models and unsupported effort combinations are rejected instead of silently remapped.

| Provider | Configurable models | Effort settings |
| --- | --- | --- |
| OpenAI | `gpt-6-astra` | low, medium, high, xhigh, max |
| OpenAI | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | none, low, medium, high, xhigh, max |
| OpenAI | `gpt-5.4` | none, low, medium, high, xhigh |
| Z.ai | `glm-5.3`, `glm-5.3-flash` | low, high, max |
| DeepSeek | `deepseek-v4-pro`, `deepseek-v4-flash` | none, low, high, max |
| Anthropic | `claude-opus-5`, `claude-sonnet-5` | low, medium, high, xhigh, max |
| Anthropic | `claude-haiku-4-5-20251001` | no effort parameter; stored as null |

Defaults follow provider guidance where specified; GPT-6 Astra starts at medium as a Spectron UI choice. DeepSeek's `none` represents disabled thinking and will need the appropriate protocol mapping in the runner. GLM-5.3 thinking stays enabled. These settings describe provider semantics, not OpenCode variants.

OpenAI, Anthropic, and DeepSeek connection checks call their model-list APIs. Success establishes access to that endpoint, not generation permissions for every model. Z.ai checks use its documented general chat endpoint with `glm-5.3-flash`, low effort, and a 16-token output cap. The UI explicitly states that this check may use paid tokens. A token-limited response is sufficient for this credential check; it is not an answer-quality or tool-use test. Z.ai Coding Plan endpoint selection is not included.

All check destinations are fixed official HTTPS endpoints. Redirects are refused, requests have a 20-second timeout and a 512 KB response limit, and raw provider/transport errors never reach the UI. Saving does not call a paid API automatically.

Official references used for the catalog and check boundaries:

- OpenAI: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [list models](https://developers.openai.com/api/reference/resources/models/methods/list).
- Z.ai: [GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3), [official GLM-5.3-Flash model card](https://huggingface.co/zai-org/GLM-5.3-Flash), [chat request and effort controls](https://docs.z.ai/api-reference/llm/chat-completion). The flash-specific documentation page was unavailable during implementation; the official model card and common API reference establish the family and effort controls. Exact deployed flash access still requires a live check.
- DeepSeek: [thinking/effort](https://api-docs.deepseek.com/guides/thinking_mode/), [list models](https://api-docs.deepseek.com/api/list-models/).
- Anthropic: [model IDs](https://platform.claude.com/docs/en/models/overview), [effort](https://platform.claude.com/docs/en/build-with-claude/effort), [list models](https://platform.claude.com/docs/en/api/models/list).

## Credential operations

API key rotation is an owner action in the connection editor. It replaces a single encrypted value; agents retain their connection IDs. Empty key input on an update means omission/retain in the UI, while explicitly sending an empty key to the API fails validation. A provider outage or unsuccessful check never replaces the saved key.

`AI_CREDENTIAL_SECRET` is the server encryption key material, not a provider API key. No automatic server-key migration is included. To change it, retain a backup, coordinate a maintenance window, and have connection owners re-enter their provider keys under the new secret. Existing ciphertext cannot be decrypted with a different secret. Restoring the previous secret restores access to its ciphertext. Do not change it casually during deployment or use it as a provider key.

## Verification and handoff

- `pnpm test:ai`: 13 passing tests, including encryption/provider-boundary and authenticated API tests against a newly created isolated PostgreSQL database. Covers owner isolation, CSRF, key replacement, concurrent check/replacement, sharing across projects, nonblocking sharing reads during agent writes, empty selected grants becoming private, revoked membership, deleted identities, avatars, all catalog defaults, and unsupported efforts. Provider calls are mocked; no real API keys or paid calls were used.
- All workspace package typechecks and both production builds passed using `pnpm --recursive typecheck` and `pnpm --recursive --if-present build`.
- Browser verification used a disposable database, two synthetic users, and a nonfunctional provider key. Verified account navigation, empty states, connection creation, named-agent creation, correct DeepSeek effort options, private default, selected-member sharing, and discovery from the member account without editing controls. No browser console warnings/errors were reported.
- PR review regression checks used the real settings component with mocked actions in a temporary browser harness. Verified independent connection progress, failed-check alerts, saved feedback clearing before project-loading errors, trimmed connection names, and readable whitespace-only name/role validation. The harness was removed after testing.
- User verification: creating/updating an OpenAI connection and creating an agent succeeded. The OpenAI connection check passed with a newly generated key; an earlier key was rejected. This confirms model-list access for that key, not generation or tool use.
- Live checks for Z.ai, DeepSeek, and Anthropic remain untested. Generation and tool use remain **untested for every provider/model/effort combination**. OpenCode is not installed or pinned in Stage 1. Stage 3 must pin its version, map the catalog to provider/model identifiers and effort options, and run controlled smoke checks before claiming execution compatibility.
- Stage 2 is next: owner-managed GitHub and self-hosted GitLab connections, repositories, provider actor identity, and default branches. Do not add agent invocation or containers until Stage 3.

Key files: `packages/backend/src/ai.ts`, `ai-credentials.ts`; `packages/shared/src/ai.ts`; `packages/api/src/trpc/router.ts`; `packages/frontend/src/components/feature/account/ai-settings.tsx`; `apps/app/src/lib/ai-actions.ts`; migration `0017_milky_risque.sql`; tests `packages/api/test/ai.test.ts`.
