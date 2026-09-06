import { createAuthClient } from "better-auth/react";

// Same-origin /api requests use the Vite proxy locally and Nginx when deployed.
export const authClient = createAuthClient({ baseURL: window.location.origin });
