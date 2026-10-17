import { data, save, wipe, uid, settings, saveSettings, esc, fmt, tzOffset } from "./store.js";
import { embed, hybrid } from "./rag.js";
import { callTool, searchItems } from "./tools.js";
import { chat } from "./agent.js";
import { loadToCanvas, runVision, drawGrid } from "./vision.js";
import { initGraph } from "./graph3d.js";
import { initAI, speak } from "./ai.js";

const $ = (s) => document.querySelector(s);
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); };
document.addEventListener("toast", (e) => toast(e.detail));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
const empty = (t) => `<p class="dim">${t}</p>`;

// ---------- chrome ----------
$("#yr").textContent = new Date().getFullYear();
$("#burger").onclick = () => $("#menu").classList.toggle("open");
$("#menu").onclick = () => $("#menu").classList.remove("open");
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
$("#tabs").onclick = (e) => { const b = e.target.closest(".tab"); if (!b) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === b));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("on", p.id === "p-" + b.dataset.tab)); };
const goTab = (n) => document.querySelector(`.tab[data-tab="${n}"]`).click();

// ---------- settings ----------
function badge() { const s = settings(); const b = $("#modeBadge"); b.textContent = s.api ? "backend mode" : s.groqKey ? "groq agent" : "offline mode"; b.classList.toggle("live", !!(s.api || s.groqKey)); }
$("#openSettings").onclick = () => { const s = settings(); $("#sKey").value = s.groqKey; $("#sModel").value = s.model; $("#sTz").value = s.tz; $("#sApi").value = s.api; $("#settings").showModal(); };
$("#sSave").onclick = () => { const tz = $("#sTz").value.trim();
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { return toast("Invalid timezone"), void event.preventDefault(); }
  saveSettings({ groqKey: $("#sKey").value.trim(), model: $("#sModel").value, tz, api: $("#sApi").value.trim() }); badge(); toast("Settings saved"); };
badge();

