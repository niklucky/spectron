import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@spectron/api/router";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${window.location.origin}/api/trpc` })],
});
