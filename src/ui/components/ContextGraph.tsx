"use client";
import { useEffect, useRef } from "react";

type N = { id: string; label: string; type: "note" | "vision" | "event" };
type E = { source: string; target: string };
const COLOR = { note: "#38bdf8", vision: "#a78bfa", event: "#34d399" };

/** Self-contained 3D force-ish graph on a 2D canvas (own perspective projection, drag to rotate). */
export default function ContextGraph({ nodes, edges }: { nodes: N[]; edges: E[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; };
    resize();
    const P = nodes.map((n, i) => {           // Fibonacci sphere layout
      const y = 1 - (i / Math.max(1, nodes.length - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      return { ...n, x: Math.cos(th) * r, y, z: Math.sin(th) * r };
    });
    const idx = new Map(P.map((p, i) => [p.id, i]));
    let ay = 0, ax = 0.3, drag = false, lx = 0, ly = 0, raf = 0;
    const down = (e: PointerEvent) => { drag = true; lx = e.clientX; ly = e.clientY; };
    const up = () => (drag = false);
    const move = (e: PointerEvent) => { if (!drag) return; ay += (e.clientX - lx) * 0.01; ax += (e.clientY - ly) * 0.01; lx = e.clientX; ly = e.clientY; };
    c.addEventListener("pointerdown", down); window.addEventListener("pointerup", up); window.addEventListener("pointermove", move);
    const proj = (p: { x: number; y: number; z: number }) => {
      const x1 = p.x * Math.cos(ay) - p.z * Math.sin(ay), z1 = p.x * Math.sin(ay) + p.z * Math.cos(ay);
      const y2 = p.y * Math.cos(ax) - z1 * Math.sin(ax), z2 = p.y * Math.sin(ax) + z1 * Math.cos(ax);
      const s = 2.8 / (2.8 + z2), R = Math.min(c.width, c.height) * 0.36;
      return { sx: c.width / 2 + x1 * R * s, sy: c.height / 2 + y2 * R * s, s, z: z2 };
    };
    const draw = () => {
      if (!drag) ay += 0.003;
      ctx.clearRect(0, 0, c.width, c.height);
      const pr = P.map(proj);
      ctx.lineWidth = dpr; ctx.strokeStyle = "rgba(148,163,184,.18)";
      for (const e of edges) { const a = idx.get(e.source), b = idx.get(e.target); if (a === undefined || b === undefined) continue;
        ctx.beginPath(); ctx.moveTo(pr[a].sx, pr[a].sy); ctx.lineTo(pr[b].sx, pr[b].sy); ctx.stroke(); }
      [...P.keys()].sort((a, b) => pr[b].z - pr[a].z).forEach((i) => {
        const p = P[i], q = pr[i];
        ctx.fillStyle = COLOR[p.type]; ctx.globalAlpha = 0.45 + 0.55 * q.s / 1.4;
        ctx.beginPath(); ctx.arc(q.sx, q.sy, 5 * dpr * q.s, 0, 7); ctx.fill();
        if (q.s > 1.0) { ctx.globalAlpha = 0.8; ctx.fillStyle = "#cbd5e1"; ctx.font = `${11 * dpr}px sans-serif`; ctx.fillText(p.label.slice(0, 22), q.sx + 8 * dpr, q.sy + 3 * dpr); }
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); c.removeEventListener("pointerdown", down); window.removeEventListener("pointerup", up); window.removeEventListener("pointermove", move); window.removeEventListener("resize", resize); };
  }, [nodes, edges]);
  return <canvas ref={ref} className="h-full w-full touch-none cursor-grab rounded-xl" />;
}
