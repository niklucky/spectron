import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export { schema };
export { migrateDatabase } from "./migrations";
export type {
  User,
  Session,
  Account,
  Verification,
  Project,
  ProjectMember,
} from "./schema";
export function getDatabaseURL(env: NodeJS.ProcessEnv = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DATABASE_HOST && env.POSTGRES_PASSWORD) {
    const url = new URL(`postgresql://${env.DATABASE_HOST}:5432/spectron`);
    url.username = "spectron";
    url.password = env.POSTGRES_PASSWORD;
    return url.toString();
  }
  throw new Error("DATABASE_URL is required. See .env.example.");
}
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>["db"];
