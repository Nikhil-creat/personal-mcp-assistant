import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { groq, MODEL, REFLECT_MODEL } from "./groq.js";
import { createMcpServer } from "../mcp/server.js";
import { query } from "../db/pool.js";

const MAX_STEPS = 8;
const TZ = process.env.DEFAULT_TZ ?? "Asia/Kolkata";

const systemPrompt = () => `You are a personal assistant with MCP tools for the user's calendar, notes, scanned documents and memory.
Current time: ${new Date().toISOString()} (user timezone: ${TZ}). Always pass ISO-8601 timestamps WITH offset.
Work in a ReAct loop: think about what you need, call tools, read results, repeat. Prefer hybrid_search_notes (source "notes" and "vision") before answering from knowledge.
Never invent notes, events, or times; if tools return nothing, say so. For cross-referencing tasks, search notes+vision, fetch events, then draft.`;

export interface ChatResult { answer: string; steps: { tool: string; args: unknown; ms: number }[]; reflection?: { grounded: boolean; issues: string[] } }

export async function createAgent(sessionId: string) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createMcpServer(sessionId).connect(st);
  const client = new Client({ name: "groq-react-agent", version: "1.0.0" });
  await client.connect(ct);

  const { tools: mcpTools } = await client.listTools();
  const tools: ChatCompletionTool[] = mcpTools
    .filter((t) => t.name !== "reflect_and_validate") // reflection is enforced by the loop itself
    .map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema as any } }));

  const history: ChatCompletionMessageParam[] = [];
  const prior = await query(`SELECT key_facts FROM agent_memories WHERE session_id=$1 AND memory_type='short_term' ORDER BY last_accessed_at DESC LIMIT 12`, [sessionId]);
  for (const r of prior.reverse()) history.push(r.key_facts as ChatCompletionMessageParam);

  async function remember(msg: { role: string; content: string }) {
    await query(`INSERT INTO agent_memories (session_id,memory_type,key_facts) VALUES ($1,'short_term',$2)`, [sessionId, JSON.stringify(msg)]).catch(() => {});
  }

  async function chat(userText: string): Promise<ChatResult> {
    const messages: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt() }, ...history, { role: "user", content: userText }];
    const steps: ChatResult["steps"] = [];
    const toolOutputs: string[] = [];
    let answer = "";

    for (let i = 0; i < MAX_STEPS; i++) {
      const res = await groq.chat.completions.create({ model: MODEL, messages, tools, tool_choice: "auto", temperature: 0.2 });
      const msg = res.choices[0].message;
      messages.push(msg as ChatCompletionMessageParam);
      if (!msg.tool_calls?.length) { answer = msg.content ?? ""; break; }

      // execute independent tool calls in parallel
      await Promise.all(msg.tool_calls.map(async (tc) => {
        const t0 = Date.now();
        let args: any = {};
        let text: string;
        try {
          args = JSON.parse(tc.function.arguments || "{}");
          const r: any = await client.callTool({ name: tc.function.name, arguments: args });
          text = (r.content as any[]).map((c) => c.text ?? "").join("\n");
        } catch (e) { text = `Error: ${(e as Error).message}`; }
        steps.push({ tool: tc.function.name, args, ms: Date.now() - t0 });
        toolOutputs.push(text);
        messages.push({ role: "tool", tool_call_id: tc.id, content: text.slice(0, 12000) });
      }));
    }
    if (!answer) answer = "I couldn't finish within the step limit. Try a narrower request.";

    // Self-reflection guardrail: only meaningful when tools produced context to check against.
    let reflection: ChatResult["reflection"];
    if (toolOutputs.length) {
      try {
        const r: any = await client.callTool({ name: "reflect_and_validate", arguments: { draft: answer, context: toolOutputs.join("\n---\n").slice(0, 38000) } });
        const v = JSON.parse(r.content[0].text);
        reflection = { grounded: !!v.grounded && v.timezone_ok !== false, issues: v.issues ?? [] };
        if (!reflection.grounded && typeof v.corrected === "string" && v.corrected.length > 20) answer = v.corrected;
      } catch { /* reflection is best-effort */ }
    }

    history.push({ role: "user", content: userText }, { role: "assistant", content: answer });
    await remember({ role: "user", content: userText });
    await remember({ role: "assistant", content: answer });
    return { answer, steps, reflection };
  }

  return { chat, close: () => client.close() };
}

void REFLECT_MODEL;
