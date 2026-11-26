import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// Same-origin /api requests use the Vite proxy locally and Nginx when deployed.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  // oauthProviderClient sends the signed OAuth request on sign-in when the
  // page carries one, so the server can resume an MCP client's authorization.
  plugins: [magicLinkClient(), oauthProviderClient()],
});
