import { neon } from "@neondatabase/serverless";

let sql;

export function db() {
  const connectionString = process.env.GCN_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("GCN_DATABASE_URL or DATABASE_URL is not configured");
  sql ??= neon(connectionString);
  return sql;
}
