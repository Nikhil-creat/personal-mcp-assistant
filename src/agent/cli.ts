import readline from "node:readline/promises";
import { createAgent } from "./chatBot.js";

const agent = await createAgent("cli-" + Date.now());
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("Personal MCP Assistant (Ctrl+C to quit)");
for (;;) {
  const q = (await rl.question("\nyou> ")).trim();
  if (!q) continue;
  const t0 = Date.now();
  const r = await agent.chat(q);
  for (const s of r.steps) console.log(`  · ${s.tool} (${s.ms}ms)`);
  console.log(`\nassistant> ${r.answer}\n[${Date.now() - t0}ms${r.reflection ? `, grounded=${r.reflection.grounded}` : ""}]`);
}
