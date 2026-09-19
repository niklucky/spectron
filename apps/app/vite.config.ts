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
      proxy: { "/api": { target: `http://127.0.0.1:${env.API_PORT || 3001}` } },
    },
  };
});
