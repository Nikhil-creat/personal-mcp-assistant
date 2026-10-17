// MCP-style tool registry for the browser. Each tool has a JSON schema, validated before execution, and is audited.
import { data, save, uid, settings, tzOffset } from "./store.js";
import { embed, hybrid } from "./rag.js";
import { groqComplete } from "./agent.js";

const isoOk = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));
const S = (o) => ({ type: "object", properties: o.p, required: o.r || [], additionalProperties: false });
const iso = { type: "string", format: "date-time", description: "ISO-8601 with offset, e.g. 2026-10-20T15:00:00+05:30" };

function validate(schema, a) {
  if (typeof a !== "object" || a === null) throw new Error("Arguments must be an object");
  for (const r of schema.required) if (a[r] === undefined) throw new Error(`Missing required field: ${r}`);
  for (const [k, v] of Object.entries(a)) {
    const p = schema.properties[k]; if (!p) throw new Error(`Unknown field: ${k}`);
    if (p.type === "string" && (typeof v !== "string" || v.length > 20000)) throw new Error(`${k} must be a string`);
    if (p.format === "date-time" && !isoOk(v)) throw new Error(`${k} must be an ISO-8601 datetime`);
    if (p.type === "number" && typeof v !== "number") throw new Error(`${k} must be a number`);
    if (p.type === "array" && !Array.isArray(v)) throw new Error(`${k} must be an array`);
    if (p.enum && !p.enum.includes(v)) throw new Error(`${k} must be one of ${p.enum.join(", ")}`);
  }
}
export const searchItems = (source) => source === "vision"
  ? data().docs.map((d) => ({ id: d.id, source: "vision", title: d.name, text: d.text, vec: d.vec }))
  : data().notes.map((n) => ({ id: n.id, source: "notes", title: n.title, text: n.content + " " + n.tags.join(" "), vec: n.vec }));
const overlap = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
const inWin = (e, s, t) => e.status !== "cancelled" && Date.parse(e.start) < Date.parse(t) && Date.parse(e.end) > Date.parse(s);

