import { settings, tzOffset } from "./store.js";
import { groqTools, callTool, nowInfo, searchItems } from "./tools.js";
import { hybrid } from "./rag.js";
import { data, fmt } from "./store.js";

const MAX_STEPS = 8;
async function groqChat(body) {
  const s = settings(); if (!s.groqKey) throw new Error("Add your Groq API key in Settings");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.groqKey }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
export async function groqComplete(system, user, json = false) {
  const r = await groqChat({ model: settings().model, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(json ? { response_format: { type: "json_object" } } : {}) });
  return r.choices[0]?.message?.content || "";
}

const sys = () => `You are a personal assistant with tools for the user's calendar, notes, scanned documents and memory.
Current time: ${nowInfo()}. Always pass ISO-8601 timestamps WITH the user's UTC offset (${tzOffset(settings().tz)}).
Work in a ReAct loop: think, call tools, read results, repeat. Search notes AND vision documents with hybrid_search_notes before answering from knowledge.
Never invent notes, events or times. If tools return nothing, say so plainly. Be concise.`;

const history = [];
export function resetHistory() { history.length = 0; }

/** Offline fallback when no Groq key is set: local hybrid retrieval + upcoming events. */
function offline(q) {
  const notes = hybrid(searchItems("notes"), q, 4), docs = hybrid(searchItems("vision"), q, 3);
  const up = data().events.filter((e) => Date.parse(e.end) > Date.now()).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 5);
  let t = "**Offline mode** (add a Groq key in Settings for the full agent).\n\n";
  t += notes.length ? "Top notes:\n" + notes.map((h) => `• ${h.title} — ${h.snippet.slice(0, 120)}`).join("\n") : "No matching notes.";
  if (docs.length) t += "\n\nScanned documents:\n" + docs.map((h) => `• ${h.title} — ${h.snippet.slice(0, 120)}`).join("\n");
  t += up.length ? "\n\nUpcoming events:\n" + up.map((e) => `• ${e.title} — ${fmt(e.start)}`).join("\n") : "\n\nNo upcoming events.";
  return { answer: t, steps: [] };
}

export async function chat(userText, onStep = () => {}) {
  const s = settings();
  if (s.api) { // Docker backend mode
    const r = await fetch(s.api.replace(/\/$/, "") + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: "web-" + (localStorage.sid ||= Math.random().toString(36).slice(2)), message: userText }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Backend error"); return j;
  }
  if (!s.groqKey) return offline(userText);

  const messages = [{ role: "system", content: sys() }, ...history.slice(-12), { role: "user", content: userText }];
  const steps = [], outputs = []; let answer = "";
  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await groqChat({ model: s.model, messages, tools: groqTools(), tool_choice: "auto", temperature: 0.2 });
    const msg = res.choices[0].message; messages.push(msg);
    if (!msg.tool_calls?.length) { answer = msg.content || ""; break; }
    await Promise.all(msg.tool_calls.map(async (tc) => {
      const t0 = performance.now(); let args = {}, text;
      try { args = JSON.parse(tc.function.arguments || "{}"); text = JSON.stringify(await callTool(tc.function.name, args)); } catch (e) { text = "Error: " + e.message; }
      steps.push({ tool: tc.function.name, ms: Math.round(performance.now() - t0) }); onStep(steps.at(-1)); outputs.push(text);
      messages.push({ role: "tool", tool_call_id: tc.id, content: text.slice(0, 12000) });
    }));
  }
  if (!answer) answer = "I couldn't finish within the step limit. Try a narrower request.";
  let reflection;
  if (outputs.length) {
    try { const v = await callTool("reflect_and_validate", { draft: answer, context: outputs.join("\n---\n").slice(0, 24000) });
      reflection = { grounded: !!v.grounded && v.timezone_ok !== false, issues: v.issues || [] };
      if (!reflection.grounded && typeof v.corrected === "string" && v.corrected.length > 20) answer = v.corrected; } catch { /* best effort */ }
  }
  history.push({ role: "user", content: userText }, { role: "assistant", content: answer });
  return { answer, steps, reflection };
}
