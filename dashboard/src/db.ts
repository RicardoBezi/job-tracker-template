import { neon } from "@neondatabase/serverless";

let sql: ReturnType<typeof neon> | null = null;
export function initDb(databaseUrl: string) { sql = neon(databaseUrl); }
export function q(strings: TemplateStringsArray, ...vals: unknown[]) {
  if (!sql) throw new Error("db not initialized");
  return sql(strings, ...vals);
}
