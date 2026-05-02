import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../schema.js";

export type RepositoryDatabase = NodePgDatabase<typeof schema>;

export type RepositoryExecutor = Pick<RepositoryDatabase, "select" | "insert" | "update" | "delete">;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function subtractDays(date: Date, days: number): Date {
  return addDays(date, -days);
}
