// A minimal D1Database over node:sqlite for unit tests. Plain JavaScript plus a declaration
// file because the repo has no @types/node, and adding it (or a Workers test pool) would be a
// dependency change. It applies migrations/*.sql in filename order, the same schema D1 gets.
// Shared test infrastructure: Wave 2 imports it read-only.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

function toSqlValue(v) {
  // D1 rejects undefined; mirroring that catches a missing field in the code under test.
  if (v === undefined) throw new Error("D1_TYPE_ERROR: undefined is not a supported bind value");
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function emptyMeta(changes = 0, lastRowId = 0) {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

class FakeStatement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    return new FakeStatement(this.sqlite, this.sql, values.map(toSqlValue));
  }

  execSync() {
    const stmt = this.sqlite.prepare(this.sql);
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...this.params).map((r) => ({ ...r }));
      return { success: true, meta: emptyMeta(), results: rows };
    }
    const info = stmt.run(...this.params);
    return { success: true, meta: emptyMeta(Number(info.changes), Number(info.lastInsertRowid)), results: [] };
  }

  async first(colName) {
    const row = this.execSync().results[0];
    if (!row) return null;
    return colName === undefined ? row : (row[colName] ?? null);
  }

  async all() {
    return this.execSync();
  }

  async run() {
    return this.execSync();
  }

  async raw(options) {
    const stmt = this.sqlite.prepare(this.sql);
    const rows = stmt.all(...this.params);
    const values = rows.map((r) => Object.values(r));
    if (options && options.columnNames) return [stmt.columns().map((c) => c.name), ...values];
    return values;
  }
}

class FakeD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    // D1 enforces foreign keys; node:sqlite does not by default.
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) this.sqlite.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  }

  prepare(sql) {
    return new FakeStatement(this.sqlite, sql);
  }

  async batch(statements) {
    // D1 runs a batch as one transaction: all or nothing.
    this.sqlite.exec("BEGIN");
    try {
      const out = statements.map((s) => s.execSync());
      this.sqlite.exec("COMMIT");
      return out;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  withSession() {
    return this;
  }

  async dump() {
    throw new Error("dump() is not supported by the fake");
  }
}

/** A fresh in-memory database with every migration applied. */
export function createFakeD1() {
  return new FakeD1();
}

/**
 * A full test Env over a fresh fake D1. The secrets are fixed local-only strings, never real
 * keys. Lives here, not in its own file, to stay inside the files the plan gives A1.
 */
export function testEnv(overrides = {}) {
  return {
    DB: createFakeD1(),
    ELEVEN_API_BASE: "https://eleven.test",
    NEBIUS_API_BASE: "https://nebius.test/v1",
    COACH_MODEL: "coach-model",
    REWRITE_MODEL: "rewrite-model",
    JOB_MODEL: "job-model",
    TTS_MODEL: "tts-model",
    AGENT_ID: "agent-test",
    ELEVENLABS_API_KEY: "test-eleven-key",
    NEBIUS_API_KEY: "test-nebius-key",
    LLM_PROXY_SECRET: "test-llm-secret",
    SESSION_SECRET: "test-session-secret",
    ADMIN_SECRET: "test-admin-secret",
    ...overrides,
  };
}
