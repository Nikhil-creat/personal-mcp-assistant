"use client";
import { useEffect, useRef, useState } from "react";
import ContextGraph from "../components/ContextGraph";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Msg = { role: "user" | "assistant"; text: string; meta?: string };

export default function Page() {
  const [sid] = useState(() => "web-" + Math.random().toString(36).slice(2, 10));
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
  const [tab, setTab] = useState<"chat" | "graph">("chat");
  const end = useRef<HTMLDivElement>(null);

  const loadGraph = () => fetch(`${API}/api/graph`).then((r) => r.json()).then(setGraph).catch(() => {});
  useEffect(() => { loadGraph(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send() {
    const text = input.trim(); if (!text || busy) return;
    setInput(""); setBusy(true); setMsgs((m) => [...m, { role: "user", text }]);
    try {
      const r = await fetch(`${API}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sid, message: text }) });
      const j = await r.json();
      const meta = j.steps?.length ? j.steps.map((s: any) => `${s.tool} ${s.ms}ms`).join(" → ") + (j.reflection ? ` · grounded: ${j.reflection.grounded}` : "") : undefined;
      setMsgs((m) => [...m, { role: "assistant", text: j.answer ?? j.error ?? "Error", meta }]);
      loadGraph();
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", text: "Network error: " + (e as Error).message }]); }
    setBusy(false);
  }

  async function upload(f: File) {
    const fd = new FormData(); fd.append("file", f);
    setMsgs((m) => [...m, { role: "user", text: `📎 ${f.name}` }]);
    const j = await fetch(`${API}/api/upload`, { method: "POST", body: fd }).then((r) => r.json());
    setMsgs((m) => [...m, { role: "assistant", text: j.error ? `Upload failed: ${j.error}` : `Indexed ${j.file_name}: ${j.chars} chars, ${j.regions} regions.\n\n${j.preview}` }]);
    loadGraph();
  }

  return (
    <main className="mx-auto flex h-[100dvh] max-w-3xl flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Personal MCP Assistant</h1>
        <nav className="flex gap-1 rounded-lg bg-slate-800/60 p-1 text-sm">
          {(["chat", "graph"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? "bg-sky-500 text-slate-950" : "text-slate-300"}`}>{t === "chat" ? "Chat" : "3D Graph"}</button>
          ))}
        </nav>
      </header>

      {tab === "graph" ? (
        <section className="min-h-0 flex-1 rounded-xl border border-slate-800 bg-slate-900/40">
          <ContextGraph nodes={graph.nodes} edges={graph.edges} />
          <p className="px-3 pb-2 text-xs text-slate-400">● notes ● vision docs ● events · drag to rotate</p>
        </section>
      ) : (
        <>
          <section className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            {msgs.length === 0 && <p className="text-sm text-slate-400">Try: “Look at my whiteboard notes, cross-reference my calendar this week, and draft a prep summary.”</p>}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <div className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-sky-500 text-slate-950" : "bg-slate-800"}`}>{m.text}</div>
                {m.meta && <div className="mt-1 text-[11px] text-slate-500">{m.meta}</div>}
              </div>
            ))}
            {busy && <div className="text-sm text-slate-400">thinking…</div>}
            <div ref={end} />
          </section>
          <footer className="flex gap-2">
            <label className="cursor-pointer rounded-lg bg-slate-800 px-3 py-2 text-sm">📎<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask anything…" className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none ring-sky-500 focus:ring-1" />
            <button onClick={send} disabled={busy} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50">Send</button>
          </footer>
        </>
      )}
      <p className="pb-1 text-center text-[11px] text-slate-500">Designed &amp; developed by <b className="text-slate-300">NIKHIL CHARY SRIRAMOJU</b></p>
    </main>
  );
}
