import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";
import { DDL } from "./client.js";

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  close: () => Promise<void>;
}

/**
 * In-process Postgres for tests. No Docker, no shared state — each call is a
 * fresh database. DDL is applied directly rather than through drizzle-kit so
 * tests do not depend on generated migration files being current.
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });

  // pg.exec, not drizzle db.execute: drizzle prepares the statement and PGlite
  // rejects multiple commands in a prepared statement.
  await pg.exec(DDL);

  return { db, close: async () => await pg.close() };
}
