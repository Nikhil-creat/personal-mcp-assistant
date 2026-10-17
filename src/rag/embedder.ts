import { createHash } from "node:crypto";

export const DIM = 1536;

/** Local, dependency-free hashed bag-of-words + char-trigram embedder (L2-normalised).
 *  Works offline; for real semantic quality set EMBEDDING_URL to any OpenAI-compatible endpoint (1536 dims). */
function hashedEmbed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const add = (tok: string, w: number) => {
    const h = createHash("md5").update(tok).digest();
    v[h.readUInt32LE(0) % DIM] += h[4] & 1 ? w : -w;
  };
  for (const w of t.split(/\s+/).filter(Boolean)) {
    add("w:" + w, 1);
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) add("c:" + p.slice(i, i + 3), 0.3);
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export async function embed(text: string): Promise<number[]> {
  const url = process.env.EMBEDDING_URL;
  if (!url) return hashedEmbed(text);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.EMBEDDING_API_KEY ?? ""}` },
    body: JSON.stringify({ model: process.env.EMBEDDING_MODEL, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`Embedding endpoint ${res.status}`);
  const j: any = await res.json();
  const e: number[] = j.data?.[0]?.embedding;
  if (!e || e.length !== DIM) throw new Error(`Embedding must be ${DIM} dims`);
  return e;
}
