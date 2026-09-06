import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./index";

export function migrateDatabase(db: Database, migrationsSchema = "drizzle") {
  return migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
    migrationsSchema,
  });
}
