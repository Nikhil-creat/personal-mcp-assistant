// Personal MCP Assistant — designed and developed by NIKHIL CHARY SRIRAMOJU
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAgent } from "./agent/chatBot.js";
import { createMcpServer } from "./mcp/server.js";
import { ingestVisualDocument } from "./cnn/processor.js";
import { query } from "./db/pool.js";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /\.(png|jpe?g|webp|bmp)$/i.test(f.originalname)),
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const agents = new Map<string, Awaited<ReturnType<typeof createAgent>>>();

app.get("/health", (_q, r) => r.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  const p = z.object({ sessionId: z.string().min(1).max(100), message: z.string().min(1).max(4000) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  try {
    let agent = agents.get(p.data.sessionId);
    if (!agent) { agent = await createAgent(p.data.sessionId); agents.set(p.data.sessionId, agent); }
    res.json(await agent.chat(p.data.message));
  } catch (e) { console.error(e); res.status(500).json({ error: (e as Error).message }); }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Attach an image (png/jpg/webp/bmp) as 'file'" });
  try { res.json(await ingestVisualDocument(req.file.filename)); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

/** Nodes + edges for the 3D context graph. Edges: nearest neighbours by embedding + shared tags. */
app.get("/api/graph", async (_q, res) => {
  const [notes, docs, events, nn] = await Promise.all([
    query(`SELECT id,title,tags FROM notes ORDER BY created_at DESC LIMIT 60`),
    query(`SELECT id,file_name AS title FROM vision_documents ORDER BY created_at DESC LIMIT 30`),
    query(`SELECT id,title FROM calendar_events WHERE end_time>now()-interval '7 days' ORDER BY start_time LIMIT 30`),
    query(`SELECT a.id a, b.id b FROM notes a CROSS JOIN LATERAL (SELECT id FROM notes WHERE id<>a.id AND embedding IS NOT NULL ORDER BY embedding <=> a.embedding LIMIT 2) b WHERE a.embedding IS NOT NULL`),
  ]);
  const nodes = [
    ...notes.map((n: any) => ({ id: n.id, label: n.title, type: "note" })),
    ...docs.map((n: any) => ({ id: n.id, label: n.title, type: "vision" })),
    ...events.map((n: any) => ({ id: n.id, label: n.title, type: "event" })),
  ];
  const edges = nn.map((e: any) => ({ source: e.a, target: e.b }));
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++)
    if ((notes[i] as any).tags.some((t: string) => (notes[j] as any).tags.includes(t))) edges.push({ source: (notes[i] as any).id, target: (notes[j] as any).id });
  res.json({ nodes, edges });
});

/** MCP over streamable HTTP (stateless) so external MCP clients (Claude Desktop, Inspector) can connect. */
app.post("/mcp", async (req, res) => {
  const server = createMcpServer("http-" + randomUUID().slice(0, 8));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API + MCP listening on :${port}`));