export const tools = [
  { name: "get_events", description: "List calendar events overlapping a time window.", parameters: S({ p: { start_date: iso, end_date: iso }, r: ["start_date", "end_date"] }),
    run: (a) => data().events.filter((e) => inWin(e, a.start_date, a.end_date)).sort((x, y) => Date.parse(x.start) - Date.parse(y.start)) },
  { name: "create_event", description: "Create a calendar event.", parameters: S({ p: { title: { type: "string" }, start_time: iso, end_time: iso, description: { type: "string" }, location: { type: "string" }, attendees: { type: "array", items: { type: "string" } } }, r: ["title", "start_time", "end_time"] }),
    run: (a) => { if (Date.parse(a.end_time) <= Date.parse(a.start_time)) throw new Error("end_time must be after start_time");
      const e = { id: uid(), title: a.title.slice(0, 200), description: a.description || "", start: new Date(a.start_time).toISOString(), end: new Date(a.end_time).toISOString(), location: a.location || "", attendees: a.attendees || [], status: "confirmed" };
      data().events.push(e); save(); return e; } },
  { name: "reschedule_event", description: "Move an event to a new time.", parameters: S({ p: { id: { type: "string" }, start_time: iso, end_time: iso }, r: ["id", "start_time", "end_time"] }),
    run: (a) => { const e = data().events.find((x) => x.id === a.id); if (!e) throw new Error("Event not found");
      if (Date.parse(a.end_time) <= Date.parse(a.start_time)) throw new Error("end_time must be after start_time");
      e.start = new Date(a.start_time).toISOString(); e.end = new Date(a.end_time).toISOString(); save(); return e; } },
  { name: "detect_schedule_conflicts", description: "Find overlapping events in a window.", parameters: S({ p: { start_date: iso, end_date: iso }, r: ["start_date", "end_date"] }),
    run: (a) => { const ev = data().events.filter((e) => inWin(e, a.start_date, a.end_date)); const out = [];
      for (let i = 0; i < ev.length; i++) for (let j = i + 1; j < ev.length; j++) if (overlap(ev[i], ev[j])) out.push({ a: ev[i], b: ev[j] }); return out; } },
  { name: "hybrid_search_notes", description: "Hybrid dense+lexical (RRF) search over notes or OCR'd visual documents.", parameters: S({ p: { query: { type: "string" }, source: { type: "string", enum: ["notes", "vision"] }, limit: { type: "number" } }, r: ["query"] }),
    run: (a) => hybrid(searchItems(a.source || "notes"), a.query, Math.min(20, Math.max(1, a.limit || 5))) },
  { name: "create_note", description: "Create a note.", parameters: S({ p: { title: { type: "string" }, content: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, r: ["title", "content"] }),
    run: (a) => { const n = { id: uid(), title: a.title.slice(0, 200), content: a.content, tags: (a.tags || []).map(String).slice(0, 20), created: new Date().toISOString(), vec: embed(a.title + " " + a.content) };
      data().notes.unshift(n); save(); return { id: n.id, title: n.title, tags: n.tags }; } },
  { name: "update_note", description: "Update a note's fields.", parameters: S({ p: { id: { type: "string" }, title: { type: "string" }, content: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, r: ["id"] }),
    run: (a) => { const n = data().notes.find((x) => x.id === a.id); if (!n) throw new Error("Note not found");
      if (a.title) n.title = a.title; if (a.content) n.content = a.content; if (a.tags) n.tags = a.tags.map(String); n.vec = embed(n.title + " " + n.content); save(); return { id: n.id, title: n.title, tags: n.tags }; } },
  { name: "ingest_visual_document", description: "Lists scanned documents already ingested via the Vision tab (images are processed in the Vision tab, not by the agent).", parameters: S({ p: {} }),
    run: () => data().docs.map((d) => ({ id: d.id, name: d.name, chars: d.text.length })) },
  { name: "store_agent_fact", description: "Persist a fact to agent memory.", parameters: S({ p: { fact: { type: "string" }, memory_type: { type: "string", enum: ["short_term", "long_term", "episodic"] } }, r: ["fact"] }),
    run: (a) => { const m = { id: uid(), type: a.memory_type || "long_term", fact: a.fact.slice(0, 1000), at: new Date().toISOString(), vec: embed(a.fact) }; data().memories.unshift(m); save(); return { id: m.id }; } },
  { name: "retrieve_long_term_memory", description: "Semantic recall from long-term/episodic memory.", parameters: S({ p: { query: { type: "string" }, limit: { type: "number" } }, r: ["query"] }),
    run: (a) => hybrid(data().memories.filter((m) => m.type !== "short_term").map((m) => ({ id: m.id, source: "memory", title: m.type, text: m.fact, vec: m.vec })), a.query, a.limit || 5) },
  { name: "reflect_and_validate", description: "Check a draft answer against context for hallucinations and timezone errors.", parameters: S({ p: { draft: { type: "string" }, context: { type: "string" } }, r: ["draft", "context"] }),
    run: async (a) => { const raw = await groqComplete(`You are a strict fact-checker. Compare DRAFT to CONTEXT. Return JSON {"grounded":boolean,"timezone_ok":boolean,"issues":string[],"corrected":string}. Flag details in DRAFT unsupported by CONTEXT. "corrected" is the draft with unsupported claims removed.`, `CONTEXT:\n${a.context.slice(0, 24000)}\n\nDRAFT:\n${a.draft}`, true);
      try { return JSON.parse(raw); } catch { return { grounded: false, timezone_ok: false, issues: ["invalid validator output"], corrected: a.draft }; } } },
  { name: "synthesize_cross_context_summary", description: "Gather notes, documents and events for a topic and window, then draft a prep summary.", parameters: S({ p: { topic: { type: "string" }, start_date: iso, end_date: iso }, r: ["topic", "start_date", "end_date"] }),
    run: async (a) => { const notes = hybrid(searchItems("notes"), a.topic, 5), vis = hybrid(searchItems("vision"), a.topic, 3);
      const events = data().events.filter((e) => inWin(e, a.start_date, a.end_date)); const context = JSON.stringify({ notes, vision_docs: vis, events });
      const summary = await groqComplete("Write a concise preparation summary using ONLY the context. Cite note/doc titles and event times. Say so if context is thin.", `TOPIC: ${a.topic}\nCONTEXT: ${context}`);
      return { summary, context }; } },
];

export const groqTools = () => tools.filter((t) => t.name !== "reflect_and_validate").map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

export async function callTool(name, args) {
  const t = tools.find((x) => x.name === name); const t0 = performance.now(); let out, err;
  try { if (!t) throw new Error(`Unknown tool: ${name}`); validate(t.parameters, args || {}); out = await t.run(args || {}); }
  catch (e) { err = e.message; }
  data().audit.unshift({ id: uid(), tool: name, input: JSON.stringify(args).slice(0, 600), output: JSON.stringify(err ? { error: err } : out).slice(0, 600), ms: Math.round(performance.now() - t0), at: new Date().toISOString() });
  data().audit.length = Math.min(data().audit.length, 200); save();
  if (err) throw new Error(err); return out;
}
export const nowInfo = () => { const s = settings(); return `${new Date().toLocaleString("en-IN", { timeZone: s.tz })} (${s.tz}, UTC${tzOffset(s.tz)})`; };
