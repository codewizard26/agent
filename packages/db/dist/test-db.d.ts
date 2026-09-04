import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";
export interface TestDb {
    db: ReturnType<typeof drizzle<typeof schema>>;
    close: () => Promise<void>;
}
/**
 * In-process Postgres for tests. No Docker, no shared state — each call is a
 * fresh database. DDL is applied directly rather than through drizzle-kit so
 * tests do not depend on generated migration files being current.
 */
export declare function createTestDb(): Promise<TestDb>;
