// Three.js context graph: notes / documents / events as a rotating constellation. Drag to rotate, hover for labels.
import { data } from "./store.js";
import { embed } from "./rag.js";

const COL = { note: 0x38bdf8, vision: 0xa78bfa, event: 0x34d399, memory: 0xfbbf24, ghost: 0x475569 };
export function initGraph(canvas) {
  if (!window.THREE) return;
  const T = THREE, r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(55, 1, 0.1, 100); cam.position.z = 9;
  const root = new T.Group(); scene.add(root);
  const stars = new T.BufferGeometry(), sp = []; for (let i = 0; i < 500; i++) sp.push((Math.random() - .5) * 40, (Math.random() - .5) * 40, (Math.random() - .5) * 40);
  stars.setAttribute("position", new T.Float32BufferAttribute(sp, 3)); scene.add(new T.Points(stars, new T.PointsMaterial({ color: 0x64748b, size: 0.05 })));
  const tip = document.createElement("div"); tip.style.cssText = "position:fixed;pointer-events:none;background:#0b1020;border:1px solid #38bdf8;border-radius:8px;padding:3px 9px;font:12px system-ui;color:#e6edf7;display:none;z-index:60"; document.body.appendChild(tip);
  let meshes = [], lines = null;

  function build() {
    root.clear(); meshes = [];
    const d = data();
    let nodes = [...d.notes.map((n) => ({ t: "note", label: n.title, vec: n.vec })), ...d.docs.map((n) => ({ t: "vision", label: n.name, vec: n.vec })),
      ...d.events.map((e) => ({ t: "event", label: e.title, vec: embed(e.title + " " + e.description) })), ...d.memories.map((m) => ({ t: "memory", label: m.fact.slice(0, 40), vec: m.vec }))].slice(0, 120);
    const ghost = nodes.length === 0; if (ghost) nodes = Array.from({ length: 36 }, (_, i) => ({ t: "ghost", label: "Add notes to see your graph", vec: null }));
    const n = nodes.length;
    nodes.forEach((nd, i) => { const y = 1 - (i / Math.max(1, n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = i * 2.399963, R = 4;
      const m = new T.Mesh(new T.SphereGeometry(0.12 + (nd.t === "event" ? 0.04 : 0), 14, 14), new T.MeshBasicMaterial({ color: COL[nd.t], transparent: true, opacity: ghost ? 0.5 : 0.95 }));
      m.position.set(Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R); m.userData = nd; root.add(m); meshes.push(m); });
    const pos = [];
    const link = (a, b) => pos.push(...meshes[a].position.toArray(), ...meshes[b].position.toArray());
    if (ghost) for (let i = 0; i < n; i++) link(i, (i + 5) % n);
    else for (let i = 0; i < n; i++) { if (!nodes[i].vec) continue; const sims = [];
      for (let j = 0; j < n; j++) if (j !== i && nodes[j].vec) { let s = 0; for (let k = 0; k < nodes[i].vec.length; k++) s += nodes[i].vec[k] * nodes[j].vec[k]; sims.push([j, s]); }
      sims.sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([j, s]) => s > 0.12 && link(i, j)); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    lines = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35 })); root.add(lines);
  }
  build(); document.addEventListener("datachanged", build);

  let drag = false, lx = 0, ly = 0, vy = 0.0025;
  canvas.addEventListener("pointerdown", (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
  addEventListener("pointerup", () => (drag = false));
  addEventListener("pointermove", (e) => { if (drag) { root.rotation.y += (e.clientX - lx) * 0.006; root.rotation.x += (e.clientY - ly) * 0.006; lx = e.clientX; ly = e.clientY; }
    const rc = canvas.getBoundingClientRect(); const m = new T.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    const ray = new T.Raycaster(); ray.setFromCamera(m, cam); const hit = ray.intersectObjects(meshes)[0];
    if (hit && e.clientY > rc.top && e.clientY < rc.bottom) { tip.style.display = "block"; tip.textContent = hit.object.userData.label; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY + 12 + "px"; } else tip.style.display = "none"; });
  function size() { const w = canvas.clientWidth, h = canvas.clientHeight; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); cam.position.x = w > 900 ? -2.5 : 0; }
  addEventListener("resize", size); size();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let vis = true; new IntersectionObserver(([e]) => (vis = e.isIntersecting)).observe(canvas);
  (function loop() { requestAnimationFrame(loop); if (!vis) return; if (!drag && !reduce) root.rotation.y += vy; r.render(scene, cam); })();
}
