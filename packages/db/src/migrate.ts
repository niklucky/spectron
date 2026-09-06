import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createDatabase, migrateDatabase, getDatabaseURL } from "./index";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
const { db, pool } = createDatabase(getDatabaseURL());
try {
  await migrateDatabase(db);
  console.info("Database migrations applied.");
} finally {
  await pool.end();
}
