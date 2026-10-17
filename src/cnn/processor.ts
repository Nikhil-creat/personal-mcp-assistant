import { readFile } from "node:fs/promises";
import path from "node:path";
import { query, toVector } from "../db/pool.js";
import { embed } from "../rag/embedder.js";

const WORKER = process.env.CNN_WORKER_URL ?? "http://localhost:8000";
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".bmp": "image/bmp" };

export interface VisionResult { text: string; boxes: unknown[]; features: unknown; size: { w: number; h: number } }

/** Resolve a path and refuse anything outside UPLOAD_DIR (path-traversal guard). */
export function safePath(p: string): string {
  const abs = path.resolve(UPLOAD_DIR, p);
  if (abs !== UPLOAD_DIR && !abs.startsWith(UPLOAD_DIR + path.sep)) throw new Error("Path outside upload directory");
  return abs;
}

export async function runCnn(buf: Buffer, name: string): Promise<VisionResult> {
  const ext = path.extname(name).toLowerCase();
  if (!MIME[ext]) throw new Error(`Unsupported image type: ${ext}`);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: MIME[ext] }), name);
  const res = await fetch(`${WORKER}/process`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`cnn-worker ${res.status}: ${await res.text()}`);
  return (await res.json()) as VisionResult;
}

export async function ingestVisualDocument(filePath: string) {
  const abs = safePath(filePath);
  const name = path.basename(abs);
  const r = await runCnn(await readFile(abs), name);
  const vec = toVector(await embed(`${name}\n${r.text}`));
  const [row] = await query(
    `INSERT INTO vision_documents (file_name,file_type,ocr_extracted_text,cnn_feature_map,bounding_boxes,embedding)
     VALUES ($1,$2,$3,$4,$5,$6::vector) RETURNING id`,
    [name, path.extname(name).slice(1), r.text, JSON.stringify(r.features), JSON.stringify(r.boxes), vec]
  );
  return { id: row.id as string, file_name: name, chars: r.text.length, regions: r.boxes.length, preview: r.text.slice(0, 300) };
}
