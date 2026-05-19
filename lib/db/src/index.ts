import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";

// Idempotent index migrations — safe to run on every startup.
// These partial unique indexes are the last line of defense against double-credits
// when a webhook and the Circle poll race to insert the same deposit concurrently.
// The server does not use Drizzle migrate, so this function applies them directly.
export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS deposits_tx_hash_unique
        ON deposits(tx_hash) WHERE tx_hash IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS deposits_deposit_reference_unique
        ON deposits(deposit_reference) WHERE deposit_reference IS NOT NULL;
    `);
    console.info("[db-migration] Unique indexes verified on deposits table.");
  } catch (err: any) {
    // Duplicate values in the table prevent index creation.
    // The server can still start; SELECT-before-INSERT guards provide partial protection
    // until duplicates are manually cleaned with the SQL below.
    console.error(
      `[db-migration] WARNING: Could not create unique index — duplicate deposit_reference or tx_hash values exist.\n` +
      `Error: ${err.message}\n\n` +
      `Run this SQL to find and remove duplicates, then restart the server:\n\n` +
      `-- 1. Inspect duplicates:\n` +
      `SELECT deposit_reference, count(*), array_agg(id ORDER BY id) AS ids,\n` +
      `       array_agg(tx_hash ORDER BY id) AS hashes, MAX(user_id) AS user_id,\n` +
      `       MAX(amount::numeric) AS amount\n` +
      `FROM deposits WHERE deposit_reference IS NOT NULL\n` +
      `GROUP BY deposit_reference HAVING count(*) > 1;\n\n` +
      `-- 2. Delete the duplicate without a tx_hash (keep the one with tx_hash):\n` +
      `DELETE FROM deposits d\n` +
      `WHERE tx_hash IS NULL\n` +
      `  AND deposit_reference IS NOT NULL\n` +
      `  AND EXISTS (\n` +
      `    SELECT 1 FROM deposits d2\n` +
      `    WHERE d2.deposit_reference = d.deposit_reference\n` +
      `      AND d2.tx_hash IS NOT NULL\n` +
      `  );\n\n` +
      `-- 3. Subtract the duplicate credits from affected users:\n` +
      `-- (run once per affected user_id / amount pair found in step 1)\n` +
      `-- UPDATE users SET claimed_balance = claimed_balance - <amount> WHERE id = <user_id>;\n`,
    );
  } finally {
    client.release();
  }
}
