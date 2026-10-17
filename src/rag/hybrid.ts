import { query, toVector } from "../db/pool.js";
import { embed } from "./embedder.js";

const SOURCES = {
  notes: { table: "notes", title: "title", body: "content" },
  vision: { table: "vision_documents", title: "file_name", body: "ocr_extracted_text" },
} as const;
export type Source = keyof typeof SOURCES;

export interface Hit { id: string; source: Source; title: string; snippet: string; score: number }

const RRF_K = 60;

/** Dense (pgvector cosine) + sparse (tsvector) lists fused with Reciprocal Rank Fusion. */
export async function hybridSearch(q: string, source: Source = "notes", limit = 5, pool = 25): Promise<Hit[]> {
  const s = SOURCES[source];
  const vec = toVector(await embed(q));
  const rows = await query(
    `WITH dense AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS r
       FROM ${s.table} WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $4),
     sparse AS (
       SELECT id, r FROM (
         SELECT t.id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(t.tsv, tq) DESC) AS r
         FROM ${s.table} t, websearch_to_tsquery('english', $2) tq WHERE t.tsv @@ tq) x
       WHERE r <= $4)
     SELECT t.id, t.${s.title} AS title, left(t.${s.body}, 400) AS snippet,
            COALESCE(1.0/(${RRF_K}+d.r),0) + COALESCE(1.0/(${RRF_K}+sp.r),0) AS score
     FROM ${s.table} t
     LEFT JOIN dense d ON d.id = t.id
     LEFT JOIN sparse sp ON sp.id = t.id
     WHERE d.id IS NOT NULL OR sp.id IS NOT NULL
     ORDER BY score DESC LIMIT $3`,
    [vec, q, limit, pool]
  );
  return rows.map((r: any) => ({ id: r.id, source, title: r.title, snippet: r.snippet, score: Number(r.score) }));
}
