// Extra AI features: daily briefing, free-slot finder + booking, note AI actions, offline auto-tag & clustering, voice in/out.
import { data, save, esc, fmt, settings } from "./store.js";
import { callTool } from "./tools.js";
import { groqComplete } from "./agent.js";

const $ = (s) => document.querySelector(s);
const toast = (m) => document.dispatchEvent(new CustomEvent("toast", { detail: m }));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
const STOP = new Set("the and for with this that from have has had will your you our are was were been into over under more most also just than which who what when where how about there their them they then these those would could should can not but its it's very much many some any each other such only same both into onto out off per via".split(" "));
const tok = (t) => String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const keywords = (text, n = 4) => { const f = {};
  for (const w of tok(text)) if (w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)) f[w] = (f[w] || 0) + 1;
  return Object.entries(f).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map((x) => x[0]); };
const needKey = () => { if (!settings().groqKey) throw new Error("Add your Groq API key in Settings for this AI action"); };
const busy = (btn, on) => { btn.disabled = on; btn.dataset.t ??= btn.textContent; btn.textContent = on ? "Working…" : btn.dataset.t; };

// ---------- Daily briefing ----------
async function briefing() {
  const now = Date.now(), ev = data().events.filter((e) => Date.parse(e.end) > now && Date.parse(e.start) < now + 7 * 864e5).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const conflicts = []; for (let i = 0; i < ev.length; i++) for (let j = i + 1; j < ev.length; j++) if (Date.parse(ev[i].start) < Date.parse(ev[j].end) && Date.parse(ev[j].start) < Date.parse(ev[i].end)) conflicts.push(`${ev[i].title} ⇄ ${ev[j].title}`);
  const notes = data().notes.slice(0, 6);
  if (!settings().groqKey) {
    let t = `**Your next 7 days** (offline briefing)\n`;
    t += ev.length ? ev.map((e) => `• ${e.title} — ${fmt(e.start)}${e.location ? " @ " + e.location : ""}`).join("\n") : "No upcoming events.";
    if (conflicts.length) t += `\n\n⚠ Conflicts: ${conflicts.join("; ")}`;
    if (notes.length) t += `\n\n**Recent notes**\n` + notes.map((n) => `• ${n.title}`).join("\n");
    return t + "\n\nAdd a Groq key for an AI-written briefing with priorities.";
  }
  const ctx = JSON.stringify({ now: new Date().toString(), events: ev.map((e) => ({ title: e.title, start: fmt(e.start), end: fmt(e.end), location: e.location })), conflicts, notes: notes.map((n) => ({ title: n.title, content: n.content.slice(0, 300) })), memories: data().memories.slice(0, 5).map((m) => m.fact) });
  return groqComplete("You write a crisp morning briefing from ONLY the provided JSON: 1) today & next-7-days schedule, 2) conflicts/risks, 3) top 3 priorities drawn from notes, 4) one suggested next action. Use short bullets. Never invent items.", ctx);
}

// ---------- Free slots ----------
function freeSlots(days, dur, from, to) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const s = new Date(); s.setDate(s.getDate() + d); const e = new Date(s); s.setHours(from, 0, 0, 0); e.setHours(to, 0, 0, 0);
    let cur = Math.max(s.getTime(), Date.now()); cur = Math.ceil(cur / 9e5) * 9e5;
    const b = data().events.filter((x) => x.status !== "cancelled" && Date.parse(x.end) > s && Date.parse(x.start) < e).map((x) => [Date.parse(x.start), Date.parse(x.end)]).sort((x, y) => x[0] - y[0]);
    for (const [bs, be] of b) { if (bs - cur >= dur * 6e4) out.push([cur, bs]); cur = Math.max(cur, be); }
    if (e.getTime() - cur >= dur * 6e4) out.push([cur, e.getTime()]);
  }
  return out;
}

// ---------- Note AI ----------
const PROMPTS = {
  summarize: "Summarise this note in 3 concise bullets.",
  actions: "Extract concrete action items as a checklist with owners/deadlines only if stated. Do not invent any.",
  flashcards: "Create 5 study flashcards from this note as lines 'Q: … / A: …'. Use only facts in the note.",
  rewrite: "Rewrite this note clearly and professionally, keeping every fact. Return only the rewritten text.",
  explain: "Explain this note simply, as if to a beginner, using one analogy. Do not add new facts.",
};
async function noteAction(id, action) {
  const n = data().notes.find((x) => x.id === id); if (!n) throw new Error("Select a note");
  if (action === "tags") { const t = keywords(n.title + " " + n.content, 4); await callTool("update_note", { id, tags: [...new Set([...n.tags, ...t])] }); return `Auto-tagged (offline TF keywords): ${t.join(", ")}`; }
  needKey(); return groqComplete(PROMPTS[action], `TITLE: ${n.title}\n\n${n.content}`);
}

