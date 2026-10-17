import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://mcp:mcp@localhost:5432/mcp",
  max: 10,
});

pool.on("error", (err) => console.error("[pg] idle client error", err));

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(text, params as any[]);
  return res.rows;
}

export const toVector = (v: number[]) => `[${v.join(",")}]`;
