import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port:
        Number(new URL(env.APP_URL || "http://localhost:5173").port) || 5173,
      strictPort: true,
      proxy: {
        "/api/flow/events": { target: `http://127.0.0.1:${env.API_PORT || 3001}`, ws: true },
        "/api": { target: `http://127.0.0.1:${env.API_PORT || 3001}` },
        // The CLI installer (`pnpm --filter @spectron/cli build` first).
        // Only /cli, /cli/… and /cli?…, not /clients. Matched against the raw URL.
        "^/cli(?:[/?]|$)": { target: `http://127.0.0.1:${env.API_PORT || 3001}` },
        // OAuth discovery for MCP clients is served by the API at the site root.
        "^/\\.well-known/(oauth-authorization-server|oauth-protected-resource|openid-configuration)": {
          target: `http://127.0.0.1:${env.API_PORT || 3001}`,
        },
      },
    },
  };
});
