import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { query, toVector } from "../db/pool.js";
import { embed } from "../rag/embedder.js";
import { hybridSearch } from "../rag/hybrid.js";
import { ingestVisualDocument } from "../cnn/processor.js";
import { complete, REFLECT_MODEL } from "../agent/groq.js";

const iso = z.string().datetime({ offset: true }).describe("ISO-8601 with offset, e.g. 2026-10-20T15:00:00+05:30");
const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] });

export function createMcpServer(sessionId = "default") {
  const server = new McpServer({ name: "personal-mcp-assistant", version: "1.0.0" });

  const audit = (name: string, args: unknown, out: unknown, ms: number) =>
    query(`INSERT INTO mcp_tool_audit (session_id,tool_name,input_payload,output_payload,latency_ms) VALUES ($1,$2,$3,$4,$5)`,
      [sessionId, name, JSON.stringify(args), JSON.stringify(out), ms]).catch(() => {});

  /** Registers a tool with Zod validation, error capture and audit logging. */
  function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
    server.tool(name, description, shape, async (args: any) => {
      const t0 = Date.now();
      try {
        const out = await fn(args);
        await audit(name, args, out, Date.now() - t0);
        return ok(out);
      } catch (e) {
        await audit(name, args, { error: (e as Error).message }, Date.now() - t0);
        return fail(e);
      }
    });
  }

  // ---------- Calendar ----------
  tool("get_events", "List calendar events overlapping a time window.", { start_date: iso, end_date: iso }, async (a) =>
    query(`SELECT * FROM calendar_events WHERE status<>'cancelled' AND start_time < $2 AND end_time > $1 ORDER BY start_time`, [a.start_date, a.end_date]));

  tool("create_event", "Create a calendar event.", {
    title: z.string().min(1).max(200), start_time: iso, end_time: iso,
    description: z.string().max(4000).optional(), location: z.string().max(200).optional(), attendees: z.array(z.string()).max(50).optional(),
  }, async (a) => {
    const [r] = await query(`INSERT INTO calendar_events (title,description,start_time,end_time,location,attendees) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.title, a.description ?? null, a.start_time, a.end_time, a.location ?? null, a.attendees ?? []]);
    return r;
  });

  tool("reschedule_event", "Move an event to a new time.", { id: z.string().uuid(), start_time: iso, end_time: iso }, async (a) => {
    const [r] = await query(`UPDATE calendar_events SET start_time=$2,end_time=$3 WHERE id=$1 RETURNING *`, [a.id, a.start_time, a.end_time]);
    if (!r) throw new Error("Event not found");
    return r;
  });

  tool("detect_schedule_conflicts", "Find overlapping events in a window.", { start_date: iso, end_date: iso }, async (a) =>
    query(`SELECT a.id a_id,a.title a_title,a.start_time a_start,a.end_time a_end,b.id b_id,b.title b_title,b.start_time b_start,b.end_time b_end
           FROM calendar_events a JOIN calendar_events b ON a.id<b.id AND a.start_time<b.end_time AND b.start_time<a.end_time
           WHERE a.status<>'cancelled' AND b.status<>'cancelled' AND a.start_time<$2 AND a.end_time>$1`, [a.start_date, a.end_date]));

  // ---------- Notes & documents ----------
  tool("hybrid_search_notes", "Hybrid dense+lexical (RRF) search over notes or OCR'd visual documents.",
    { query: z.string().min(1).max(500), source: z.enum(["notes", "vision"]).default("notes"), limit: z.number().int().min(1).max(20).default(5) },
    async (a) => hybridSearch(a.query, a.source, a.limit));

  tool("create_note", "Create a note (auto-embedded).", { title: z.string().min(1).max(200), content: z.string().min(1).max(50000), tags: z.array(z.string()).max(20).optional() }, async (a) => {
    const [r] = await query(`INSERT INTO notes (title,content,tags,embedding) VALUES ($1,$2,$3,$4::vector) RETURNING id,title,tags,created_at`,
      [a.title, a.content, a.tags ?? [], toVector(await embed(`${a.title}\n${a.content}`))]);
    return r;
  });

  tool("update_note", "Update a note's fields and re-embed.", { id: z.string().uuid(), title: z.string().max(200).optional(), content: z.string().max(50000).optional(), tags: z.array(z.string()).optional() }, async (a) => {
    const [cur] = await query(`SELECT * FROM notes WHERE id=$1`, [a.id]);
    if (!cur) throw new Error("Note not found");
    const title = a.title ?? cur.title, content = a.content ?? cur.content;
    const [r] = await query(`UPDATE notes SET title=$2,content=$3,tags=$4,embedding=$5::vector,updated_at=now() WHERE id=$1 RETURNING id,title,tags,updated_at`,
      [a.id, title, content, a.tags ?? cur.tags, toVector(await embed(`${title}\n${content}`))]);
    return r;
  });

  tool("ingest_visual_document", "Run the CNN/OCR pipeline on an uploaded image (path relative to UPLOAD_DIR) and index it.", { file_path: z.string().min(1).max(300) },
    async (a) => ingestVisualDocument(a.file_path));

  // ---------- Memory ----------
  tool("store_agent_fact", "Persist a fact to agent memory.", { fact: z.string().min(1).max(2000), memory_type: z.enum(["short_term", "long_term", "episodic"]).default("long_term") }, async (a) => {
    const [r] = await query(`INSERT INTO agent_memories (session_id,memory_type,key_facts,embedding) VALUES ($1,$2,$3,$4::vector) RETURNING id`,
      [sessionId, a.memory_type, JSON.stringify({ fact: a.fact }), toVector(await embed(a.fact))]);
    return r;
  });

  tool("retrieve_long_term_memory", "Semantic recall from long-term/episodic memory.", { query: z.string().min(1).max(500), limit: z.number().int().min(1).max(10).default(5) }, async (a) =>
    query(`UPDATE agent_memories SET last_accessed_at=now() WHERE id IN (
             SELECT id FROM agent_memories WHERE memory_type IN ('long_term','episodic') AND embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2)
           RETURNING id,memory_type,key_facts`, [toVector(await embed(a.query)), a.limit]));

  // ---------- Autonomous loop helpers ----------
  tool("reflect_and_validate", "Check a draft answer against its source context for hallucinations and time-zone/schedule errors.",
    { draft: z.string().min(1).max(20000), context: z.string().max(40000) }, async (a) => {
      const raw = await complete(
        `You are a strict fact-checker. Compare DRAFT to CONTEXT. Return JSON {"grounded":boolean,"timezone_ok":boolean,"issues":string[],"corrected":string}. Flag any detail in DRAFT not supported by CONTEXT. "corrected" is the draft with unsupported claims removed or marked.`,
        `CONTEXT:\n${a.context}\n\nDRAFT:\n${a.draft}`, REFLECT_MODEL, true);
      try { return JSON.parse(raw); } catch { return { grounded: false, timezone_ok: false, issues: ["validator returned invalid JSON"], corrected: a.draft }; }
    });

  tool("synthesize_cross_context_summary", "Gather notes, visual docs and calendar events for a topic/window and draft a prep summary.",
    { topic: z.string().min(1).max(300), start_date: iso, end_date: iso }, async (a) => {
      const [notes, vis, events] = await Promise.all([
        hybridSearch(a.topic, "notes", 5), hybridSearch(a.topic, "vision", 3),
        query(`SELECT title,start_time,end_time,location,attendees FROM calendar_events WHERE status<>'cancelled' AND start_time<$2 AND end_time>$1 ORDER BY start_time`, [a.start_date, a.end_date]),
      ]);
      const context = JSON.stringify({ notes, vision_docs: vis, events });
      const summary = await complete("Write a concise preparation summary using ONLY the context. Cite note/doc titles and event times with offsets. Say so if context is thin.", `TOPIC: ${a.topic}\nCONTEXT: ${context}`);
      return { summary, context };
    });

  // ---------- Resources & prompts ----------
  server.resource("upcoming-events", "calendar://upcoming", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await query(`SELECT * FROM calendar_events WHERE end_time>now() AND status<>'cancelled' ORDER BY start_time LIMIT 20`)) }],
  }));
  server.prompt("prep_summary", "Prepare for an upcoming week using notes + calendar", { topic: z.string() }, ({ topic }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Cross-reference my notes and visual documents about "${topic}" with my calendar and draft a preparation summary.` } }],
  }));

  return server;
}
