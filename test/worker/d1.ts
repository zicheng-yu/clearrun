/** A small D1 stand-in over node:sqlite, so tests can run the Worker's storage code without the Workers runtime. Not type-checked (see tsconfig.node.json). */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const value = (v: unknown): SQLInputValue => (v === undefined ? null : typeof v === "boolean" ? Number(v) : (v as SQLInputValue));

class Statement {
	private readonly db: DatabaseSync;
	private readonly sql: string;
	private readonly params: SQLInputValue[];

	constructor(db: DatabaseSync, sql: string, params: SQLInputValue[] = []) {
		this.db = db;
		this.sql = sql;
		this.params = params;
	}

	bind(...params: unknown[]): Statement {
		return new Statement(this.db, this.sql, params.map(value));
	}

	rows(): Record<string, unknown>[] {
		return this.db
			.prepare(this.sql)
			.all(...this.params)
			.map((r) => ({ ...r }));
	}

	async first<T>(): Promise<T | null> {
		return (this.rows()[0] as T | undefined) ?? null;
	}

	async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
		return { results: this.rows() as T[], success: true, meta: {} };
	}

	async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
		this.rows();
		return { success: true, meta: {} };
	}
}

export function memoryD1(): D1Database {
	const db = new DatabaseSync(":memory:");
	return {
		prepare: (sql: string) => new Statement(db, sql),
		async batch(statements: Statement[]) {
			db.exec("BEGIN");
			try {
				const out = statements.map((s) => ({ results: s.rows(), success: true, meta: {} }));
				db.exec("COMMIT");
				return out;
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
		async exec(sql: string) {
			db.exec(sql);
			return { count: 0, duration: 0 };
		},
	} as unknown as D1Database;
}
