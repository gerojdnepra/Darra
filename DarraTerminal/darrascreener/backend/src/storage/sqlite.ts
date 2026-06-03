import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config";
import { applyMigrations } from "./migrations";

let db: Database.Database | null = null;

export const initializeSqlite = (filePath = config.sqlitePath): Database.Database => {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const nextDb = new Database(filePath);
  nextDb.pragma("journal_mode = WAL");
  nextDb.pragma("foreign_keys = ON");
  applyMigrations(nextDb);

  db = nextDb;
  return db;
};

export const getSqlite = (): Database.Database => {
  if (!db) {
    return initializeSqlite();
  }

  return db;
};

export const closeSqlite = (): void => {
  if (!db) {
    return;
  }

  db.close();
  db = null;
};