// ---------- demo data ----------
function seed() {
  const d = data(), off = tzOffset(settings().tz), day = (n, h, m = 0) => { const t = new Date(); t.setDate(t.getDate() + n); const p = (x) => String(x).padStart(2, "0");
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(h)}:${p(m)}:00${off}`; };
  const notes = [["Whiteboard: system design review", "Sketch of the MCP server, Postgres pgvector index choice (HNSW vs ivfflat), RRF fusion k=60. Open question: embedding model for production.", ["design", "mcp"]],
    ["Sprint planning", "Finish API auth, review CNN worker OCR accuracy, add Docker healthchecks. Demo to mentor on Friday.", ["work", "sprint"]],
    ["Study: Cryptography", "DES uses 16 Feistel rounds with a 56-bit key; AES uses SubBytes, ShiftRows, MixColumns, AddRoundKey.", ["study"]],
    ["Internship report ideas", "Document the ML pipeline, evaluation metrics and deployment lessons for the final report.", ["career"]]];
  notes.forEach(([title, content, tags]) => d.notes.push({ id: uid(), title, content, tags, created: new Date().toISOString(), vec: embed(title + " " + content) }));
  [["System design review", 1, 15, 16, "Lab 2"], ["Mentor demo", 3, 11, 12, "Google Meet"], ["Sprint planning", 1, 15, 16, "Online"], ["Cryptography lecture", 2, 10, 11, "Room 304"]]
    .forEach(([title, n, a, b, loc]) => d.events.push({ id: uid(), title, description: "", start: new Date(day(n, a)).toISOString(), end: new Date(day(n, b)).toISOString(), location: loc, attendees: [], status: "confirmed" }));
  d.memories.push({ id: uid(), type: "long_term", fact: "Prefers concise summaries with action items first.", at: new Date().toISOString(), vec: embed("Prefers concise summaries with action items first.") });
  save(); toast("Demo data loaded"); }
$("#seedBtn").onclick = () => { if (data().notes.length || data().events.length) return toast("Data already present"); seed(); };

// ---------- chat ----------
const log = $("#chatLog");
const add = (cls, html, meta) => { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html + (meta ? `<small>${esc(meta)}</small>` : ""); log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
add("", "Hi! Ask about your notes, calendar or scanned documents. Click “Load demo data” on the hero to try it.");
["Summarise my notes about system design", "What's on my calendar this week?", "Do I have schedule conflicts?", "Prep summary for Friday's demo"].forEach((q) => {
  const b = document.createElement("button"); b.textContent = q; b.onclick = () => { $("#chatInput").value = q; $("#chatForm").requestSubmit(); }; $("#chips").appendChild(b); });
$("#chatForm").onsubmit = async (e) => { e.preventDefault(); const q = $("#chatInput").value.trim(); if (!q) return;
  $("#chatInput").value = ""; add("u", esc(q)); const w = add("", "thinking…"); $("#chatSend").disabled = true; const t0 = performance.now();
  try { const r = await chat(q, (s) => (w.innerHTML = `running <b>${esc(s.tool)}</b>…`));
    const meta = (r.steps?.length ? r.steps.map((s) => `${s.tool} ${s.ms}ms`).join(" → ") + " · " : "") + `${Math.round(performance.now() - t0)}ms` + (r.reflection ? ` · grounded: ${r.reflection.grounded}` : "");
    w.innerHTML = md(r.answer) + `<small>${esc(meta)}</small>`; if ($("#speakOn")?.checked) speak(r.answer);
  } catch (err) { w.innerHTML = "⚠ " + esc(err.message); }
  $("#chatSend").disabled = false; log.scrollTop = log.scrollHeight; };

// ---------- notes ----------
$("#noteForm").onsubmit = (e) => { e.preventDefault(); callTool("create_note", { title: $("#nTitle").value.trim(), content: $("#nContent").value.trim(), tags: $("#nTags").value.split(",").map((t) => t.trim()).filter(Boolean) }).then(() => { e.target.reset(); toast("Note saved"); }).catch((x) => toast(x.message)); };
$("#nSearch").oninput = renderNotes;
function renderNotes() { const q = $("#nSearch").value.trim(); let html = "";
  if (q) { const hits = [...hybrid(searchItems("notes"), q, 6), ...hybrid(searchItems("vision"), q, 3)].sort((a, b) => b.score - a.score);
    html = hits.length ? hits.map((h) => `<div class="item"><h4>${esc(h.title)}</h4><p>${esc(h.snippet)}</p><div class="meta"><span class="tag">${h.source}</span><span>RRF ${h.score}</span></div></div>`).join("") : empty("No matches.");
  } else html = data().notes.length ? data().notes.map((n) => `<div class="item"><h4>${esc(n.title)}</h4><p>${esc(n.content)}</p><div class="meta">${n.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}<span>${fmt(n.created)}</span><button class="del" data-del-note="${n.id}">Delete</button></div></div>`).join("") : empty("No notes yet.");
  $("#noteList").innerHTML = html; }
$("#noteList").onclick = (e) => { const id = e.target.dataset.delNote; if (id) { data().notes = data().notes.filter((n) => n.id !== id); save(); } };

// ---------- calendar ----------
$("#evForm").onsubmit = (e) => { e.preventDefault(); const off = tzOffset(settings().tz), L = (v) => (v.length === 16 ? v + ":00" : v) + off;
  callTool("create_event", { title: $("#eTitle").value.trim(), start_time: L($("#eStart").value), end_time: L($("#eEnd").value), location: $("#eLoc").value.trim(), description: $("#eDesc").value.trim(), attendees: $("#eAtt").value.split(",").map((t) => t.trim()).filter(Boolean) })
    .then(() => { e.target.reset(); toast("Event added"); }).catch((x) => toast(x.message)); };
$("#conflictBtn").onclick = async () => { const c = await callTool("detect_schedule_conflicts", { start_date: new Date(Date.now() - 864e5).toISOString(), end_date: new Date(Date.now() + 90 * 864e5).toISOString() });
  $("#conflicts").innerHTML = c.length ? c.map((x) => `<div class="conf">⚠ <b>${esc(x.a.title)}</b> overlaps <b>${esc(x.b.title)}</b> (${fmt(x.a.start)})</div>`).join("") : `<p class="okmsg">✓ No conflicts in the next 90 days.</p>`; };
function renderEvents() { const ev = [...data().events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  $("#evList").innerHTML = ev.length ? ev.map((e) => `<div class="item"><h4>${esc(e.title)}</h4><p>${fmt(e.start)} → ${fmt(e.end)}${e.location ? " · " + esc(e.location) : ""}</p><div class="meta">${e.attendees.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}<button class="del" data-del-ev="${e.id}">Delete</button></div></div>`).join("") : empty("No events yet."); }
$("#evList").onclick = (e) => { const id = e.target.dataset.delEv; if (id) { data().events = data().events.filter((x) => x.id !== id); save(); } };

// ---------- vision ----------
let visResult = null, visName = "";
const cv = $("#visCanvas"), file = $("#imgFile"), drop = $("#drop");
async function pick(f) { if (!f || !f.type.startsWith("image/")) return toast("Choose an image file"); if (f.size > 15e6) return toast("Image too large (15 MB max)");
  try { await loadToCanvas(f, cv); cv.hidden = false; visName = f.name; $("#runVision").disabled = false; $("#visStatus").textContent = `${cv.width}×${cv.height}`; visResult = null; $("#saveVision").hidden = true; }
  catch { toast("Could not read that image"); } }
file.onchange = () => pick(file.files[0]);
drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over")); drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); };
$("#runVision").onclick = async () => { $("#runVision").disabled = true; $("#visStatus").textContent = "Preprocessing…";
  try { visResult = await runVision(cv, (p) => ($("#visStatus").textContent = `OCR ${p}%`)); $("#visStatus").textContent = `Done · ${visResult.boxes.length} regions`;
    $("#visText").hidden = false; $("#visText").textContent = visResult.text || "(no text detected)";
    const f = $("#visFeat"); f.innerHTML = ""; visResult.feats.forEach((m) => { const fig = document.createElement("figure"); fig.appendChild(drawGrid(m.grid)); fig.append(m.name); f.appendChild(fig); });
    const ctx = cv.getContext("2d"); ctx.strokeStyle = "#34d399"; ctx.lineWidth = 2; visResult.boxes.forEach((b) => ctx.strokeRect(b.x, b.y, b.w, b.h)); $("#saveVision").hidden = !visResult.text;
  } catch (err) { $("#visStatus").textContent = "⚠ " + err.message; } $("#runVision").disabled = false; };
$("#saveVision").onclick = () => { if (!visResult) return; data().docs.unshift({ id: uid(), name: visName, text: visResult.text, boxes: visResult.boxes, size: visResult.size, created: new Date().toISOString(), vec: embed(visName + " " + visResult.text) }); save(); toast("Saved to knowledge base"); $("#saveVision").hidden = true; };
function renderDocs() { $("#docList").innerHTML = data().docs.length ? data().docs.map((d) => `<div class="item"><h4>🖼 ${esc(d.name)}</h4><p>${esc(d.text.slice(0, 300))}</p><div class="meta"><span>${d.boxes.length} regions</span><span>${fmt(d.created)}</span><button class="del" data-del-doc="${d.id}">Delete</button></div></div>`).join("") : empty("No scanned documents yet."); }
$("#docList").onclick = (e) => { const id = e.target.dataset.delDoc; if (id) { data().docs = data().docs.filter((d) => d.id !== id); save(); } };

// ---------- memory & audit ----------
$("#memForm").onsubmit = (e) => { e.preventDefault(); callTool("store_agent_fact", { fact: $("#mFact").value.trim(), memory_type: $("#mType").value }).then(() => { e.target.reset(); toast("Remembered"); }); };
function renderMem() { $("#memList").innerHTML = data().memories.length ? data().memories.map((m) => `<div class="item"><p>${esc(m.fact)}</p><div class="meta"><span class="tag">${m.type}</span><span>${fmt(m.at)}</span><button class="del" data-del-mem="${m.id}">Delete</button></div></div>`).join("") : empty("No memories yet."); }
$("#memList").onclick = (e) => { const id = e.target.dataset.delMem; if (id) { data().memories = data().memories.filter((m) => m.id !== id); save(); } };
function renderAudit() { $("#auditList").innerHTML = data().audit.length ? data().audit.slice(0, 60).map((a) => `<div class="item"><h4>${esc(a.tool)} <span class="dim">· ${a.ms}ms</span></h4><p>in: ${esc(a.input)}\nout: ${esc(a.output)}</p><div class="meta">${fmt(a.at)}</div></div>`).join("") : empty("No tool calls yet."); }
$("#clearAudit").onclick = () => { data().audit = []; save(); };
$("#exportBtn").onclick = () => { const j = JSON.parse(JSON.stringify(data())); for (const k of ["notes", "docs", "memories"]) j[k].forEach((x) => delete x.vec);
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" })); a.download = "mcp-assistant-export.json"; a.click(); URL.revokeObjectURL(a.href); };
$("#wipeBtn").onclick = () => { if (confirm("Delete ALL local notes, events, documents, memories and audit logs?")) { wipe(); toast("All data deleted"); } };

function renderAll() { renderNotes(); renderEvents(); renderDocs(); renderMem(); renderAudit(); }
document.addEventListener("datachanged", renderAll); renderAll();
initGraph($("#hero3d")); initAI();