// ---------- Clusters (offline k-means on embeddings) ----------
function clusters(k = 4) {
  const items = data().notes.filter((n) => n.vec); if (items.length < 2) return [];
  k = Math.min(k, items.length); const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const cent = [items[0].vec]; while (cent.length < k) { let best = 0, bd = 2; items.forEach((n, i) => { const m = Math.max(...cent.map((c) => dot(c, n.vec))); if (m < bd) { bd = m; best = i; } }); cent.push(items[best].vec); }
  let asg = new Array(items.length).fill(0);
  for (let it = 0; it < 12; it++) {
    asg = items.map((n) => cent.reduce((bi, c, i) => (dot(c, n.vec) > dot(cent[bi], n.vec) ? i : bi), 0));
    cent.forEach((_, ci) => { const m = items.filter((_, i) => asg[i] === ci); if (!m.length) return; const v = m[0].vec.map((_, d) => m.reduce((s, x) => s + x.vec[d], 0)); const nr = Math.sqrt(dot(v, v)) || 1; cent[ci] = v.map((x) => x / nr); });
  }
  return cent.map((_, ci) => { const m = items.filter((_, i) => asg[i] === ci); return { label: keywords(m.map((x) => x.title + " " + x.content).join(" "), 3).join(" · ") || "misc", notes: m.map((x) => x.title) }; }).filter((c) => c.notes.length);
}

// ---------- Voice ----------
export function speak(text) {
  if (!("speechSynthesis" in window)) return; speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*#_`•]/g, "").slice(0, 1200)); u.lang = $("#voiceLang")?.value || "en-IN"; speechSynthesis.speak(u);
}
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, btn = $("#micBtn");
  if (!SR) { btn.hidden = true; $("#voiceBar").hidden = true; return; }
  let rec = null;
  btn.onclick = () => { if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = $("#voiceLang").value; rec.interimResults = false; rec.maxAlternatives = 1; btn.classList.add("rec");
    rec.onresult = (e) => { $("#chatInput").value = e.results[0][0].transcript; $("#chatForm").requestSubmit(); };
    rec.onerror = (e) => toast("Mic: " + e.error); rec.onend = () => { rec = null; btn.classList.remove("rec"); };
    try { rec.start(); } catch { rec = null; btn.classList.remove("rec"); } };
}

// ---------- wiring ----------
export function initAI() {
  initVoice();
  const out = (id, html) => { $(id).innerHTML = html; };
  $("#briefBtn").onclick = async (e) => { busy(e.target, true); try { out("#briefOut", `<div class="msg">${md(await briefing())}</div>`); } catch (x) { toast(x.message); } busy(e.target, false); };
  $("#slotBtn").onclick = () => { const dur = Math.max(15, +$("#slotDur").value || 60), s = freeSlots(+$("#slotDays").value || 3, dur, +$("#slotFrom").value || 9, +$("#slotTo").value || 18);
    out("#slotOut", s.length ? s.slice(0, 12).map(([a, b]) => `<div class="item"><p>${fmt(new Date(a).toISOString())} → ${new Date(b).toLocaleTimeString("en-IN", { timeStyle: "short" })}</p><div class="meta"><button class="btn ghost" data-book="${a}" data-dur="${dur}">Book ${dur} min</button></div></div>`).join("") : `<p class="dim">No free slots found.</p>`); };
  $("#slotOut").onclick = async (e) => { const a = e.target.dataset.book; if (!a) return; const start = new Date(+a), end = new Date(+a + +e.target.dataset.dur * 6e4);
    try { await callTool("create_event", { title: $("#slotTitle").value.trim() || "Focus block", start_time: start.toISOString(), end_time: end.toISOString() }); toast("Booked"); $("#slotBtn").click(); } catch (x) { toast(x.message); } };
  const fillNotes = () => { const sel = $("#aiNote"), v = sel.value; sel.innerHTML = data().notes.map((n) => `<option value="${n.id}">${esc(n.title)}</option>`).join("") || `<option value="">No notes</option>`; if (v) sel.value = v; };
  document.addEventListener("datachanged", fillNotes); fillNotes();
  $("#aiRun").onclick = async (e) => { busy(e.target, true); out("#aiOut", ""); try { const r = await noteAction($("#aiNote").value, $("#aiAction").value); out("#aiOut", `<div class="msg">${md(r)}</div>`); } catch (x) { toast(x.message); } busy(e.target, false); };
  $("#clusterBtn").onclick = () => { const c = clusters(+$("#clusterK").value || 4);
    out("#clusterOut", c.length ? c.map((x) => `<div class="item"><h4>${esc(x.label)}</h4><div class="meta">${x.notes.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div></div>`).join("") : `<p class="dim">Add at least 2 notes (or load demo data).</p>`); };
}
